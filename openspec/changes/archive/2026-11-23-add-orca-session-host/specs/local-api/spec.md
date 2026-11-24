## ADDED Requirements

### Requirement: Session host of a new session
`POST .../tasks` and `POST .../tasks/{task}/assign` SHALL accept an optional `session_host` (`tmux` or `orca`) and write it in `task.created` or `task.assigned`. An other value SHALL give 400 `invalid`.

#### Scenario: Assign with Orca
- **WHEN** a client assigns a task to `claude@macbook-pro` with `session_host: orca`
- **THEN** the `task.assigned` event has `session_host: orca`
