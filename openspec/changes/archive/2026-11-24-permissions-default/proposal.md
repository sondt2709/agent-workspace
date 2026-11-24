## Why

The owner found no place to set "Skip permissions" as a normal choice (ux-2, decision 38: "Skip permissions is normal"). The mode exists only per project and per task, and the Permissions menu of New task is below the fold. On the phone, "Create task" is below the fold on a 1080x2220 screen (prc-16), and the "New task" button of the task list is cut at 2560x1600 (so-4).

## What Changes

- `tasks/workspace.yaml` gets `new_project_permission_mode` (`default`, `accept_edits`, `skip`; default `default`). It is a shared file, so each device of the workspace uses the same value.
- A new project gets this value as its `permission_mode`: desktop "Add a project" and `aw project add`. `aw project add --permission-mode <mode>` sets the mode of one project. The phone creates no projects.
- `PATCH /v1/workspaces/:ws` takes `new_project_permission_mode` and an optional `name`. The new person command `aw workspace edit --new-project-permission-mode <mode>` sets it. The workspace summary shows the value.
- Desktop Settings: a section "New projects" with the menu "Default permissions for new projects" (Default, Accept edits, Skip permissions) of the shown workspace, with the skip warning.
- Desktop New task: the Permissions menu moves to the top part, next to the assignee. Agent teams and Work in stay in the Session block.
- Phone New task: a pinned action bar with "Create task" and "Cancel", so no scroll is necessary to create a task.
- Phone task list: the "New task" button stays at the end of the header, outside the scrolling project chips.

## Capabilities

### New Capabilities
- `permissions-default`: the workspace default permission mode of new projects, where a person sets it, and who can set it.

### Modified Capabilities
- `session-options`: the place of the Permissions menu in the desktop New task.
- `android-app`: the pinned action bar of the phone New task and the task list header.

## Impact

- `shared/schema` (workspace document), the generated JSON Schemas, samples and Kotlin classes.
- `daemon`: `addProject`, the workspace summary, the setup route and service, the CLI (`aw workspace edit`, `aw project add --permission-mode`), the person command list.
- `shared/client`: the request bodies and the summary view; `contracts/openapi.yaml`.
- `desktop`: Settings, New task, the setup bridge call.
- `android/app`: New task and the task list; `android/control`: the create rule.
- Docs: `docs/phase-1.md` 9.1.7, `docs/design.md` 8.16 and 8.18.
