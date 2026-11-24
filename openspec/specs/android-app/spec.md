# android-app Specification

## Purpose
The phone app as a remote control (principle 1): the adaptive Compose screens, keyboard and mouse, the phone actions in its own logs, the credential outbox and the push receiver.
## Requirements
### Requirement: Phone screens
The Android app SHALL have the screens Home, Inbox, Tasks, Task detail, New task and Devices, from the phone's own Room index. Home SHALL show "Needs you" first, then the devices with their sync state and a "Sync now" button, then the working and paused tasks. Inbox SHALL list each task in the "Needs you" lane with its gate cards, which the human answers in place. Tasks SHALL group the tasks by stage (Backlog, Discuss, Ready, Implement, Review, Done) and SHALL show a "Paused" chip with the cause on a paused task and on a task whose session device is offline.

Task detail SHALL be the task page of the desktop ("Task detail" of desktop-app) with the same parts in the same order: a header with Back, the key, the project, the state chips, the need-you navigation ("<i> of <n> need you" with Previous and Next, in the Inbox order), "Show list" (only when the task page is 700 dp or wider), the actions menu, the title, and a stage progress bar of 6 segments with the stage name; then the tabs Activity (default), Session, Terminal and Properties. Activity has the gate cards, the description and the key activity. Session has the session summary and the raw thread. Terminal has the newest terminal snapshot. Properties has the fields, the approach versions and the artifacts. From 1,000 dp of task page width, Properties SHALL show in a right panel of 280 dp and the tab row SHALL NOT have the Properties tab. The content of the tabs and the message box SHALL have a maximum width of 840 dp and SHALL be centred. The message box SHALL be below the Activity and Session tabs, with its label above the field and a Send button. The header SHALL scroll with the list, and the tab row SHALL stay at the top of the list, so a short window keeps the list. Each tab SHALL open at its top. Devices SHALL show each device with its role, its presence ("Last heartbeat 8 s ago", offline after 90 s), the sync state of its peer and, for this phone, the engine state and the battery warning for the mode "Restricted" with a link to the setting.

#### Scenario: Gate card in the Inbox
- **WHEN** a task has an open "Answer question" gate with the options "100/min" and "1000/min"
- **THEN** the Inbox shows the task with one button per option and a free-text answer

#### Scenario: Offline device
- **WHEN** the session device of a running task has no heartbeat for more than 90 s
- **THEN** Tasks shows the task with the chip "Paused: <device> offline", and its task detail has the action "Assign to another device…"

#### Scenario: Battery restricted
- **WHEN** the battery mode of the app is "Restricted"
- **THEN** Home and Devices show the warning and a button that opens the app settings

#### Scenario: A gate does not hide behind a tab
- **WHEN** AW-1 has an open gate and the person selects the Session, Terminal or Properties tab
- **THEN** the tab shows "1 item needs you" with "Show in Activity", and "Show in Activity" selects the Activity tab with the gate card

#### Scenario: An answered gate waits for the owner
- **WHEN** the person answered the open gate of AW-1 on the phone and the owner device did not resolve it yet
- **THEN** the Session, Terminal and Properties tabs show no "items need you" line for that gate

#### Scenario: Another task opens on Activity
- **WHEN** the person selected the Session tab of AW-1 and opens AW-2
- **THEN** the task detail of AW-2 shows the Activity tab

#### Scenario: Same header as the desktop
- **WHEN** AW-1 and AW-4 need the person and the person opens AW-1 on a 412 dp phone
- **THEN** the header shows Back, "AW-1", the project, the state chip, "1 of 2 need you" with Previous and Next, the title and the stage bar, and no "Show list"

#### Scenario: Properties panel on a wide window
- **WHEN** the task page is 1220 dp wide on a DeX window
- **THEN** the properties show in a right panel, the tab row is Activity, Session and Terminal, and the Activity content is 840 dp wide and centred

