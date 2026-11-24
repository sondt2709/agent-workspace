## MODIFIED Requirements

### Requirement: Owner device and claims
The owner device of a task SHALL be the device of the accepted `task.claimed` with the highest epoch, and before a claim, the device of `task.created`. A claim SHALL be accepted only when its `data.device` is its `dev`, its `dev` is the device of the current assignee (`agent@device`, the newest accepted assignment before the claim in merge order), and its epoch is above each earlier accepted epoch in merge order. A claim of a task with no assignee SHALL be ignored. A claim from another device than the assignee's SHALL be ignored with the reason `not_assignee_device`, and SHALL not change the owner. The merge SHALL never move a task by itself: only a human `task.assigned` (or, with the project switch on, the owner of the parent) changes the device that can claim. `TaskView.moving_to` SHALL be the device of the assignee when an accepted claim exists and its device is another device, else null. A state event (stage, pause, ready, progress, done, learned, released, gate opened or resolved, approach, result, handoff, session and thread message events) SHALL count only when its device is the owner at that point in the order.

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
Any device SHALL be able to answer a gate. Only the owner SHALL open or resolve a gate, for each gate kind. The owner's `gate.resolved` SHALL decide the used answer. Each other answer to that gate, an answer to an older version and an answer after the resolution SHALL become a comment. A resolved `confirm_approach` gate SHALL confirm an approach version only when the `gate.resolved` answer starts with `confirm`, in any letter case (the answer text of the "Confirm" option); it SHALL confirm the version of the gate file `approach/v<n>.md`, or the latest proposed version when the gate has no such file. Both ports SHALL use this exact rule.

#### Scenario: Gate answered twice
- **WHEN** `macbook-pro` and `pixel-9` answer the same gate, and the session device resolves it with the answer of `pixel-9`
- **THEN** the gate is resolved with the answer of `pixel-9`, and the answer of `macbook-pro` is a comment, also when its HLC is earlier

#### Scenario: Answer to an old version
- **WHEN** a device answers version 1 of a gate after version 2 opened
- **THEN** the answer is a comment and the gate stays open

#### Scenario: Gate of another device
- **WHEN** a device that is not the owner opens a gate, and a human answers it
- **THEN** the `gate.opened` is ignored with the reason `not_owner`, and the answer is a comment with the reason `gate_unknown`

### Requirement: Presence
The merge SHALL mark a device offline when this device received no new heartbeat for 90 seconds. On the first read of a heartbeat file (a new engine or `rebuild()`), the receive time SHALL be the earlier of the local time and the heartbeat HLC time; on a later read, the local time of the read. `rebuild()` SHALL forget the receive times. The claimed tasks of an offline owner (the claim device is the owner) that are not done, archived or paused SHALL show `device_offline`. The task SHALL wait: presence SHALL not open a gate, move the task or put it in the "Needs you" lane, also after a long time offline.

#### Scenario: Device goes offline
- **WHEN** the last heartbeat of `ubuntu-01` is 4 minutes old and it owns a task in Implement
- **THEN** `ubuntu-01` is offline and the task shows `device_offline`

#### Scenario: Device offline for a long time
- **WHEN** `ubuntu-01` is offline for 2 hours and owns a task in Implement
- **THEN** the task still shows only `device_offline`, its owner and assignee do not change, and it has no "Needs you" reason from presence
