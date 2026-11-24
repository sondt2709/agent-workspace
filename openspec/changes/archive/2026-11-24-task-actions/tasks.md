## 1. Schema and merge

- [x] 1.1 Add `task.unarchived {}` to `shared/schema` events and samples; run `pnpm schema:generate`
- [x] 1.2 Fold `task.unarchived` in `shared/core` merge, with a unit test
- [x] 1.3 Fold `task.unarchived` in `android/shared` `TaskFold.kt`, with a JVM test

## 2. awd

- [x] 2.1 `WorkspaceService.stopTaskSession`, `archiveTask(ref, {stop})`, `unarchiveTask`, with unit tests
- [x] 2.2 Routes `stop`, `archive` (body `{stop?}`), `unarchive` as person routes; `shared/client`; `pnpm api:generate`
- [x] 2.3 CLI `aw task stop`, `aw task archive --stop`, `aw task unarchive`; person commands
- [x] 2.4 Session manager: an archived task stops with `stopped`; the stop request check first; unit test

## 3. Desktop

- [x] 3.1 Bridge calls `stopTaskSession`, `archiveTask {stop}`, `unarchiveTask`; queries
- [x] 3.2 Task header "⋯" menu with the confirm dialogs; remove the Session summary Stop button
- [x] 3.3 List group "Archived" (closed at the start) with "Unarchive" on each row
- [x] 3.4 Activity rule and thread text for `task.unarchived`; renderer tests

## 4. Phone

- [x] 4.1 `PhoneActions.archiveTask` and `unarchiveTask`, with JVM tests
- [x] 4.2 `ScreenStates.tasksByStage` group "Archived"; Activity and Thread for `task.unarchived`
- [x] 4.3 Task header "⋯" menu with Stop session, Archive task and Unarchive task

## 5. Docs and checks

- [x] 5.1 Update `docs/workflow.md`, `docs/phase-1.md`, `docs/design.md`
- [x] 5.2 Add `task.unarchived` to `contracts/fixtures/activity/cases.json`
- [x] 5.3 Run the root `task check`