### Requirement: Adaptive layout
The app SHALL select the navigation from the window width class only: compact (< 600 dp) a bottom bar; medium (600 to 839 dp) and expanded (840 to 1199 dp) a rail; large (1200 dp and more) a navigation drawer. Inbox and Tasks SHALL show 1 pane on a compact window and their list with a detail placeholder from medium width. A task SHALL open as the task page in one pane at each width: it SHALL NOT share the window with the task list or a Session pane. The task list SHALL show inside the task page only when the person selects "Show list" and the task page is 700 dp or wider. While the keyboard is open, the message box and the focused field SHALL stay above the keyboard, and on a compact window the bottom bar SHALL hide. AW SHALL own one back stack, so a fold, an unfold or a resize keeps the open item. The manifest SHALL set no orientation, keep `resizeableActivity` at its default, declare the touch screen as not required and set the `configChanges` of `docs/phase-1.md` 10.9.

#### Scenario: Unfold keeps the task
- **WHEN** a task is open on a 360 dp window and the window becomes 840 dp
- **THEN** the same task shows as the task page in one pane

#### Scenario: Width classes
- **WHEN** the window is 599, 600, 839, 840, 1199 or 1200 dp wide
- **THEN** the width class is compact, medium, medium, expanded, expanded or large

#### Scenario: Task on a Fold inner screen
- **WHEN** a task is open on an 840 dp window
- **THEN** the task page uses the full width next to the rail, and no task list shows until the person selects "Show list"

#### Scenario: Keyboard on the phone
- **WHEN** the person taps the message box of AW-1 on a 412 dp phone
- **THEN** the message box shows directly above the keyboard, and the bottom bar hides until the keyboard closes

### Requirement: Keyboard and mouse
Each screen SHALL work with a keyboard and a mouse: Ctrl+N opens New task, Ctrl+R runs "Sync now", Esc closes the open detail or dialog, Enter sends a message or an answer, the arrow keys move the focus in a list. A secondary click on a task row SHALL open the same menu as a long press (Open, Copy task key, Sync now). The app SHALL list the shortcuts in `onProvideKeyboardShortcuts`.

#### Scenario: Esc closes the detail
- **WHEN** the stack is `[Tasks, Task(AW-7)]` and the human presses Esc
- **THEN** the stack is `[Tasks]`

#### Scenario: New task shortcut
- **WHEN** the human presses Ctrl+N on any screen
- **THEN** the New task form opens

### Requirement: Phone actions
Each human action of the phone SHALL write one event to the phone's own log through the event writer of `shared`, then start a targeted scan of the engine and a refresh of the index: a gate answer (`gate.answered` with the gate id and version), a message to a running session (`message.sent` with the session id), a new task (`task.created` with the next free key of the workspace) and an assignment (a human `task.assigned`, also "Assign to another device…" on a paused task). A gate answer that needs a comment ("Request changes", "Reject") SHALL not be sent without one. The card SHALL show "Answer sent, waiting for <owner device>" until the gate is resolved, and SHALL say when the owner device is offline. A message SHALL be refused when the task has no running session. A new task SHALL be refused with the text "The phone does not have workspace.yaml of this workspace yet. Wait for the sync, then try again." while the phone does not know the `key_prefix` of `workspace.yaml`, and the phone SHALL write no `task.rekeyed` in that state, as awd does (`not_ready`); the phone SHALL NOT use a default prefix. "Create task" SHALL be off while a create runs. A change of the project on New task SHALL clear the assignee and the test server. The end of a create or a credential add SHALL close its form only when the form is the top screen.

#### Scenario: Answer from the phone
- **WHEN** the human selects "1000/min" on the card of gate G version 1 of AW-7
- **THEN** the phone log of AW-7 has `gate.answered {gate: G, version: 1, answer: "1000/min"}`, the engine scans that file, and the card shows "Answer sent, waiting for ubuntu-01"

#### Scenario: New task from the phone
- **WHEN** the human creates a task in project `api` with the first message "Add a rate limit" and no assignee, and the highest key is AW-12
- **THEN** the phone writes `task.created` with key AW-13 in a new task folder, and the task shows "Needs you: assign"

#### Scenario: New task before workspace.yaml
- **WHEN** the phone has the task logs but not `tasks/workspace.yaml`, and the human creates a task or the phone has a duplicate key to rekey
- **THEN** the create is refused with the text about workspace.yaml, and the phone writes no event

#### Scenario: Project change on New task
- **WHEN** the human selects project `api`, taps `claude@mac-mini-lab`, then selects project `web`
- **THEN** the assignee is None, and a create sends no assignee

