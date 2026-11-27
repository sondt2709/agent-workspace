# workspace-merge Specification

## Purpose
The `merge` module of `shared/core`: it turns the per-device logs of an AW folder into one view of the workspace that is the same on each device. It applies the ownership rules, the claims, the task keys, the HLC bound and presence, and updates the view incrementally.
## Requirements
### Requirement: Deterministic merge order
The merge SHALL read each log file of the workspace (`tasks/log/<device>.jsonl`), of each task (`tasks/<task-id>/log/<device>.jsonl`) and of each heartbeat folder. It SHALL order the events by HLC, then device slug, then event id, and SHALL drop and report a second event with the same id: the line with the smaller path, then the smaller line number, wins. The same rule SHALL apply to heartbeat lines. Only the winners SHALL count, also for the last merged HLC and the heartbeat count. The view SHALL be the same for each read order of the files.

#### Scenario: Any read order
- **WHEN** the merge reads the files of a fixture case in a shuffled order
- **THEN** the view is equal to the view of the sorted order

#### Scenario: Duplicate event id
- **WHEN** 2 lines have the same event id
- **THEN** the merge applies the first one and reports `duplicate_event` for the other

#### Scenario: Duplicate id in another file, read first
- **WHEN** the engine merged a workspace log line, and a task log line with the same id, a smaller path and an earlier HLC arrives later
- **THEN** the task line replaces the workspace line, the workspace log folds again, the last merged HLC drops the HLC of the workspace line, and the view equals a full merge in each read order

### Requirement: Owner device and claims
The owner device of a task SHALL be the device of the accepted `task.claimed` with the highest epoch, and before a claim, the device of `task.created`. A claim SHALL be accepted only when its `data.device` is its `dev`, its `dev` is the device of the current assignee (`agent@device`, the newest accepted assignment before the claim in merge order), and its epoch is above each earlier accepted epoch in merge order. A claim of a task with no assignee SHALL be ignored. A claim from another device than the assignee's SHALL be ignored with the reason `not_assignee_device`, and SHALL not change the owner. The merge SHALL never move a task by itself: only a human `task.assigned` (or, with the project switch on, the owner of the parent) changes the device that can claim. `TaskView.moving_to` SHALL be the device of the assignee when an accepted claim exists and its device is another device, else null. A state event (stage, pause, ready, progress, done, learned, released, gate opened or resolved, proposal, result, handoff, session and thread message events) SHALL count only when its device is the owner at that point in the order.

#### Scenario: Move to another device
- **WHEN** a human assigns a task of `ubuntu-01` (claim epoch 1) to `claude@macbook-pro`, `macbook-pro` claims it with epoch 2, and `ubuntu-01` then writes a stage change and a comment
- **THEN** the owner is `macbook-pro`, the stage change of `ubuntu-01` is ignored with the reason `not_owner`, and its comment is in the task

#### Scenario: Moving until the new claim
- **WHEN** `ubuntu-01` claimed a task and a human then assigns it to `claude@macbook-pro`
- **THEN** `moving_to` is `macbook-pro` until `macbook-pro` claims the task, and then null

#### Scenario: Concurrent claims with the same epoch
- **WHEN** the device of the assignee writes 2 `task.claimed` with the same epoch from 2 sessions (for example after a restart with an old view)
- **THEN** the claim that is first in merge order wins on each device, and the other is reported as `stale_claim`

#### Scenario: Claim from a device that is not the assignee's
- **WHEN** a human assigned a task to `claude@macbook-pro`, and `ubuntu-01` writes `task.claimed` with epoch 1 and an automatic `task.assigned`
- **THEN** the claim is ignored with the reason `not_assignee_device`, the `task.assigned` is ignored with the reason `assignment_not_allowed`, the owner stays the creating device, and the assignee stays `claude@macbook-pro`

#### Scenario: Claim with no assignee
- **WHEN** a device claims a task that has no assignee
- **THEN** the claim is ignored with the reason `not_assignee_device`

#### Scenario: Laptop wakes after a move
- **WHEN** a human assigned a task of `macbook-pro` to `claude@ubuntu-01`, `ubuntu-01` claimed it with epoch 2, and `macbook-pro` then writes a claim with epoch 3, a `comment.added` with the name of its pushed branch and a `message.agent`
- **THEN** the owner stays `ubuntu-01`, the claim is ignored with the reason `not_assignee_device`, the comment is in the task, and the `message.agent` is ignored with the reason `not_owner`

