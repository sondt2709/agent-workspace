## MODIFIED Requirements

### Requirement: Session option fields
`project.yaml` SHALL have `permission_mode` (`default` | `accept_edits` | `skip`, default `default`). `task.created` and `task.assigned` SHALL have an optional `session_options {permission_mode: <mode> | null, agent_teams: boolean, work_in: "worktree" | "checkout" | "folder", folder: <absolute path> | null, switch_branch: boolean}`; `folder` SHALL be set only with `work_in: "folder"`. `switch_branch` SHALL default to `true`, and SHALL count only with `work_in: "checkout"`. `session.started` SHALL have optional `permission_mode`, `agent_teams` and `work_in`. The event `session.stop_requested {session}` SHALL exist. `pnpm schema:generate` SHALL write the JSON Schemas, the samples and the Kotlin classes.

#### Scenario: Folder with a relative path
- **WHEN** `session_options` has `work_in: "folder"` and `folder: "work/api"`
- **THEN** the schema refuses it at `data.session_options.folder`

#### Scenario: Old event
- **WHEN** a `task.created` has no `session_options`
- **THEN** it is valid

#### Scenario: Old session options
- **WHEN** a `task.created` has `session_options` with no `switch_branch`
- **THEN** the parsed value has `switch_branch: true`

## ADDED Requirements

### Requirement: Checkout state in health
`health.v1` SHALL have an optional `checkouts` list of `{project, has_commit}`: one entry for each checkout of the device in its bindings. `has_commit` SHALL be true only when the checkout is a git repository whose `HEAD` names a commit. A health file of an older awd with no `checkouts` SHALL stay valid.

#### Scenario: Checkout with no commit
- **WHEN** the checkout of `billing-api` on macbook-pro is a git repository with no commit
- **THEN** `tasks/devices/macbook-pro/health.yaml` has `checkouts: [{project: billing-api, has_commit: false}]`
