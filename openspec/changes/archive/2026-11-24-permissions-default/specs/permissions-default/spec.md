## ADDED Requirements

### Requirement: Workspace default for new projects
`tasks/workspace.yaml` SHALL have `new_project_permission_mode` (`default`, `accept_edits` or `skip`; default `default`). A new project SHALL get the `permission_mode` of the add request, else this value. Desktop "Add a project" and `aw project add` SHALL use this rule. `aw project add --permission-mode <mode>` SHALL send the mode of one project. The workspace summary SHALL show the value.

#### Scenario: Skip as the workspace default
- **WHEN** the workspace has `new_project_permission_mode: skip` and a person runs `aw project add billing-api`
- **THEN** `tasks/projects/billing-api/project.yaml` has `permission_mode: skip`

#### Scenario: An explicit mode wins
- **WHEN** the workspace has `new_project_permission_mode: skip` and a person runs `aw project add billing-api --permission-mode default`
- **THEN** the project has `permission_mode: default`

#### Scenario: An older workspace file
- **WHEN** `tasks/workspace.yaml` has no `new_project_permission_mode`
- **THEN** a new project gets `permission_mode: default`

#### Scenario: Existing projects do not change
- **WHEN** a person changes the workspace default to `skip`
- **THEN** the `permission_mode` of each existing project stays the same

### Requirement: Only a person sets the workspace default
`PATCH /v1/workspaces/:ws` SHALL take `name` and `new_project_permission_mode`, both optional, at least one, and SHALL be a person route (403 `refused` for a session caller). `aw workspace edit --new-project-permission-mode <mode>` SHALL be a person command: the CLI, the session deny rules and the AW guard SHALL refuse it in a session.

#### Scenario: A session caller sets skip
- **WHEN** a session caller sends `PATCH /v1/workspaces/:ws` with `new_project_permission_mode: skip`
- **THEN** awd answers 403 `refused` and `tasks/workspace.yaml` does not change

#### Scenario: Empty edit
- **WHEN** a person sends `PATCH /v1/workspaces/:ws` with no field
- **THEN** awd answers 400 `invalid`

### Requirement: Settings section for new projects
Desktop Settings SHALL have a section "New projects" with one menu "Default permissions for new projects" (Default, Accept edits, Skip permissions) for each registered workspace, saved at once. With 2 or more workspaces, each label SHALL name its workspace. "Skip permissions" SHALL show the skip warning. With no workspace, the section SHALL NOT show.

#### Scenario: The person selects skip
- **WHEN** the person selects "Skip permissions" in Settings
- **THEN** the app sends `new_project_permission_mode: skip` for that workspace and shows the skip warning

#### Scenario: Two workspaces
- **WHEN** the workspaces Personal and Acme are registered on this device
- **THEN** Settings shows "Default permissions for new projects · Personal" and "Default permissions for new projects · Acme"
