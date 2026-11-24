## Context

android-engine gave the app the sync engine (`SyncEngineController`), the Room index of each workspace (refreshed 500 ms after each disk event) and a placeholder activity. android-shared gave the merge, the view types and the index. The phone writes no own event yet. identity-pairing (device keys, age sealing) runs in parallel and is not on this branch. There is no Android SDK on the development Mac, and the Linux test server was not reachable, so the logic must be testable on the JVM and the app code is compiled once with a scratch SDK.

## Goals / Non-Goals

**Goals:**
- One adaptive Compose Material 3 app: Home, Inbox, Tasks, Task detail, New task, Devices, with the layouts of `docs/phase-1.md` 10.7.
- Phone actions as events in the phone's own logs, then a targeted scan.
- Credential add into the phone outbox behind an interface.
- Push: UnifiedPush registration per computer, `push.yaml`, a notification for each gate push, a short sync.
- The logic in JVM tests; `task android:check` stays SDK-free.

**Non-Goals:**
- Emulator and Compose UI tests (Test later), the board with drag and drop, Knowledge and Settings screens, the pairing UI, the terminal view, the push sender (task-loop), the age implementation (integration with identity-pairing).

## Decisions

1. **New module `:control`** (KMP `jvm()` + Android library, namespace `com.agentworkspace.control`), like `:engine`: the screen states (pure functions of the index rows), the gate rules, the routes and the back stack rules, the width class rules, the actions, `push.yaml`, the push preview and the time texts. `:app` is only Compose and Android glue. Alternative: logic in `:app` with no tests (the app needs the SDK for unit tests), or in `:shared` (it is the file model, not the screens).
2. **One event writer in `:shared`** (`EventWriter`, `NioWorkspaceWriter`): builds the envelope (UUIDv7 id, HLC of the phone clock seeded with `engine.lastHlc()`, `dev`, `by: human@<phone>`), encodes with `AwJson`, validates the line again with `LogReader.validate`, checks the path rule (`WorkspacePaths.classify`: own device, log kind and task of the folder) and the 64 KiB line limit, then appends with the newline rule of `appendLine` in TypeScript. The phone writes no credential value into an event (the sealed value goes only to the sealer), so the writer runs no redaction.
3. **Actions** (`PhoneActions`): `answerGate(task, gate, version, answer, comment)` → `gate.answered`; `sendMessage(task, text)` → `message.sent {id, text, to_session}` only when the task has a running session (else a refusal "No session runs"), as the desktop app; `createTask(project, firstMessage, assignee?, testServer?, credentials, parent?)` → `task.created` with the next free key (`nextFreeKey` over the index tasks and the workspace key prefix), the title from the first line of the first message (at most 120 characters, the rule of the desktop app); `assign(task, agent@device)` → a human `task.assigned` ("Assign task" gate and "Assign to another device…"). After each write: `engine.wrote(ws, path)` and `refresher.changed(ws)`, so the card shows "Answer sent, waiting for <owner>" at once.
4. **Gate rules** equal the desktop `model.ts`: buttons from `gate.options`, "Request changes" and "Reject" need a comment, "Deny" has an optional comment; Reply and a question without options take free text. The card state comes from the view: an own pending answer gives "Answer sent, waiting for <owner device>"; "The owner device is offline" when the owner presence is offline.
5. **Navigation**: AW owns the back stack (`Navigator` in `:control`, a list of `Route`s: `Home`, `Inbox`, `Tasks`, `Devices`, `Task(id)`, `Thread(id)`, `NewTask`). A tab select replaces the stack with `[tab]`; a push opens `[Inbox, Task(id)]`; Esc and Back pop. `:app` keeps the stack in the activity ViewModel (configuration changes do not recreate the activity anyway, `configChanges`). On a large window, opening a task also opens its thread, so the third pane shows at once. `NavDisplay` with `ListDetailSceneStrategy`: the tab roots are list panes, `Task` is a detail pane, `Thread` an extra pane. The directive is `calculatePaneScaffoldDirectiveWithTwoPanesOnMediumWidth` for Inbox and Tasks on medium width (spike S14; fallback: the standard directive), else `calculatePaneScaffoldDirective`. Home and Devices have no detail entry, so they stay 1 pane. Alternative: rememberNavBackStack with serializable keys (needs the serialization plugin in `:app` for the same result).
6. **Navigation suite** from the width class (`WidthClass.of(widthDp)`, a `:control` rule): compact → `NavigationBar`, medium and expanded → `NavigationRail`, large and more → `NavigationDrawer` (the "expanded rail": it shows the labels). The `WideNavigationRail` types are expressive and experimental.
7. **Keyboard and mouse**: `onPreviewKeyEvent` at the root maps Ctrl+N, Ctrl+R, Esc through `Shortcuts.action(key, ctrl)` (`:control`, tested); Enter in the message box sends; arrow keys move the focus in lists (`focusGroup`, focusable rows); a secondary click (`PointerButton.Secondary`) and a long press open the same `DropdownMenu` (Open, Copy task key, Sync now). `onProvideKeyboardShortcuts` lists the shortcuts.
8. **Push** (`connector` 3.3.5 + `embedded-fcm-distributor` 3.1.0): version 3 registers with FCM through Play services with the VAPID key as the sender, so there is no `google-services.json`, no Firebase SDK and no Google services plugin. One instance per computer and workspace (`instance = <workspace id>/<computer slug>`), with the `vapid_public_key` of that computer's `bindings.yaml` (a loose key; task-loop adds it to the schema with the sender). `onNewEndpoint` stores the endpoint (url, p256dh, auth) and writes `tasks/devices/<phone>/push.yaml` atomically:
   ```yaml
   kind: push
   schema: 1
   device: <phone>
   subscriptions:
     - computer: ubuntu-01
       endpoint: https://…
       p256dh: <base64url>
       auth: <base64url>
       vapid_public_key: <base64url>
       distributor: <package>
       updated: <ISO time>
   ```
   The connector decrypts the message (RFC 8291). The preview JSON is `{event, task, key, gate_kind, text}` (docs/phase-1.md 8.3). The service shows a high-priority notification (channel `aw-gates`, id = the gate or event id, title `<key> · <gate name>`, text = the line), starts the engine service and runs `syncNow(15 s)`. A tap opens `MainActivity` with the task id, which opens `[Inbox, Task(id)]`. The fallback distributor is the person's ntfy app (any UnifiedPush distributor). The app keeps the distributor that answered before; else it takes its own embedded distributor, else the first UnifiedPush app, with no picker (the picker of `tryUseCurrentOrDefaultDistributor` needs an Activity). When none is found, Devices shows "Push is off".
