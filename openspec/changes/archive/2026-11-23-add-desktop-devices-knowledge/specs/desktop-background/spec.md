## ADDED Requirements

### Requirement: Gate notifications
The main process SHALL show a notification for each new open gate (except Approve knowledge change, Approve device and Fix a file), for a task that became done, and for a pause that needs the human. The title SHALL be the task key and the gate label, the id the gate id and the group the task id. Actions: one per option of a question; an inline reply for Reply; "Allow once" for Approve command only when the command fits in 256 bytes; none for other gates. A click SHALL show the window and open the task; an action or a reply SHALL send the answer with the gate version and open no window. A gate that is no longer open SHALL close its notification. The first listing after a start SHALL show nothing, and the app SHALL attach its handlers to the notifications of `Notification.getHistory()`. When notifications are not supported, nothing SHALL be shown.

#### Scenario: Question with options
- **WHEN** a question gate of `AW-3` opens with the options `100/min` and `1000/min`
- **THEN** a notification shows "AW-3 · Answer question" with 2 actions, and the action `100/min` sends that answer with the gate version

#### Scenario: Long command
- **WHEN** an Approve command gate has a command of 300 bytes
- **THEN** its notification has no action, and a click opens the task

### Requirement: Menu bar item
The app SHALL have a menu bar Tray item whose title is the count of tasks that need the person, with a menu that shows the counts of tasks that need the person and of changes not synced, "Sync now", "Open Agent Workspace" and "Quit". The app SHALL not quit when its last window closes.

#### Scenario: Counts
- **WHEN** 2 tasks need the person and 3 changes are not synced
- **THEN** the Tray title is "2" and the menu shows "2 need you" and "3 changes not synced"

### Requirement: Sync before sleep
On `powerMonitor` `suspend` the main process SHALL run Sync now with a timeout of 5 s, best effort.

#### Scenario: Lid closes
- **WHEN** the system suspends
- **THEN** main sends `POST /v1/sync/now` with `timeout_ms` 5000

### Requirement: Open at login
Settings SHALL have "Open at login", which calls `app.setLoginItemSettings`, and SHALL show "Needs approval in System Settings" when the status is `requires-approval`.

#### Scenario: Requires approval
- **WHEN** the login item status is `requires-approval`
- **THEN** Settings shows "Needs approval in System Settings"
