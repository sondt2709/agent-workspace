## Why

A person must be able to stop a task and the agent of that task (fix list ux-3). Today the desktop has "Stop session" only in the Session tab, only for a session on this Mac, and with no confirm. No app can archive a task, and no one can unarchive a task. Principle 1 says that each human action works from the phone.

## What Changes

- A task header menu "⋯" on the desktop and the phone with "Stop session…", "Archive task…" and "Unarchive task".
- "Stop session" works for a session on each device: the app writes the person event `session.stop_requested {session}`, and the session device stops the session. A confirm names the device. The old "Stop session" button of the desktop Session summary goes away (one way).
- "Archive task" with a running session shows one confirm that names the session device. The service writes `session.stop_requested` first, then `task.archived`.
- New event `task.unarchived {}`: the merge (TypeScript and Kotlin) folds `task.archived` and `task.unarchived` in merge order, so the newest one wins.
- The List of the desktop has an "Archived" group (closed at the start) with "Unarchive" on each row. The phone Tasks list has an "Archived" group.
- awd service: `stopTaskSession`, `archiveTask(ref, {stop})`, `unarchiveTask`. Routes `POST .../tasks/:task/stop`, `POST .../tasks/:task/archive` with the body `{stop?}`, `POST .../tasks/:task/unarchive`. All are person routes.
- CLI: `aw task stop <task>`, `aw task archive <task> [--stop]`, `aw task unarchive <task>`. Without `--stop`, a running session gives a clear `conflict` error.
- A session of an archived task stops with the reason `stopped` (before: `moved`). AW starts no new session after an unarchive until a person starts one.

## Capabilities

### New Capabilities
- `task-actions`: stop the session of a task, archive and unarchive a task, from the CLI, the local API, the desktop and the phone.

### Modified Capabilities
None at the requirement level of other specs. The new event type is in the `task-actions` spec.

## Impact

- `shared/schema` (event `task.unarchived`, samples), generated `contracts/schemas`, `contracts/samples`, Kotlin classes.
- `shared/core` merge, `android/shared` merge (`TaskFold.kt`).
- `daemon/src/service/workspace.ts`, `daemon/src/api/app.ts`, `daemon/src/cli/run.ts`, `daemon/src/cli/person-commands.ts`, `daemon/src/sessions/manager.ts`, `shared/client`, `contracts/openapi.yaml`.
- `desktop/` main calls, contract, queries, `TaskDetail.tsx`, `TaskViews.tsx`, `model.ts`, activity rule.
- `android/control` (`PhoneActions`, `Screens`, `Activity`, `Thread`), `android/app` task header.
- `contracts/fixtures/activity/cases.json` (the new type).
- Docs: `docs/workflow.md`, `docs/phase-1.md`, `docs/design.md`.
