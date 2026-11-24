## ADDED Requirements

### Requirement: Assign task notification
The main process SHALL read the `unassigned` tasks of the queues route in its background load, and SHALL show the notification "<key> · Assign task" with the task title for each task that an agent created (`by_agent`). Its id SHALL be `assign:<task id>`, and a click SHALL open the task. A task that a person created SHALL get no notification. The notification SHALL close when the task gets an assignee.

#### Scenario: Agent subtask
- **WHEN** an agent creates AW-5 with no assignee
- **THEN** the notification "AW-5 · Assign task" shows, and a click opens AW-5

#### Scenario: Person task
- **WHEN** a person creates AW-6 with no assignee
- **THEN** no notification shows
