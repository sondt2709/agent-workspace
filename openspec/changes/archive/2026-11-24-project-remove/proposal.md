## Why

A person cannot remove a project from AW. When a project is linked to the wrong folder, "Add a project" with the same slug fails with `The project <slug> exists`, so the person cannot add it again with the right folder (decision 41, 2026-11-24). Today a maintainer must stop the task, remove the binding, remove the worktree and the branch, and move the folder by hand.

## What Changes

- New person action "Remove the project" in Project settings of the desktop app and `aw project remove <slug> [--yes]`. One service method for the CLI, the local API and the desktop. A session caller gets 403 `refused`.
- A preview names the open tasks and the running sessions of the project before the remove.
- The remove writes one workspace event `project.removed` (with a copy of `project.yaml`) to the log of the device. AW deletes no task folder, log or project file (principle 8).
- The merge (TypeScript and Kotlin) takes the removed project and its tasks out of `projects` and `tasks` of the view, and lists them in the new view fields `removed_projects` and `removed_tasks`. The next free task key also counts the removed tasks.
- Each computer stops its running sessions of the removed tasks, removes its AW worktrees and `aw/<key>` branches that hold no unpushed work, keeps the others and says so, and removes its own checkout of the project from `bindings.yaml`.
- The slug is free at once: "Add a project" with the same slug writes a new `project.yaml` with `added_at`, and the old tasks stay out of the views.
- New optional fields: `project.yaml` `added_at` (HLC), `bindings.yaml` `checkouts[].bound_at` (HLC). New optional `SessionHost.removeWorktree()`.
- The phone shows no removed project or task, and its New task cannot select a removed project.

## Capabilities

### New Capabilities
- `project-remove`: remove a project from AW: the preview, the removal event, the merge rule for 2 devices, the stop of sessions, the cleanup of worktrees, branches and checkouts, the free slug, and the recovery of the files.

### Modified Capabilities
- `workspace-setup`: the Settings page of a project gets a "Remove" section after "Archive".

## Impact

- `shared/schema` (event `project.removed`, fields `added_at` and `bound_at`), generated `contracts/schemas`, `contracts/samples`, Kotlin classes.
- `shared/core` merge (workspace fold, view assembly, next key) and `contracts/fixtures/merge` (new case `project-removed`; each `expected.json` gets 2 empty fields).
- `android/shared` merge (same rule), `android/control` (free key).
- `daemon`: setup service, local API routes (`GET .../projects/{project}/removal`, `POST .../projects/{project}/remove`), `aw project remove`, person commands, session manager (stop and cleanup), `contracts/openapi.yaml`.
- `shared/plugin-api` (optional `removeWorktree`), `plugins/host-orca`.
- `shared/client` setup client; `desktop` Project settings.
- Docs: `docs/phase-1.md`, `docs/architecture.md`, `docs/workflow.md`.
