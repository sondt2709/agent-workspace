## ADDED Requirements

### Requirement: Deterministic merge order
The merge SHALL read each log file of the workspace (`tasks/log/<device>.jsonl`), of each task (`tasks/<task-id>/log/<device>.jsonl`) and of each heartbeat folder. It SHALL order the events by HLC, then device slug, then event id, and SHALL drop and report a second event with the same id. The view SHALL be the same for each read order of the files.

#### Scenario: Any read order
- **WHEN** the merge reads the files of a fixture case in a shuffled order
- **THEN** the view is equal to the view of the sorted order

#### Scenario: Duplicate event id
- **WHEN** 2 lines have the same event id
- **THEN** the merge applies the first one and reports `duplicate_event` for the other

### Requirement: Owner device and claims
The owner device of a task SHALL be the device of the accepted `task.claimed` with the highest epoch, and before a claim, the device of `task.created`. A claim SHALL be accepted only when its `data.device` is its `dev` and its epoch is above each earlier accepted epoch in merge order. A state event (stage, pause, ready, progress, done, learned, released, gate opened or resolved, approach, result, handoff, session and thread message events) SHALL count only when its device is the owner at that point in the order.

#### Scenario: Move to another device
- **WHEN** `macbook-pro` claims a task with epoch 2 after `ubuntu-01` had epoch 1, and `ubuntu-01` then writes a stage change and a comment
- **THEN** the owner is `macbook-pro`, the stage change of `ubuntu-01` is ignored with the reason `not_owner`, and its comment is in the task

#### Scenario: Concurrent claims with the same epoch
- **WHEN** 2 devices write `task.claimed` with epoch 3 while they are offline
- **THEN** the claim that is first in merge order wins on each device, and the other is reported as `stale_claim`

### Requirement: Gate answers
Any device SHALL be able to answer a gate. The owner's `gate.resolved` SHALL decide the used answer. Each other answer to that gate, an answer to an older version and an answer after the resolution SHALL become a comment. For the gate `continue_on_device`, the first answer in merge order SHALL resolve the gate.

#### Scenario: Gate answered twice
- **WHEN** `macbook-pro` and `pixel-9` answer the same gate, and the session device resolves it with the answer of `pixel-9`
- **THEN** the gate is resolved with the answer of `pixel-9`, and the answer of `macbook-pro` is a comment, also when its HLC is earlier

#### Scenario: Answer to an old version
- **WHEN** a device answers version 1 of a gate after version 2 opened
- **THEN** the answer is a comment and the gate stays open

### Requirement: Fields, edits, comments and assignment
`task.edited` SHALL set `title`, `first_message` or `priority`, and the newest edit SHALL win per field. A `first_message` edit after the first session started SHALL be ignored. Comments SHALL be append only. An assignee SHALL count only from a human (`human@<device>`) in `task.created` or `task.assigned`, or, with the project switch "Assign new subtasks to the default device" on, from the owner device of the parent task. The newest accepted assignment SHALL win. A task with no assignee that is not done or archived SHALL have the "Needs you" reason `assign`.

#### Scenario: Agent assigns its own subtask
- **WHEN** an agent writes `task.assigned` for a subtask and the project switch is off
- **THEN** the assignment is ignored with the reason `assignment_not_allowed`, and the task needs the human to assign it

#### Scenario: Newest title wins
- **WHEN** 2 devices edit the title
- **THEN** the title of the edit with the later merge order wins on each device

### Requirement: Task key collisions
When 2 tasks have the same key, the task whose creating device has the higher priority (local, then remote in the order of `workspace.yaml` `device_order`, then mobile) SHALL keep it. Each other task SHALL show the key state `duplicate` and the device that must write `task.rekeyed`, until that device writes it. Only the creating device of a task SHALL rekey it.

#### Scenario: Offline task key collision
- **WHEN** `macbook-pro` and `pixel-9` both create `AW-8` while they are offline
- **THEN** the task of `macbook-pro` keeps `AW-8`, and the task of `pixel-9` shows `AW-8 · duplicate` with `rekey_by: pixel-9`

#### Scenario: Rekeyed task
- **WHEN** `pixel-9` writes `task.rekeyed` from `AW-9` to `AW-10` for its task
- **THEN** the task has the key `AW-10` and no duplicate state

### Requirement: Bounded remote HLC
The merge SHALL hold back each event whose HLC time is more than the skew bound (default 24 hours) after the local clock, and SHALL report it as `future_hlc`. A held event SHALL not count for the last merged HLC. It SHALL join the merge when the local clock comes within the bound.

#### Scenario: Far-future HLC
- **WHEN** a log line has the HLC `2027-11-22T14:00:00.000Z#0000` and the local time is `2026-11-22T14:30:00.000Z`
- **THEN** the event is not in the view, the issues name it, and the last merged HLC is below it

### Requirement: Projections
The view SHALL hold the workspace (document, credential names), the projects, the tasks (fields, stage, pause, open gates, "Needs you" reasons, subtasks, open dependencies, key state, owner, gates and comments), the devices (record, role, priority, bindings, last heartbeat), the queue order per agent (the newest `queue.reordered` wins), the active test slot leases (only from the device that has the resource, with a fencing token that never goes back) and the issues. A function SHALL give the `task.yaml` value of each task.

#### Scenario: Base fixture snapshot
- **WHEN** the merge reads the base fixture folder
- **THEN** the `task.yaml` value of task `AW-7` equals the fixture `task.yaml`

### Requirement: Presence
The merge SHALL mark a device offline when this device received no new heartbeat for 90 seconds. On the first read of a heartbeat file, the receive time SHALL be the earlier of the local time and the heartbeat HLC time; on a later read, the local time of the read. The tasks of an offline owner that are not done, archived or paused SHALL show `device_offline`, and SHALL need the human after 10 minutes.

#### Scenario: Device goes offline
- **WHEN** the last heartbeat of `ubuntu-01` is 4 minutes old and it owns a task in Implement
- **THEN** `ubuntu-01` is offline and the task shows `device_offline`, with "needs the human" false until 10 minutes

### Requirement: Incremental update
The merge engine SHALL read only the new bytes of a log file that grew, SHALL keep a last part with no newline for the next update, and SHALL read a file again when it became shorter or its first or last read bytes changed. The view after incremental updates SHALL equal the view of a full rebuild of the same files, without the presence layer.

#### Scenario: Random appends
- **WHEN** a test appends random events to random files over many updates, with a fixed seed
- **THEN** after each update the view equals the view of a new full merge

#### Scenario: Truncated log
- **WHEN** a log file is replaced by a shorter file
- **THEN** the engine reads the file again, reports `truncated`, and the view equals a full merge

### Requirement: Unknown event types
The merge SHALL keep an event of an unknown type in the index and SHALL not apply it.

#### Scenario: Newer event type
- **WHEN** a task log has an event of type `task.future_thing`
- **THEN** the view is the same as without it, and the index has the event with the reason `unknown_type`
