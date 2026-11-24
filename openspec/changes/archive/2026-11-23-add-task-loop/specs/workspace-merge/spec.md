## MODIFIED Requirements

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
