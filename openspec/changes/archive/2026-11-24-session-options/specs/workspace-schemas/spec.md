## ADDED Requirements

### Requirement: Session option fields
`project.yaml` SHALL have `permission_mode` (`default` | `accept_edits` | `skip`, default `default`). `task.created` and `task.assigned` SHALL have an optional `session_options {permission_mode: <mode> | null, agent_teams: boolean, work_in: "worktree" | "checkout" | "folder", folder: <absolute path> | null}`; `folder` SHALL be set only with `work_in: "folder"`. `session.started` SHALL have optional `permission_mode`, `agent_teams` and `work_in`. The event `session.stop_requested {session}` SHALL exist. `pnpm schema:generate` SHALL write the JSON Schemas, the samples and the Kotlin classes.

#### Scenario: Folder with a relative path
- **WHEN** `session_options` has `work_in: "folder"` and `folder: "work/api"`
- **THEN** the schema refuses it at `data.session_options.folder`

#### Scenario: Old event
- **WHEN** a `task.created` has no `session_options`
- **THEN** it is valid