### Requirement: Gate answers
Any device SHALL be able to answer a gate. Only the owner SHALL open or resolve a gate, for each gate kind. The owner's `gate.resolved` SHALL decide the used answer. Each other answer to that gate, an answer to an older version and an answer after the resolution SHALL become a comment. A resolved `approve_proposal` gate (or `confirm_approach` from before the rename) SHALL approve a proposal version only when the `gate.resolved` answer starts with `approve` or `confirm`, in any letter case (the answer text of the "Approve" option, or "Confirm" of an old gate); it SHALL approve the version of the gate file `proposal/v<n>.md` or `approach/v<n>.md`, or the latest proposed version when the gate has no such file. Both ports SHALL use this exact rule.

#### Scenario: Gate answered twice
- **WHEN** `macbook-pro` and `pixel-9` answer the same gate, and the session device resolves it with the answer of `pixel-9`
- **THEN** the gate is resolved with the answer of `pixel-9`, and the answer of `macbook-pro` is a comment, also when its HLC is earlier

#### Scenario: Answer to an old version
- **WHEN** a device answers version 1 of a gate after version 2 opened
- **THEN** the answer is a comment and the gate stays open

#### Scenario: Approve and the old Confirm
- **WHEN** the owner resolves an `approve_proposal` gate of `proposal/v6.md` with "Approve", and a `confirm_approach` gate of `approach/v2.md` of another task with "Confirm"
- **THEN** the first task has the approved version 6 and the second task the approved version 2

#### Scenario: Gate of another device
- **WHEN** a device that is not the owner opens a gate, and a human answers it
- **THEN** the `gate.opened` is ignored with the reason `not_owner`, and the answer is a comment with the reason `gate_unknown`

### Requirement: Fields, edits, comments and assignment
`task.edited` SHALL set `title`, `first_message` or `priority`, and the newest edit SHALL win per field. A `first_message` edit after the first session started SHALL be ignored. Comments SHALL be append only. An assignee SHALL count only from a human (`human@<device>`) in `task.created` or `task.assigned`, or, with the project switch "Assign new subtasks to the default device" on, from the owner device of the parent task for the FIRST assignment of the subtask only (the task has no assignee yet). A later assignment of an agent SHALL be ignored with the reason `assignment_not_allowed`. The newest accepted assignment SHALL win. A task with no assignee that is not done or archived SHALL have the "Needs you" reason `assign`. Each open gate of a task that is not done or archived SHALL be a "Needs you" reason `gate`; an open gate of a done or archived task SHALL stay in `needs_you` and `gates`, but SHALL not put the task in the "Needs you" lane.

#### Scenario: Archived task with an open gate
- **WHEN** a human archives a task while its `question` gate is open
- **THEN** the gate stays open in the task, and the task has no "Needs you" reason and `needs_you_lane: false`

#### Scenario: Agent assigns its own subtask
- **WHEN** an agent writes `task.assigned` for a subtask and the project switch is off
- **THEN** the assignment is ignored with the reason `assignment_not_allowed`, and the task needs the human to assign it

#### Scenario: Switch sets only the first assignment
- **WHEN** the project switch is on, the subtask AW-22 got `claude@ubuntu-01` from the owner of its parent, and the same device later writes `task.assigned` `claude@macbook-pro` as the agent
- **THEN** the second assignment is ignored with `assignment_not_allowed`, and the assignee stays `claude@ubuntu-01`

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
The view SHALL hold the workspace (document, credential names), the projects, the tasks (fields, stage, pause, open gates, "Needs you" reasons, subtasks, open dependencies, key state, owner, gates and comments), the devices (record, role, priority, bindings, last heartbeat), the queue order per agent (the newest `queue.reordered` wins), the test slot leases (only from the device that has the resource, with a fencing token that never goes back) and the issues. The view SHALL keep a lease until `slot.released` or `slot.revoked`, with `expires_at` (the HLC time of the last acquire or renew plus the TTL): the view does not read the clock, so each reader SHALL treat a lease with `expires_at` before its own time as expired (for example `find("slots", {expires_at: {$gt: now}})`). A function SHALL give the `task.yaml` value of each task.

#### Scenario: Base fixture snapshot
- **WHEN** the merge reads the base fixture folder
- **THEN** the `task.yaml` value of task `AW-7` equals the fixture `task.yaml`

