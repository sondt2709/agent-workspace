# desktop-background Specification

## Purpose
The background parts of the desktop main process: gate notifications with actions, the menu bar Tray item, Sync before sleep and the login item.
## Requirements
### Requirement: Gate notifications
The main process SHALL show a notification for each new open gate (except Approve knowledge change, Approve device and Fix a file), for a task that became done, and for a pause that needs the human. The background load SHALL merge the presence `offline_tasks` and the device names into the tasks, as the renderer does, so a task of a revoked device has the pause `device_revoked`. The title SHALL be the task key and the gate label, or the task key and the shown pause text ("AW-1 · Paused: ubuntu-01 was revoked"); the id `<gate>:v<version>` (or `paused:<task>:<cause>`) and the group the task id, so a gate that opens again with a higher version closes the old notification and shows a new one. Actions: one per option of a question; an inline reply for Reply; "Allow once" for Approve command only when the command fits in 256 bytes; none for other gates. A click SHALL show the window and open the task, also when the window was closed: main SHALL keep the command until the renderer of the new window sends `aw:command-ready` after it subscribes; an action or a reply SHALL send the answer with the gate version and open no window. A gate that is no longer open SHALL close its notification. The first listing of each workspace after a start SHALL show nothing, and the app SHALL attach its handlers to the notifications of `Notification.getHistory()`. A workspace that is not ready, or whose load fails, SHALL keep the tasks of its last load and SHALL never count as empty; a delivered notification with no item SHALL close only after a load of all workspaces. When notifications are not supported, nothing SHALL be shown. When macOS does not show a notification (the `failed` event, for example in an unsigned build), the Notifications card of Settings SHALL say so with the error and name System Settings > Notifications.

#### Scenario: Question with options
- **WHEN** a question gate of `AW-3` opens with the options `100/min` and `1000/min`
- **THEN** a notification shows "AW-3 · Answer question" with 2 actions, and the action `100/min` sends that answer with the gate version

#### Scenario: Gate opens again with a new version
- **WHEN** the question gate of `AW-3` shows with version 2, and the agent opens it again as version 3 with the options `1 min` and `1 h`
- **THEN** the version 2 notification closes, a new one shows the 2 new actions, and the action `1 h` sends that answer with version 3

#### Scenario: Workspace not ready for one load
- **WHEN** workspace A has 3 open gates and awd restarts, so one background load has no tasks of A
- **THEN** no notification closes, and the next load with A shows no notification again

#### Scenario: Long command
- **WHEN** an Approve command gate has a command of 300 bytes
- **THEN** its notification has no action, and a click opens the task

#### Scenario: Task of a revoked device
- **WHEN** the presence lists AW-1 with `device_revoked` for `ubuntu-01` after the first listing
- **THEN** a notification "AW-1 · Paused: ubuntu-01 was revoked" shows with the body "Change the assignee to continue on another device." and no action

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

### Requirement: Assign task notification
The main process SHALL read the `unassigned` tasks of the queues route in its background load, and SHALL show the notification "<key> · Assign task" with the task title for each task that an agent created (`by_agent`). Its id SHALL be `assign:<task id>`, and a click SHALL open the task. A task that a person created SHALL get no notification. The notification SHALL close when the task gets an assignee.

#### Scenario: Agent subtask
- **WHEN** an agent creates AW-5 with no assignee
- **THEN** the notification "AW-5 · Assign task" shows, and a click opens AW-5

#### Scenario: Person task
- **WHEN** a person creates AW-6 with no assignee
- **THEN** no notification shows
