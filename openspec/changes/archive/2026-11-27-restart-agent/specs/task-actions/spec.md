## ADDED Requirements

### Requirement: Restart agent
The desktop task page and the phone task screen SHALL show "Did not start on <device>: <cause>" when the task view has `start_failure` with `retrying: false`, and "Starting again on <device>…" with `retrying: true`, in place of the queue chip. The cause SHALL be the text of the comment after "The session did not start on <device>: ". The action "Restart agent" SHALL show when the task has an assignee and no running session. It SHALL write a person `task.assigned` with the same assignee, with no `session_options` and no `session_host`, so the task keeps its options and its host choice.

#### Scenario: Restart from the desktop
- **WHEN** AW-1 has `start_failure` and the person clicks "Restart agent" on the task page
- **THEN** the app sends the assignment of `claude@macbook-pro` with no options, and the header shows "Starting again on macbook-pro…"

#### Scenario: Running session
- **WHEN** a session of AW-1 runs
- **THEN** the task page shows no "Restart agent"

#### Scenario: Restart from the phone
- **WHEN** the person taps "Restart agent" on the phone
- **THEN** the phone writes a person `task.assigned` with the same assignee and no options
