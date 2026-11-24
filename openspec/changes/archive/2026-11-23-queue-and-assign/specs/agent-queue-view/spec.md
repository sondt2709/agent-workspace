## ADDED Requirements

### Requirement: Queue rule from the merged files
For each `agent@device`, AW SHALL list the tasks that wait for a session: created, not archived, not done, with that assignee, and with no claim on the device of the assignee. The order SHALL be the order of the newest `queue.reordered` of the agent, then the creation order by HLC. Each task with no open dependency SHALL get a position from 1; a task with open dependencies SHALL follow with no position. awd (TypeScript) and the phone (Kotlin) SHALL use the same rule, and each SHALL pass the cases of `contracts/fixtures/queue/cases.json`.

#### Scenario: Two queued tasks
- **WHEN** `claude@ubuntu-01` has 2 working sessions and AW-3 and AW-4 are assigned to it with no claim
- **THEN** the queue of `claude@ubuntu-01` lists AW-3 at position 1 and AW-4 at position 2

#### Scenario: Reordered queue
- **WHEN** the newest `queue.reordered` of `claude@ubuntu-01` lists AW-4 before AW-3
- **THEN** AW-4 has position 1 and AW-3 position 2

#### Scenario: Open dependency
- **WHEN** AW-6 is assigned to `claude@ubuntu-01` and depends on AW-3, which is not done
- **THEN** AW-6 is in the queue with no position and the cause "waits for AW-3"

### Requirement: Cause of a queued task
Each task with a position SHALL have one cause, checked in this order: the device is revoked ("ubuntu-01 was revoked"); the device is offline by its presence ("ubuntu-01 offline"); the working sessions plus the index of the task reach the maximum ("2 sessions working"); the login of the agent ended ("login of claude ended"); the 5-hour window is above 90 % ("5-hour usage at 93 %"); the disk use is at the limit ("disk 96 % full"); else "starts soon". The working sessions SHALL be the tasks of the agent with a running session on the device, no open gate and no pause. The maximum, the disk limit and the login state SHALL come from the `queue` object of the device `health.yaml`, else 2, 95 and not known.

#### Scenario: Maximum reached
- **WHEN** 2 sessions of `claude@ubuntu-01` work and its health has `max_working: 2`
- **THEN** the cause of each queued task is "2 sessions working"

#### Scenario: Free slot
- **WHEN** 1 session works, the maximum is 2, and 2 tasks are queued
- **THEN** the first task has the cause "starts soon" and the second "2 sessions working"

#### Scenario: Device offline
- **WHEN** the presence shows ubuntu-01 offline
- **THEN** each queued task of `claude@ubuntu-01` has the cause "ubuntu-01 offline"

### Requirement: Queue label
A queued task with a position SHALL have the label "Queued · <ordinal> for <agent@device>" with English ordinals (1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st); a task with no position SHALL have "Queued for <agent@device>".

#### Scenario: Second position
- **WHEN** AW-4 has position 2 in the queue of `claude@ubuntu-01`
- **THEN** its label is "Queued · 2nd for claude@ubuntu-01"