#### Scenario: Request changes needs a comment
- **WHEN** the human selects "Request changes" with an empty comment
- **THEN** the app writes nothing and asks for the comment

### Requirement: Credential outbox
The phone SHALL add or replace a credential without the means to read it: it seals the value with age to the X25519 key of each valid, not revoked computer record through the `CredentialSealer` interface and writes the result to `tasks/devices/<phone>/sealed/<id>.age`. The sealed content SHALL be `{"kind":"sealed-credential","v":1,"name":<name>,"value":<value>}`, so `openCredential()` of `shared/identity` opens it. The value SHALL never go to an event, a log or the index, and SHALL never become a `String` in the sealer; the value array and the content bytes SHALL be cleared after the seal. The Value field SHALL show the value masked and SHALL give accessibility services only the masked text, never the clear value. With no paired computer, the screen SHALL say so and SHALL write nothing. After each index refresh, the phone SHALL remove `tasks/devices/<phone>/sealed/<id>.age` when an applied `credential.imported` event has `from` = this phone and `sealed` = `<id>`, and its device has a computer record that is not revoked. Then it SHALL run the targeted scan, so the delete syncs to each computer. It SHALL keep each other file of the outbox. An error of the removal SHALL be logged and SHALL NOT stop the other work of the snapshot.

#### Scenario: No paired computer
- **WHEN** the human adds a credential on a phone with no computer record
- **THEN** the phone refuses with "No paired computer can get the credential" and writes no file

#### Scenario: Value hidden from accessibility services
- **WHEN** the human types `stg_live_SECRET42` in the Value field
- **THEN** the accessibility tree (uiautomator dump) has the node with `password="true"` and the text `•••••••••••••••••`, not the value

#### Scenario: Sealed file
- **WHEN** the age sealer seals the value of `github-token` to 2 computers
- **THEN** the phone writes one file `tasks/devices/<phone>/sealed/<uuidv7>.age` that each computer identity opens, and no event holds the value

#### Scenario: Sealed file after the import
- **WHEN** `ubuntu-01` writes `credential.imported {name: "staging-api-key", from: "pixel-9", sealed: <id>}` and the phone merges it
- **THEN** the phone removes `tasks/devices/pixel-9/sealed/<id>.age`, keeps the other sealed files, and a second refresh removes nothing

#### Scenario: Import that does not count
- **WHEN** a `credential.imported` names another phone, or a mobile device wrote it
- **THEN** the phone keeps its sealed file

### Requirement: Push receiver
The app SHALL register one UnifiedPush instance per computer and joined workspace (instance name `<workspace id>/<computer>`) for each computer that publishes `vapid_public_key` in its `bindings.yaml`, through the embedded FCM distributor (or another UnifiedPush distributor, for example ntfy), and SHALL write the endpoints, the Web Push keys and the VAPID key of each computer to `tasks/devices/<phone>/push.yaml` of that workspace. The registration SHALL run for every joined workspace, not only the selected one, and SHALL run in the app process also when no screen is open. A new endpoint that arrives in a new app process SHALL use the VAPID key of the existing `push.yaml` entry of that computer, else the key of a reloaded snapshot; an endpoint with no key SHALL be logged as dropped. A failed registration SHALL show "Push is off: the registration failed" on Devices and SHALL NOT be sent again with the same key until the next app open; at each app open the phone SHALL register the failed instances again. A received push SHALL start the sync engine for a short sync and SHALL show a notification with the title "<task key> · <gate name>" and the preview line; a tap SHALL select the workspace of the instance and open the stack `[Inbox, Task(id)]`, or `[Inbox]` for a push with no task. The notification of a gate SHALL go away when the index of the phone shows that gate resolved (its tag is the event id of `gate.opened`). A tap on a push of a workspace that is not on the phone SHALL open only the Inbox and show "This workspace is not on this phone". The activity SHALL read the task and workspace of a tap only from an intent of AW's own notifications (a component that the manifest does not export), never from an intent of another app.

