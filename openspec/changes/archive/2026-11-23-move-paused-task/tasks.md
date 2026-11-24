## 1. Current behavior

- [x] 1.1 Write `daemon/src/sessions/checkpoint.e2e.test.ts` (bare remote, tmux, fake agent) and run it on the base: keep the failing log
- [x] 1.2 Take a desktop screenshot of a task whose owner device is offline on the base build

## 2. Git helper and wake branch

- [x] 2.1 Add `daemon/src/continuity/git-branch.ts` (`fetchBranch`, `pushBranch`, `hookFile`) with tests on real git folders
- [x] 2.2 Change `daemon/src/continuity/wake.ts`: `git add -u`, untracked names, no `--no-verify`, hook names; update its tests

## 3. Checkpoint branch

- [x] 3.1 Add `daemon/src/sessions/checkpoint.ts`: `checkpointBranch`, `prepareBranch`, `CheckpointPusher`, with unit tests
- [x] 3.2 Add the record field `checkpoint` in `daemon/src/sessions/records.ts`
- [x] 3.3 Call the prepare in `#worktree` (tmux and Orca) and the pusher at the Stop hook in `daemon/src/sessions/manager.ts`
- [x] 3.4 Run the session e2e test on the new code

## 4. Pause from the presence

- [x] 4.1 Add `shared/client/src/pause.ts` (`withPresencePause`, `pauseLabel`) and the subpath export, with tests
- [x] 4.2 Desktop: apply it in `useTasks` and `useTask`; show the label in the chip, the task detail and the Assign dialog; tests
- [x] 4.3 CLI: `aw task list` and `aw task show` read the presence and the devices; format test

## 5. Docs and plugin

- [x] 5.1 `docs/workflow.md` 4.8.3, `docs/architecture.md` 4.6 item 8
- [x] 5.2 One line in `plugins/agent-claude/plugin/skills/aw/SKILL.md` and its test

## 6. End to end and evidence

- [x] 6.1 e2e image with git, tmux and the fake agent (`AW_CLAUDE`), the `remote` volume in `e2e/compose.yaml`, `e2e/src/move-paused-task.docker.test.ts`; run on local-compose
- [x] 6.2 Desktop screenshot after the change
- [x] 6.3 Break each new test once and restore
- [x] 6.4 `task check` in daemon, shared, desktop, plugins, e2e; `task leakcheck`
