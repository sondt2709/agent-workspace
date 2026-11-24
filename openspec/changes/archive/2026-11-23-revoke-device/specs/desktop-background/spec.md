## MODIFIED Requirements

### Requirement: Gate notifications
The main process SHALL show a notification for each new open gate (except Approve knowledge change, Approve device and Fix a file), for a task that became done, and for a pause that needs the human. The background load SHALL merge the presence `offline_tasks` and the device names into the tasks, as the renderer does, so a task of a revoked device has the pause `device_revoked`. The title SHALL be the task key and the gate label, or the task key and the shown pause text ("AW-1 · Paused: ubuntu-01 was revoked"); the id the gate id (or `paused:<task>:<cause>`) and the group the task id. Actions: one per option of a question; an inline reply for Reply; "Allow once" for Approve command only when the command fits in 256 bytes; none for other gates. A click SHALL show the window and open the task; an action or a reply SHALL send the answer with the gate version and open no window. A gate that is no longer open SHALL close its notification. The first listing after a start SHALL show nothing, and the app SHALL attach its handlers to the notifications of `Notification.getHistory()`. When notifications are not supported, nothing SHALL be shown.

#### Scenario: Question with options
- **WHEN** a question gate of `AW-3` opens with the options `100/min` and `1000/min`
- **THEN** a notification shows "AW-3 · Answer question" with 2 actions, and the action `100/min` sends that answer with the gate version

#### Scenario: Long command
- **WHEN** an Approve command gate has a command of 300 bytes
- **THEN** its notification has no action, and a click opens the task

#### Scenario: Task of a revoked device
- **WHEN** the presence lists AW-1 with `device_revoked` for `ubuntu-01` after the first listing
- **THEN** a notification "AW-1 · Paused: ubuntu-01 was revoked" shows with the body "Change the assignee to continue on another device." and no action
