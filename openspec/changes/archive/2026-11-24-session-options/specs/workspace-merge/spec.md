## ADDED Requirements

### Requirement: Session options in the task fold
The task fold SHALL keep `session_options` of an applied `task.created` or `task.assigned` only when `by` is a person (`human@…`); the newest such event SHALL replace the whole object. An event from another actor SHALL apply as before, with the decision reason `session_options_ignored` when it had options. The task view SHALL have `session_options` (or null), `created_by`, and in `session` the `cwd`, `branch`, `permission_mode`, `agent_teams` and `work_in` of `session.started`. `session.stop_requested` SHALL apply only from a person (else `not_human`). The Kotlin fold SHALL give the same view (merge case `session-options`).

#### Scenario: Agent assignment with options
- **WHEN** the owner device of the parent assigns a subtask with `session_options {permission_mode: "skip"}`
- **THEN** the assignee applies, `session_options` stays null and the reason is `session_options_ignored`

#### Scenario: Person changes the options
- **WHEN** a person assigns the task again with `session_options {permission_mode: "accept_edits"}`
- **THEN** the view has the new object
