## ADDED Requirements

### Requirement: Start failure in the task view
The task view SHALL have `start_failure {device, text, at, retrying}` or null. An applied `comment.added` with `kind: "start_failed"` from an `aw@<device>` writer SHALL set it with that device, the text and the HLC, and `retrying: false`. A later applied person `task.assigned` SHALL set `retrying: true`. A later applied `task.claimed` or `session.started` SHALL set it to null. The TypeScript and the Kotlin folds SHALL give the same value for the shared merge fixtures.

#### Scenario: Failed start
- **WHEN** awd on macbook-pro writes a `start_failed` comment for AW-1
- **THEN** the view of AW-1 has `start_failure {device: "macbook-pro", retrying: false}` with the text of the comment

#### Scenario: Restart, then a claim
- **WHEN** a person assigns AW-1 again, and later macbook-pro claims it
- **THEN** `start_failure.retrying` is true after the assignment, and `start_failure` is null after the claim