9. **Credential outbox**: `CredentialSealer` (`suspend fun seal(name, value, recipients): ByteArray`) and `CredentialOutbox` (writes `tasks/devices/<phone>/sealed/<uuidv7>.age` atomically). The only sealer here is `PendingSealer` (TODO for the identity-pairing integration: age X25519 to the `keys.x25519` of each paired computer, content `{"kind":"sealed-credential","v":1,"name","value"}`). The screen keeps the value in a password field, never logs it, and shows "Credential add needs device keys (identity-pairing)" while `PendingSealer` is in use.
10. **Data flow**: `WorkspaceModel` (`:control`) reads the index after each `refresher.updates` value, after each phone write and on open, and gives one `StateFlow<WorkspaceSnapshot>` (tasks, projects, devices, presence, issues, the key prefix, the text of each shown gate, the bindings and the device records). Each screen state is a pure function of the snapshot and `now`. The thread of a task is read with `index.thread()` (at most 500 events) by `produceState`, keyed by the last HLC and the event count of the task; no per-entry ViewModel is needed yet. One Room index per workspace is opened once and shared by the engine refresher and the screens.
11. **Libraries** (newest release at least 7 days old on 2026-11-23): Compose BOM 2026.11.01 (material3 1.5.0, foundation 1.13.0), activity-compose 1.13.0, material3-adaptive 1.3.0 (`adaptive`, `-layout`, `-navigation3`), navigation-suite 1.5.0, navigation3 1.2.2, lifecycle 2.11.1 (`-runtime-compose`, `-viewmodel-compose`), the Compose compiler plugin of Kotlin 2.4.21, UnifiedPush connector 3.3.5 (3.3.6 is 5 days old) and embedded-fcm-distributor 3.1.0. No DataStore, no Coil: no screen needs them yet. Compose 1.13 needs compileSdk 37.1 in the app (`compileSdkMinor = 1`); the libraries stay on 37.

## Risks / Trade-offs

- [The app code is compiled once with a scratch SDK, never run] → Test later: emulator runs at 360, 600, 840, 1280 dp, a push, each action.
- [`vapid_public_key` is not in the bindings schema] → a loose key survives the merge; task-loop adds it to the zod schema and the sender. Until then no instance registers and Devices shows "Push waits for the computers".
- [Credential add does not work until the integration] → the screen says so; the interface is the seam.
- [The two-pane medium directive is experimental] → one call site; the fallback is the standard directive.
- [A push of an unknown format] → the service shows a generic "AW · a gate needs you" and syncs.
