# task-actions Specification

## Purpose
The task actions of a person: stop the session of a task on any device, archive and unarchive a task, from the CLI, the local API, the desktop and the phone.
## Requirements
### Requirement: Event task.unarchived
`@aw/schema` SHALL have the task event `task.unarchived` with the data `{}`. The merge (TypeScript and Kotlin) SHALL set `archived` to true at `task.archived` and to false at `task.unarchived`, in merge order, from each device.

#### Scenario: The newest event wins
- **WHEN** a task log has `task.archived` and then `task.unarchived` in merge order
- **THEN** the task view has `archived: false`

#### Scenario: Archive again
- **WHEN** a task log has `task.archived`, `task.unarchived` and `task.archived` in merge order
- **THEN** the task view has `archived: true`

### Requirement: Stop the session of a task
awd SHALL have one service method `stopTaskSession(task)` for the CLI `aw task stop <task>`, the person route `POST /v1/workspaces/:ws/tasks/:task/stop` and the desktop. It SHALL write the person event `session.stop_requested {session}` for the running session of the task, on each device. With no running session it SHALL refuse with `conflict`. The session device SHALL stop the session with the reason `stopped`.

#### Scenario: Session on another device
- **WHEN** a person stops the session of AW-7 that runs on ubuntu-01 from the MacBook Pro
- **THEN** awd writes `session.stop_requested` with the session id, and ubuntu-01 stops the session

#### Scenario: No session
- **WHEN** a person stops a task with no running session
- **THEN** awd replies `conflict` "No session runs for AW-7."

### Requirement: Archive and unarchive a task
awd SHALL have the service methods `archiveTask(task, {stop})` and `unarchiveTask(task)` for the CLI, the person routes and the desktop. `archiveTask` SHALL refuse with `conflict` when a session runs and `stop` is not true, and the message SHALL name the device and the command `aw task archive <key> --stop`. With `stop`, it SHALL write `session.stop_requested` first and then `task.archived`. It SHALL refuse an archived task with `conflict`. `unarchiveTask` SHALL write `task.unarchived`, and SHALL refuse a task that is not archived with `conflict`. A session caller SHALL get a refusal for each of these commands and routes.

#### Scenario: Archive with a running session and no stop
- **WHEN** a person runs `aw task archive AW-7` and a session runs on ubuntu-01
- **THEN** the command fails with `conflict`, names ubuntu-01 and tells the person to use `--stop`

#### Scenario: Archive with stop
- **WHEN** a person runs `aw task archive AW-7 --stop` and a session runs
- **THEN** awd writes `session.stop_requested` and then `task.archived`

#### Scenario: Unarchive
- **WHEN** a person runs `aw task unarchive AW-7` on an archived task
- **THEN** awd writes `task.unarchived` and the task shows on the Board again

### Requirement: Session of an archived task
The session device SHALL stop a running session of an archived task with the reason `stopped`. After an unarchive, AW SHALL NOT start a new session until a person starts one.

#### Scenario: Unarchive does not start a session
- **WHEN** a person archives a task with a running session and then unarchives it
- **THEN** the session ended with the reason `stopped`, and no new session starts

### Requirement: Task actions menu in the apps
The task header of the desktop and of the phone SHALL have a "⋯" menu with "Stop session…" while a session runs on any device, "Archive task…" for a task that is not archived, and "Unarchive task" for an archived task. "Stop session…" SHALL open a confirm that names the session device. "Archive task…" SHALL open one confirm; with a running session, the confirm SHALL name the device and say that AW stops the session first. The desktop Session summary SHALL NOT have its own Stop button. The desktop List and the phone Tasks list SHALL show the archived tasks in a group "Archived" after "Done"; the desktop group SHALL be closed at the start and each of its rows SHALL have "Unarchive". The Activity of both apps SHALL show `task.unarchived` as "Unarchived".

#### Scenario: Desktop stop on another device
- **WHEN** a person selects "Stop session…" for a session on ubuntu-01 and confirms
- **THEN** the desktop calls `stopTaskSession` and awd writes `session.stop_requested`

#### Scenario: Phone archive with a running session
- **WHEN** a person selects "Archive task…" on the phone while a session runs, and confirms
- **THEN** the phone writes `session.stop_requested` and then `task.archived`
