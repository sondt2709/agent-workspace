## MODIFIED Requirements

### Requirement: Board and List
The Board SHALL show the columns Backlog, Discuss, Ready, Implement, Review and Done, and before them the "Needs you" lane with each task that has a "Needs you" reason. A task SHALL show in one place only: a task in the lane is not in its stage column. A paused task SHALL show a Paused chip with its cause. A queued task SHALL show the chip "Queued · 2nd for claude@ubuntu-01" and its cause. The List SHALL show the same tasks in groups: Needs you, Running, Paused, Queued, Backlog, Done. The renderer SHALL read the queues route again every 10 s. Archived tasks SHALL not show.

#### Scenario: Paused task
- **WHEN** a task in Implement has `paused.cause: device_offline`
- **THEN** its card is in the Implement column with the chip "Paused · device offline"

#### Scenario: Queued task
- **WHEN** AW-4 is second in the queue of `claude@ubuntu-01` with the cause "2 sessions working"
- **THEN** the List shows AW-4 in the group Queued with "Queued · 2nd for claude@ubuntu-01" and "2 sessions working", and the task detail shows the same text

## ADDED Requirements

### Requirement: Queue in the task detail
The task detail of a queued task SHALL show its label and its cause, for example "Queued · 2nd for claude@ubuntu-01 · 2 sessions working".

#### Scenario: Task with open dependencies
- **WHEN** AW-6 waits for AW-3
- **THEN** the task detail shows "Queued for claude@ubuntu-01 · waits for AW-3"
