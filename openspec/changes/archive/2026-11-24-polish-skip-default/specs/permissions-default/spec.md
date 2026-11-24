## MODIFIED Requirements

### Requirement: Workspace default for new projects
`tasks/workspace.yaml` SHALL have `new_project_permission_mode` (`default`, `accept_edits` or `skip`; default `skip`, so a missing value counts as `skip`, owner decision 38). A new project SHALL get the `permission_mode` of the add request, else this value. Desktop "Add a project" and `aw project add` SHALL use this rule. `aw project add --permission-mode <mode>` SHALL send the mode of one project. The workspace summary SHALL show the value. A `project.yaml` with no `permission_mode` SHALL count as `skip`.

#### Scenario: Skip as the workspace default
- **WHEN** the workspace has `new_project_permission_mode: skip` and a person runs `aw project add billing-api`
- **THEN** `tasks/projects/billing-api/project.yaml` has `permission_mode: skip`

#### Scenario: An explicit mode wins
- **WHEN** the workspace has `new_project_permission_mode: skip` and a person runs `aw project add billing-api --permission-mode default`
- **THEN** the project has `permission_mode: default`

#### Scenario: An older workspace file
- **WHEN** `tasks/workspace.yaml` has no `new_project_permission_mode`
- **THEN** a new project gets `permission_mode: skip`

#### Scenario: An older project file
- **WHEN** `project.yaml` of billing-api has no `permission_mode`
- **THEN** the project view has `permission_mode: skip`, and an agent subtask of billing-api still runs with `default`

#### Scenario: Existing projects do not change
- **WHEN** a person changes the workspace default to `skip`
- **THEN** the `permission_mode` of each existing project stays the same