### Requirement: Presence
The merge SHALL mark a device offline when this device received no new heartbeat for 90 seconds. On the first read of a heartbeat file (a new engine or `rebuild()`), the receive time SHALL be the earlier of the local time and the heartbeat HLC time; on a later read, the local time of the read. `rebuild()` SHALL forget the receive times. The claimed tasks of an offline owner (the claim device is the owner) that are not done, archived or paused SHALL show `device_offline`. The task SHALL wait: presence SHALL not open a gate, move the task or put it in the "Needs you" lane, also after a long time offline. A task that is not done and not archived, whose device (the device of the assignee, else the device of the claim) has a kept record with `revoked: true`, SHALL show `device_revoked` with the device and the time of `revoked_at`, also when the task has its own pause. This row SHALL replace a `device_offline` row of the task. The TypeScript and the Kotlin merge SHALL give the same presence.

#### Scenario: Device goes offline
- **WHEN** the last heartbeat of `ubuntu-01` is 4 minutes old and it owns a task in Implement
- **THEN** `ubuntu-01` is offline and the task shows `device_offline`

#### Scenario: Device offline for a long time
- **WHEN** `ubuntu-01` is offline for 2 hours and owns a task in Implement
- **THEN** the task still shows only `device_offline`, its owner and assignee do not change, and it has no "Needs you" reason from presence

#### Scenario: Device revoked
- **WHEN** the record of `ubuntu-01` is revoked at 14:20:00 and `ubuntu-01` holds the claim of a task in Implement assigned to `claude@ubuntu-01`
- **THEN** `offline_tasks` has the task with the cause `device_revoked`, the device `ubuntu-01` and the time `2026-11-22T14:20:00.000Z`

#### Scenario: Task assigned to another device
- **WHEN** the person assigned the task of revoked `ubuntu-01` to `claude@macbook-pro`
- **THEN** the task has no `device_revoked` row

#### Scenario: Merge case device-revoked
- **WHEN** the TypeScript and the Kotlin engine merge `contracts/fixtures/merge/device-revoked`
- **THEN** both presences equal `expected.json`, with one `device_revoked` row for the task of ubuntu-01

### Requirement: Incremental update
The merge engine SHALL read only the new bytes of a log file that grew, SHALL keep a last part with no newline for the next update, and SHALL read a file again when it became shorter or its first or last read bytes changed. The view after incremental updates SHALL equal the view of a full rebuild of the same files, without the presence layer. One log or document that cannot be read (for example EACCES or EIO) SHALL NOT fail the update: the update SHALL go on with the other files, the file SHALL keep its last read events or value and give the issue `read_error`, the engine SHALL then forget each read event and document text, and the next update SHALL read all files again, so no event is lost and the issue goes when a read works (final check review M1; the phone does the same). The calls of `update()` and `rebuild()` SHALL run one at a time.

#### Scenario: Random appends
- **WHEN** a test appends random events to random files over many updates, with a fixed seed
- **THEN** the view equals the view of a new full merge at each 4th update and at the last update

#### Scenario: Truncated log
- **WHEN** a log file is replaced by a shorter file
- **THEN** the engine reads the file again, reports `truncated`, and the view equals a full merge

#### Scenario: Failed read
- **WHEN** an update read new lines of one log, and the read of another log fails (for example `EIO`)
- **THEN** the update rejects with the error, the engine forgets each read, and the next update reads all files again and equals a full merge

#### Scenario: Overlapping updates
- **WHEN** 2 calls of `update()` start at the same time
- **THEN** they run one after the other, no line is read twice, and no `duplicate_event` or `truncated` notice appears

### Requirement: Last valid document
A document that fails its schema SHALL keep its last valid value in the view and SHALL be reported as `bad_document`. The value SHALL stay after `rebuild()`, and after a restart when the engine gets the documents of the index (`lastValid`). A device that never read a valid version SHALL have no value for the document.

#### Scenario: Bad workspace.yaml
- **WHEN** `workspace.yaml` gets a `device_order` that fails its schema, then the engine rebuilds, then awd restarts with the documents of the index
- **THEN** each view has the last valid `workspace.yaml` and the issue `bad_document`, and each index has the same rows

### Requirement: Unknown event types
The merge SHALL keep an event of an unknown type in the index and SHALL not apply it.

#### Scenario: Newer event type
- **WHEN** a task log has an event of type `task.future_thing`
- **THEN** the view is the same as without it, and the index has the event with the reason `unknown_type`

