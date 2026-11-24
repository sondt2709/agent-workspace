## Why

A manual move is the only answer to an offline device (`docs/decisions/2026-11-23-manual-move.md`), but today it restarts the work from the checkout HEAD: no code pushes `aw/<key>` and no new device fetches it (gap M11). The desktop never reads the presence, so a task of an offline device looks like it runs and offers no "Assign to another device…" (gap M17, offline part). The wake branch skips the git hooks and commits each untracked file (continuity review finding 3, fix 0e).

## What Changes

- awd pushes the checkpoint branch `aw/<key>` to `origin` at each Stop of the session with the highest claim epoch, with an explicit `--force-with-lease`, outside the manager queue, with a 60 s timeout. A failure writes one thread comment per cause.
- Before awd makes a worktree (tmux or Orca), it fetches `origin aw/<key>`: it bases a new branch on the remote branch, fast-forwards a stale local branch, and keeps a diverged local branch with one comment. It never drops a local commit that no other branch has.
- One git helper for the checkpoint push and the wake branch push. No `--no-verify`: the hooks run, and a refusal names the hook and keeps the local commit or branch.
- The wake branch commits only tracked changes and names the untracked files in its comment. **BREAKING** for the wake behavior: untracked files are no longer pushed.
- Branch rule after a rekey: the branch keeps the name of the first session; when that name is the branch of another task of the project, the remote branch of the rekeyed task is `aw/<own key>`.
- The desktop and the CLI merge the presence `offline_tasks` into the shown pause: "Paused · MacBook Pro offline" with "Assign to another device…". The pause model has `device` and `needs_human`, so a `device_revoked` row needs no rewrite. An offline pause sends no notification.
- Docs: `docs/workflow.md` 4.8.3 (awd pushes), `docs/architecture.md` 4.6 item 8, one line in the plugin `SKILL.md`.
- e2e: git and tmux in the e2e image, a shared bare repo volume, and the move journey on 2 devices.

## Capabilities

### New Capabilities
- `checkpoint-branch`: the fetch and base rule before a worktree, the checkpoint push at each Stop, the lease rule, the failure comments and the branch name rule after a rekey.

### Modified Capabilities
- `session-continuity`: the wake branch commits tracked changes only, runs the hooks and names a refusing hook.
- `desktop-app`: the Board, the List, the Inbox and the task detail show the offline pause from the presence with the device name and "Assign to another device…".
- `aw-cli`: `aw task list` and `aw task show` show the offline pause from the presence.

## Impact

- Code: `daemon/src/sessions/manager.ts`, `daemon/src/sessions/records.ts` (field `checkpoint`), new `daemon/src/sessions/checkpoint.ts`, new `daemon/src/continuity/git-branch.ts`, `daemon/src/continuity/wake.ts`, `daemon/src/cli/format.ts`, `daemon/src/cli/run.ts`, new `shared/client/src/pause.ts` (subpath `@aw/client/pause`), `desktop/src/renderer/src/*`, `desktop/src/shared/pause-text.ts`, `plugins/agent-claude/plugin/skills/aw/SKILL.md`.
- Systems: awd runs `git fetch` and `git push` on the project remote of the person (accepted decision D10, README decision 13). Tests use local bare repositories only.
- No new route, event, dependency or environment variable. The Orca host needs no change.
- e2e: `e2e/docker/Dockerfile` (git, tmux), a shared `remote` volume in `e2e/compose.yaml`, new `e2e/src/move-paused-task.docker.test.ts`.
