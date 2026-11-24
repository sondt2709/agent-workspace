## 1. Base evidence

- [x] 1.1 Capture the base CLI behavior (`evidence/project-remove/base-cli.txt`) and the base Project settings screenshots
- [x] 1.2 Write the merge case `project-removed` and a service test, and keep their failing output on the base

## 2. Schema

- [x] 2.1 Add the workspace event `project.removed {project, name, document}` to `shared/schema/src/events.ts` and to the workspace log kinds
- [x] 2.2 Add `added_at` to `projectV1` and `bound_at` to the checkouts of `bindingsV1`
- [x] 2.3 Run `pnpm schema:generate` (schemas, samples, Kotlin classes)

## 3. Merge (TypeScript)

- [x] 3.1 Fold `project.removed` in `foldWorkspace` (person only) into the removals
- [x] 3.2 Split live and removed projects and tasks in `#assemble`; add `removed_projects` and `removed_tasks` to the view
- [x] 3.3 Count the removed tasks in `nextFreeKey`
- [x] 3.4 Add the merge case `project-removed` and regenerate each `expected.json`; unit tests of the rule

## 4. Merge (Kotlin)

- [x] 4.1 Port the fold, the split and the view fields to `android/shared` merge
- [x] 4.2 Count `removedTasks` in the free key of `android/control` `PhoneActions`
- [x] 4.3 Run `task android:check`

## 5. Daemon

- [x] 5.1 `projectRemoval()` and `removeProject()` in `daemon/src/service/setup.ts`; `addProject` with `added_at` after the newest removal; `editBindings` sets `bound_at`
- [x] 5.2 Routes `GET .../projects/{project}/removal` and `POST .../projects/{project}/remove`; the setup client; `pnpm api:generate`
- [x] 5.3 `aw project remove <slug> [--yes]` and the person command list
- [x] 5.4 Session manager: stop the sessions of removed tasks (`stopped`), drop the own checkout by `bound_at`, clean worktrees and branches with the unpushed check, keep and report the others
- [x] 5.5 Optional `SessionHost.removeWorktree()`; Orca removes its worktree by path with no branch delete
- [x] 5.6 Unit and daemon e2e tests (real tmux, fake agent, real git)

## 6. Desktop

- [x] 6.1 Bridge channels `projectRemoval` and `removeProject`; query hooks
- [x] 6.2 "Remove" section and dialog in Project settings; open the Inbox after the remove
- [x] 6.3 Component tests; `cd desktop && task check`

## 7. Docs

- [x] 7.1 `docs/phase-1.md` (3.1, 3.3, the remove), `docs/architecture.md`, `docs/workflow.md` (`aw project remove`), the schema comment on `archived`

## 8. Verification

- [x] 8.1 Docker e2e with 2 devices: a session on B, remove on A, add the same slug again
- [x] 8.2 Desktop journey off-screen (CDP 9657), screenshots dark, light, 400 px
- [x] 8.3 Root `task check` and `task leakcheck` on the last commit