### Requirement: Revoked devices
A device record with `revoked: true` and `revoked_at` SHALL stop the events of that device: the task fold and the workspace fold SHALL not apply an event whose device is the revoked device and whose HLC sorts after `revoked_at`, with the reason `device_revoked`. Its earlier events, its heartbeats and its comments before `revoked_at` SHALL stay. A change of a device record SHALL fold each task and the workspace log again, so the incremental update and a full read give the same view.

#### Scenario: Merge case device-revoked
- **WHEN** the engine merges `contracts/fixtures/merge/device-revoked` (the fixture folder with the record of ubuntu-01 revoked at 14:20:00)
- **THEN** the view equals `expected.json` for each read order, the task progress, the agent message and the slot release of ubuntu-01 after 14:20:00 have the reason `device_revoked`, and its earlier events are applied

### Requirement: Device record check in the merge
The engine SHALL take an optional check of device records. With the check, a record that fails SHALL be the issue `bad_document` with the reason `bad_signature`, and a valid record with a lower `seq` than the kept record SHALL be the reason `old_sequence`; the kept record SHALL stay in both cases. With the check, a revoke SHALL be final: a valid record without `revoked: true` after a kept revoke SHALL be the reason `old_sequence`, and a kept revoke whose file is removed SHALL stay with the issue reason `revoke_removed` (also after a restart with the index documents). Without the check, the engine SHALL use each record that passes its schema.

#### Scenario: Check refuses a record
- **WHEN** the check refuses the new text of `tasks/devices/ubuntu-01/device.yaml`
- **THEN** the view has the earlier record of ubuntu-01 and the issue `bad_document` with the reason `bad_signature`

#### Scenario: Revoke file removed or replaced
- **WHEN** the revoke record of ubuntu-01 is removed, then its old valid record with `seq` 1 is written back
- **THEN** the view keeps the revoke (`seq` 2), the issues have the reasons `revoke_removed` and then `old_sequence`, and the events of ubuntu-01 after `revoked_at` stay `device_revoked`

### Requirement: Session options in the task fold
The task fold SHALL keep `session_options` of an applied `task.created` or `task.assigned` only when `by` is a person (`human@…`); the newest such event SHALL replace the whole object. An event from another actor SHALL apply as before, with the decision reason `session_options_ignored` when it had options. The task view SHALL have `session_options` (or null), `created_by`, and in `session` the `cwd`, `branch`, `permission_mode`, `agent_teams` and `work_in` of `session.started`. `session.stop_requested` SHALL apply only from a person (else `not_human`). The Kotlin fold SHALL give the same view (merge case `session-options`).

#### Scenario: Agent assignment with options
- **WHEN** the owner device of the parent assigns a subtask with `session_options {permission_mode: "skip"}`
- **THEN** the assignee applies, `session_options` stays null and the reason is `session_options_ignored`

#### Scenario: Person changes the options
- **WHEN** a person assigns the task again with `session_options {permission_mode: "accept_edits"}`
- **THEN** the view has the new object

### Requirement: Regular files only
The merge SHALL read only regular files as sources. A folder or a symbolic link with the name of a log or a document SHALL be no source, and the merge SHALL go on with the other sources (final check fc1-4).

#### Scenario: A folder with the name of a log
- **WHEN** another device syncs an empty folder `tasks/log/pixel-9.jsonl/`
- **THEN** each merge update succeeds and the view keeps the events of the other logs

### Requirement: Start failure in the task view
The task view SHALL have `start_failure {device, text, at, retrying}` or null. An applied `comment.added` with `kind: "start_failed"` from an `aw@<device>` writer SHALL set it with that device, the text and the HLC, and `retrying: false`. A later applied person `task.assigned` SHALL set `retrying: true`. A later applied `task.claimed` or `session.started` SHALL set it to null. The TypeScript and the Kotlin folds SHALL give the same value for the shared merge fixtures.

#### Scenario: Failed start
- **WHEN** awd on macbook-pro writes a `start_failed` comment for AW-1
- **THEN** the view of AW-1 has `start_failure {device: "macbook-pro", retrying: false}` with the text of the comment

#### Scenario: Restart, then a claim
- **WHEN** a person assigns AW-1 again, and later macbook-pro claims it
- **THEN** `start_failure.retrying` is true after the assignment, and `start_failure` is null after the claim

