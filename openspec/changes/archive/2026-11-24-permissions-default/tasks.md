## 1. Schema and awd

- [x] 1.1 Add `new_project_permission_mode` to `workspaceV1` in `shared/schema`; run `pnpm schema:generate` and `shared/core/scripts/merge-expected.ts`
- [x] 1.2 `addProject`: take `permission_mode` of the request, else the workspace default; the add body gets `permission_mode`
- [x] 1.3 Workspace summary shows `new_project_permission_mode`
- [x] 1.4 `editWorkspace` service and `PATCH /v1/workspaces/:ws` with `name` and `new_project_permission_mode` (at least one); `pnpm api:generate`
- [x] 1.5 CLI: `aw workspace edit --name --new-project-permission-mode`, a person command; `aw project add --permission-mode`
- [x] 1.6 Unit tests: the add rule, the edit, the empty edit, the 403 of a session caller, the CLI commands

## 2. Desktop

- [x] 2.1 Bridge call `editWorkspace` (contract, channel, main)
- [x] 2.2 Settings section "New projects" with the menu and the skip warning; tests
- [x] 2.3 New task: `PermissionsField` next to the assignee, the Session block without Permissions; tests

## 3. Phone

- [x] 3.1 `NewTaskDraft.canCreate` with a JVM test
- [x] 3.2 New task: pinned action bar with "Create task" and "Cancel"
- [x] 3.3 Task list header: "New task" outside the scrolling chips

## 4. Docs and checks

- [x] 4.1 `docs/phase-1.md` 9.1.7 and `docs/design.md` 8.16, 8.18
- [x] 4.2 Root `task check` on the commit; the result is in the handoff file of task 20
