## ADDED Requirements

### Requirement: Phone screens
The Android app SHALL have the screens Home, Inbox, Tasks, Task detail, New task and Devices, from the phone's own Room index. Home SHALL show "Needs you" first, then the devices with their sync state and a "Sync now" button, then the working and paused tasks. Inbox SHALL list each task in the "Needs you" lane with its gate cards, which the human answers in place. Tasks SHALL group the tasks by stage (Backlog, Discuss, Ready, Implement, Review, Done) and SHALL show a "Paused" chip with the cause on a paused task and on a task whose session device is offline. Task detail SHALL show the fields, the raw thread, the gate cards and a message box. Devices SHALL show each device with its role, its presence ("Last heartbeat 8 s ago", offline after 90 s), the sync state of its peer and, for this phone, the engine state and the battery warning for the mode "Restricted" with a link to the setting.

#### Scenario: Gate card in the Inbox
- **WHEN** a task has an open "Answer question" gate with the options "100/min" and "1000/min"
- **THEN** the Inbox shows the task with one button per option and a free-text answer

#### Scenario: Offline device
- **WHEN** the session device of a running task has no heartbeat for more than 90 s
- **THEN** Tasks shows the task with the chip "Paused: <device> offline", and its task detail has the action "Assign to another device…"

#### Scenario: Battery restricted
- **WHEN** the battery mode of the app is "Restricted"
- **THEN** Home and Devices show the warning and a button that opens the app settings

### Requirement: Adaptive layout
The app SHALL select the layout from the window width class only: compact (< 600 dp) a bottom bar and 1 pane, the detail replaces the list; medium (600 to 839 dp) a rail and 2 panes for Inbox and Tasks; expanded (840 to 1199 dp) a rail with list and detail; large (1200 dp and more) a navigation drawer with list and detail, and for a task a third pane with the thread. AW SHALL own one back stack, so a fold, an unfold or a resize keeps the open item. The manifest SHALL set no orientation, keep `resizeableActivity` at its default, declare the touch screen as not required and set the `configChanges` of `docs/phase-1.md` 10.9.

#### Scenario: Unfold keeps the task
- **WHEN** a task is open on a 360 dp window and the window becomes 840 dp
- **THEN** the same task shows in the detail pane next to the task list

#### Scenario: Width classes
- **WHEN** the window is 599, 600, 839, 840, 1199 or 1200 dp wide
- **THEN** the width class is compact, medium, medium, expanded, expanded or large

### Requirement: Keyboard and mouse
Each screen SHALL work with a keyboard and a mouse: Ctrl+N opens New task, Ctrl+R runs "Sync now", Esc closes the open detail or dialog, Enter sends a message or an answer, the arrow keys move the focus in a list. A secondary click on a task row SHALL open the same menu as a long press (Open, Copy task key, Sync now). The app SHALL list the shortcuts in `onProvideKeyboardShortcuts`.

#### Scenario: Esc closes the detail
- **WHEN** the stack is `[Tasks, Task(AW-7)]` and the human presses Esc
- **THEN** the stack is `[Tasks]`

#### Scenario: New task shortcut
- **WHEN** the human presses Ctrl+N on any screen
- **THEN** the New task form opens

### Requirement: Phone actions
Each human action of the phone SHALL write one event to the phone's own log through the event writer of `shared`, then start a targeted scan of the engine and a refresh of the index: a gate answer (`gate.answered` with the gate id and version), a message to a running session (`message.sent` with the session id), a new task (`task.created` with the next free key of the workspace) and an assignment (a human `task.assigned`, also "Assign to another device…" on a paused task). A gate answer that needs a comment ("Request changes", "Reject") SHALL not be sent without one. The card SHALL show "Answer sent, waiting for <owner device>" until the gate is resolved, and SHALL say when the owner device is offline. A message SHALL be refused when the task has no running session.

#### Scenario: Answer from the phone
- **WHEN** the human selects "1000/min" on the card of gate G version 1 of AW-7
- **THEN** the phone log of AW-7 has `gate.answered {gate: G, version: 1, answer: "1000/min"}`, the engine scans that file, and the card shows "Answer sent, waiting for ubuntu-01"

#### Scenario: New task from the phone
- **WHEN** the human creates a task in project `api` with the first message "Add a rate limit" and no assignee, and the highest key is AW-12
- **THEN** the phone writes `task.created` with key AW-13 in a new task folder, and the task shows "Needs you: assign"

#### Scenario: Request changes needs a comment
- **WHEN** the human selects "Request changes" with an empty comment
- **THEN** the app writes nothing and asks for the comment

### Requirement: Credential outbox
The phone SHALL add or replace a credential without the means to read it: it seals the value to the paired computers through the `CredentialSealer` interface and writes the result to `tasks/devices/<phone>/sealed/<id>.age`. The value SHALL never go to an event, a log or the index. Until a sealer with the device keys exists (identity-pairing), the screen SHALL say that the feature waits for the device keys, and SHALL write nothing.

#### Scenario: No sealer yet
- **WHEN** the human opens "Add credential" with the pending sealer
- **THEN** the screen says that credential add needs the device keys, and the Add button is off

#### Scenario: Sealed file
- **WHEN** a sealer seals the value of `github-token`
- **THEN** the phone writes one file `tasks/devices/<phone>/sealed/<uuidv7>.age` with the sealed bytes and no event holds the value

### Requirement: Push receiver
The app SHALL register one UnifiedPush instance per computer that publishes `vapid_public_key` in its `bindings.yaml`, through the embedded FCM distributor (or another UnifiedPush distributor, for example ntfy), and SHALL write the endpoints, the Web Push keys and the VAPID key of each computer to `tasks/devices/<phone>/push.yaml`. A received push SHALL start the sync engine for a short sync and SHALL show a notification with the title "<task key> · <gate name>" and the preview line; a tap SHALL open the stack `[Inbox, Task(id)]`.

#### Scenario: New endpoint
- **WHEN** the distributor gives a new endpoint for the instance `ubuntu-01`
- **THEN** `push.yaml` has one subscription for `ubuntu-01` with the endpoint, `p256dh`, `auth` and the VAPID key, and the other subscriptions stay

#### Scenario: Gate push
- **WHEN** a push with the preview `{task, key: "AW-7", gate_kind: "question", text: "Which limit?"}` arrives
- **THEN** the phone shows the notification "AW-7 · Answer question" with "Which limit?", and the engine syncs