#### Scenario: New endpoint
- **WHEN** the distributor gives a new endpoint for the instance `<ws>/ubuntu-01`
- **THEN** `push.yaml` of that workspace has one subscription for `ubuntu-01` with the endpoint, `p256dh`, `auth` and the VAPID key, and the other subscriptions stay

#### Scenario: Each joined workspace
- **WHEN** the phone has joined Personal and Side projects, Personal is selected, and ubuntu-01 publishes a VAPID key in both
- **THEN** the phone registers `<Personal id>/ubuntu-01` and `<Side projects id>/ubuntu-01`, and each workspace gets its own `push.yaml`

#### Scenario: Endpoint in a new process
- **WHEN** the app process starts for a new endpoint of `<ws>/ubuntu-01` and the snapshot of the workspace is not loaded yet
- **THEN** the phone writes the new endpoint with the VAPID key of the existing `push.yaml` entry

#### Scenario: Failed registration
- **WHEN** the distributor reports a failed registration for `<ws>/ubuntu-01`
- **THEN** Devices shows "Push is off: the registration failed", and the next snapshot refresh does not register that instance again with the same key

#### Scenario: Gate push
- **WHEN** a push with the preview `{task, key: "AW-7", gate_kind: "question", text: "Which limit?"}` arrives
- **THEN** the phone shows the notification "AW-7 · Answer question" with "Which limit?", and the engine syncs

#### Scenario: Push of another workspace
- **WHEN** Personal is selected and the person taps the notification of a gate of Side projects
- **THEN** the app selects Side projects and opens the task in the Inbox stack

#### Scenario: Open task from another app
- **WHEN** another app starts the AW activity with the task and workspace extras
- **THEN** the app opens its last screen and does not select the workspace or open the task

### Requirement: Queue on the phone
The phone SHALL apply the queue rule to its own index: the applied `queue.reordered` events (the newest per agent), the `health.yaml` of each device, the presence and the tasks. A queued task row SHALL show "Queued · 2nd for claude@ubuntu-01" and the cause, and the task detail SHALL have the field "Queue" with the same text.

#### Scenario: Queued row
- **WHEN** AW-4 waits second for `claude@ubuntu-01` with 2 working sessions
- **THEN** its row shows "Queued · 2nd for claude@ubuntu-01" and "2 sessions working"

### Requirement: Terminal section on the phone
The task detail SHALL have a Terminal section with the newest synced snapshot of the task from `tasks/<task>/terminal/`: the screen in a monospace block, "Captured <time> on <device> · <age>", "No terminal snapshot yet" with no file, and the Orca note for an Orca session. The phone SHALL read the files again at each reload of the workspace model, so a new snapshot shows with no new event.

#### Scenario: Snapshot synced
- **WHEN** ubuntu-01 wrote a snapshot of AW-12 and it synced to the phone
- **THEN** the task detail shows its text and "Captured … on ubuntu-01"

### Requirement: Phone gate cards with the full context
A gate card SHALL show each decision of `gate.opened` `data.decisions` with its question, its options and the recommended option marked "Recommended", and SHALL cut the text at the last `\n\n## Decisions\n` when `data.decisions` is not empty. The decisions SHALL follow the rule of the desktop ("Gate cards with the full context" of desktop-app): radio groups with the recommended option picked when the gate has the option "Request changes", the main button "Send my choices" when a pick differs, and the same answer and comment (`GateTexts.decisionsAnswer`, tested against the TypeScript cases). Each decision option SHALL be a row of 48 dp. A long gate text SHALL show its start and "Show more"; "Show more" SHALL show the full text in the list. The task detail SHALL have an Approach section with each version and its state ("Confirmed", "Waits for you", "Replaced", as on the desktop); a version SHALL open to the full text of its synced file. A resolved gate whose newest answer of this phone became a comment, and that the used answer of another device resolved, SHALL show a closed card in the task detail (a gate that a newer version replaced has no used answer and shows no card): "Your answer “X” came after the answer of <device>. It is a comment now." A resolved gate that AW closed with no answer of a person ("Session ended", or "Denied after <n> s") and whose newest answer of this phone became a comment SHALL show the closed card "Your answer “X” came after AW closed the gate: <answer>. It is a comment now."

