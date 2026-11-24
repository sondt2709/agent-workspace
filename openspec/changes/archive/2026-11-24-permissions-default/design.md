## Context

The permission mode has 2 levels today: `permission_mode` of `project.yaml` (default `default`) and the `session_options` of a task. A new project always gets `default`. The owner uses "Skip permissions" for most work (decision 38) and must change each project by hand. The desktop Settings page is for "This device"; it has no workspace part. The phone creates no projects. Each write route of the setup is a person route: a session caller gets 403 `refused`.

## Goals / Non-Goals

**Goals:**
- One place where a person sets the mode of each new project.
- The same result on each device of the workspace: desktop "Add a project" and `aw project add` on a server.
- The Permissions menu of New task shows with no scroll; the phone "Create task" shows with no scroll.

**Non-Goals:**
- No change of the modes of existing projects.
- No sandbox for skip sessions (dropped task 17, decision 38).
- No project creation on the phone.

## Decisions

1. **The default is a workspace setting in `tasks/workspace.yaml`, synced.** Field `new_project_permission_mode`, default `default`. Alternative: a device preference in `config.yaml`. Rejected: a project added on ubuntu-01 with `aw project add` would get another mode than one added on the MacBook Pro, and the project file is shared. A workspace setting is visible in an open file and has one value for each device (principle 9).
2. **Only a person sets it.** The value changes only through `PATCH /v1/workspaces/:ws` (a person route) and `aw workspace edit` (a person command in `SETUP_HUMAN_COMMANDS`, so the CLI, the session deny rules and the AW guard refuse it in a session). The AW guard already denies a file edit in a workspace folder. `aw project add` is a person command too. The rule of session-options stays: a project `skip` counts only for a task that a person created.
3. **An explicit mode wins.** `addProject` uses the `permission_mode` of the request, else the workspace default, else `default`. `aw project add --permission-mode <mode>` sends it.
4. **One route for the workspace edit.** `PATCH /v1/workspaces/:ws` takes `name` and `new_project_permission_mode`, both optional, at least one. The operation id becomes `editWorkspace`. `aw workspace rename` stays.
5. **Desktop Settings shows one menu for each workspace** in a section "New projects". Settings has no workspace route, so it does not depend on the last workspace of the session. With 2 or more workspaces, each label names its workspace. The menu saves at once, as Appearance does. "Skip permissions" shows the skip warning.
6. **New task layout.** `SessionOptionsFields` gets `permissions={false}` to leave out the menu; New task renders `PermissionsField` in a row with the assignee, and the Title shares a row with the project. New session and Assign keep the full block.
7. **Phone New task.** The form scrolls in a weighted column; a bottom bar with "Cancel" and "Create task" stays pinned above the keyboard (`imePadding`; the app Scaffold already pads the navigation bar). The enable rule moves to `NewTaskDraft.canCreate` for a JVM test (`ScreenStates` is at the detekt function limit).
8. **Phone task list header.** The project chips scroll in a weighted row; the "New task" button is outside it, so it never scrolls out of the screen.

## Risks / Trade-offs

- [An older awd ignores the new field] → the schema is a loose object; an older awd keeps the field and gives new projects `default`. Phase 1 updates all devices together.
- [Two devices change workspace.yaml at the same time] → the same rule as the rename: the shared file takes the newer write; the setting is rare.
- [A person forgets that new projects skip permissions] → the Settings section, the project Settings and the red chip of each skip task show it.
