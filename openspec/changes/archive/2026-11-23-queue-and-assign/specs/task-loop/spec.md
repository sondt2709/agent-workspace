## MODIFIED Requirements

### Requirement: Gate push and reminders
The owner device of a task SHALL send a push for each gate as the gate table of `docs/workflow.md` 3 says (at the open, and the reminders at 1 h and 24 h, or 24 h only), "Assign task" and its 24 h reminder only for a task that an agent created, no push for "Approve knowledge change", and one push when a task is Done. Each push SHALL be sent at most once, also over an awd restart.

#### Scenario: Reminder after 1 h
- **WHEN** a question gate is open for 1 h
- **THEN** the owner sends one reminder push for it, and no second one at the next check

#### Scenario: Person task with no assignee
- **WHEN** a person created AW-30 with no assignee 24 h ago
- **THEN** the owner sends no "Assign task" push and no reminder for AW-30