#### Scenario: Decisions on the phone
- **WHEN** the "Confirm approach" card of AW-12 has 2 decisions
- **THEN** the card shows both as radio groups with the recommended options picked and marked, the button "Confirm", and no "## Decisions" text block

#### Scenario: Send my choices on the phone
- **WHEN** the person picks the other option of the second decision and taps "Send my choices"
- **THEN** the phone sends "Request changes" with the same comment as the desktop for the same picks

#### Scenario: Late answer
- **WHEN** the phone answered "Request changes" and ubuntu-01 resolved the gate with the answer "Confirm" of macbook-pro
- **THEN** the task detail shows "Your answer “Request changes” came after the answer of macbook-pro. It is a comment now."

#### Scenario: Answer to a gate of an ended session
- **WHEN** the phone answered "Allow once" and the owner device closed the gate with "Session ended"
- **THEN** the gate leaves Needs you, and the task detail shows "Your answer “Allow once” came after AW closed the gate: Session ended. It is a comment now."

### Requirement: Artifacts on request
The task detail SHALL have an Artifacts section with each `artifact.added` of the task, its size and its state: "Not on this phone" with "Download", "Downloading…", or "On this phone" with "Open". Download SHALL add the request to `<files>/artifact-requests/<workspace>.txt` and the ignore line of the engine. On a metered network with the switch "Use mobile data for artifacts" off (the default), Download SHALL refuse with "You are on mobile data. Connect to Wi-Fi, or turn on Use mobile data for artifacts." and SHALL add nothing. The switch SHALL be on the Devices screen. The list SHALL show only an `artifact.added` path of the form `artifacts/<device>/<name>`. Open SHALL start `ACTION_VIEW` with a read-only content URI, and only for the types `png jpg jpeg gif webp pdf txt md log json xml csv`; for any other type it SHALL show "AW does not open <name> on the phone: only images, PDF and text files open." and start nothing.

#### Scenario: Download on Wi-Fi
- **WHEN** the phone is on Wi-Fi and the person selects Download on `shot.png`
- **THEN** the file syncs to the phone and the row shows "On this phone" with "Open"

#### Scenario: Mobile data refused
- **WHEN** the phone is on mobile data with the switch off and the person selects Download
- **THEN** the phone shows the refusal and requests nothing

#### Scenario: Mobile data allowed
- **WHEN** the switch is on and the phone is on mobile data
- **THEN** Download requests the file

#### Scenario: Program artifact
- **WHEN** the person selects Open on the downloaded artifact `build.apk`
- **THEN** the phone shows "AW does not open build.apk on the phone: only images, PDF and text files open." and no other app starts

### Requirement: Phone thread window
The Session view SHALL show the newest 500 events of the task, each as a raw row (principle 8): a row for each event type of the contract, and the type name for an unknown type. "Show older" SHALL add the 500 events before them. The Activity tab SHALL use the same window and SHALL say "No activity in the newest <n> events. "Show older" loads more." when the window has events but no Activity row and older events exist.

#### Scenario: Long phone thread
- **WHEN** a task has 600 events
- **THEN** the Session view shows events 101 to 600 and "Show older"

#### Scenario: No event type is dropped
- **WHEN** the thread has one event of each contract event type and one unknown type
- **THEN** the Session view has one row for each of them

### Requirement: Push titles of finished and stopped work
The notification title SHALL come from the preview `kind`: the gate label for `gate`, "Done" for `done`, "Login expired" for `login_expired`, "Login ends soon" for `login_ends`, after the task key ("AW-12 · Done"). A push with no known kind and no gate kind SHALL show "A gate needs you".

#### Scenario: Done push
- **WHEN** a push with `{key: "AW-12", kind: "done", gate_kind: null, text: "Done: Add rate limits"}` arrives
- **THEN** the phone shows "AW-12 · Done" with "Done: Add rate limits"

### Requirement: Phone task activity
The Activity tab of the phone SHALL show the open gate cards, the late answers and the Assign card first; then the first message once as the description, as Markdown; then the activity rows in merge order. The phone SHALL use the Activity rule of the desktop ("Task activity" of desktop-app): one table with an entry for each event type of the contract, tested against the shared fixture `contracts/fixtures/activity/cases.json`, with the same `message.human` rule and the same `session.ended` lines. `task.created` SHALL show as "Created by <by>". An agent message and a person message SHALL show as Markdown; a message longer than 6 lines SHALL show its first 6 lines and "Show more". A subagent report SHALL show as on the desktop, tested against `contracts/fixtures/activity/agent-message.json`. A message row SHALL be a line with a 2 dp coloured edge, as on the desktop, and not a filled card. The Session tab SHALL show the raw text.

