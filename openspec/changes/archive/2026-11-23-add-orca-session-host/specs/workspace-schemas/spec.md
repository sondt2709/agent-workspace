## ADDED Requirements

### Requirement: Session host fields
`bindings.v1` SHALL have `use_orca` ("Use Orca on this device", default `false`) and an optional `session_host` (`tmux` or `orca`) on each checkout. The data of `task.created` and `task.assigned` SHALL have an optional `session_host` (`tmux` or `orca`) with no default, so an event without it parses as before.

#### Scenario: Old bindings
- **WHEN** the schema `bindings.v1` parses a bindings file with no `use_orca`
- **THEN** the parse gives `use_orca: false`

#### Scenario: Wrong host
- **WHEN** a `task.assigned` event has `session_host: screen`
- **THEN** the parse fails with an issue at the path `data.session_host`
