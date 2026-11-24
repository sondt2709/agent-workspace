## ADDED Requirements

### Requirement: Session host option
`aw task create` and `aw task assign` SHALL accept `--host tmux|orca` and send it as `session_host`. An other value SHALL give exit code 2.

#### Scenario: Create in Orca
- **WHEN** a person runs `aw task create --project billing-api --title T --first-message x --assignee claude@macbook-pro --host orca`
- **THEN** the `task.created` event has `session_host: orca`