#### Scenario: Activity of a task with a session
- **WHEN** the thread of AW-1 has `task.created`, `task.claimed`, `session.started`, a `message.human` with source `first`, a `message.agent`, a `gate.opened` and a `gate.answered`
- **THEN** Activity shows the description once, "Created by human@macbook-pro", the agent message, the gate and the answer, and no claim, session or input row

#### Scenario: Stopped session on the phone
- **WHEN** the person stops the session of AW-1 on ubuntu-01
- **THEN** the phone Activity shows "Session stopped on ubuntu-01: a person stopped it or ended the agent. AW starts no new session until a person starts one."

#### Scenario: Long agent message
- **WHEN** an agent message has 9 lines
- **THEN** Activity shows its first 6 lines and "Show more", and "Show more" shows the 9 lines

#### Scenario: Subagent report on the phone
- **WHEN** the thread has the typed `message.human` of the subagent report fixture
- **THEN** the phone Activity shows "Subagent report · arrived in the terminal" and the report as Markdown

### Requirement: Question details and context on phone gate cards
A phone gate card SHALL show the gate body as Markdown above the choices, clamped to 6 lines with "Show more". A `question` or `reply` gate with no body SHALL show "Context" with the same rule and the same fixture as the desktop (`contracts/fixtures/gates/context.json`), each message as Markdown. When `gate.opened` has `questions`, the card SHALL show each option description, and a gate with 2 or more questions or a multiSelect question SHALL show each question with its options as full-width choices and "Send answers", with the answer text of `contracts/fixtures/gates/questions.json`.

#### Scenario: Context on the phone
- **WHEN** the agent writes its analysis and then asks "Which option? (see the gate message above)" in the same turn
- **THEN** the phone card shows the start of the analysis under "Context" and "Show more"

#### Scenario: Two questions on the phone
- **WHEN** the person picks one option for each of 2 questions and taps "Send answers"
- **THEN** the gate answer is the same text as the desktop sends for the same picks

#### Scenario: Markdown body
- **WHEN** the gate details are "## Options\n\n1. **Queue A**"
- **THEN** the phone card shows a heading and a numbered item with "Queue A" in bold

### Requirement: Pinned action bar of the phone New task
The phone New task SHALL have a bottom action bar with "Create task" and "Cancel" that stays visible while the form scrolls, above the navigation bar and the keyboard. "Create task" SHALL be enabled only with a project, a first message that is not blank, and no create in progress.

#### Scenario: A tall form on a 1080x2220 screen
- **WHEN** the person opens New task on a 1080x2220 phone
- **THEN** "Create task" shows with no scroll

#### Scenario: Blank first message
- **WHEN** the first message is only spaces
- **THEN** "Create task" is disabled

### Requirement: New task button of the task list
The header of the phone task list SHALL show the "New task" button outside the scrolling row of project chips, at the end of the header, at each window size.

#### Scenario: Many projects on a 2560x1600 tablet
- **WHEN** the workspace has more project chips than the header width holds
- **THEN** the chips scroll, and the full "New task" button stays visible

### Requirement: Each desktop field in the phone New task
The phone New task SHALL have each field of the desktop New task: first message, title (blank: the first line of the first message), project, assignee and "Start the agent now" (the default agent of the project on its first device), test server, parent task (open tasks of the project), credentials (chips of the names that the tasks of the workspace use, and a field for another name), and the Session block (Project default and the 3 modes, agent teams, Works in, the absolute folder of the session device). It SHALL use the compact components and keep the pinned "Create task" bar.

#### Scenario: All fields
- **WHEN** the person writes "Add a CSV export", the title "CSV export", picks a parent task and the credentials staging-db and github-token, and taps "Create task"
- **THEN** `task.created` has the title "CSV export", the parent, both credential names and `session_options.permission_mode: skip`

