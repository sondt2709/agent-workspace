## Context

`docs/architecture.md` 4.6 item 8 (decision D10) says that AW pushes `aw/<key>` at each Stop, and 4.3.4 says that a moved task continues from the last pushed checkpoint. The code has no push and no fetch: `#worktree` in `daemon/src/sessions/manager.ts` makes a new branch from the checkout HEAD. `task.branch` is fixed by the first `session.started` (`shared/core/src/merge/task.ts`). The presence (`shared/core/src/merge/presence.ts`) gives `offline_tasks`, and only the phone reads it. The wake branch (`daemon/src/continuity/wake.ts`) runs `git add -A` and `--no-verify`.

## Goals / Non-Goals

**Goals:**
- A human move continues from the commits of the old device (journey 7.4).
- A push never overwrites commits of another device or another task.
- A slow or missing remote never blocks claims, gates or deliveries.
- The desktop and the CLI show "Paused: <device> offline" with the human action.

**Non-Goals:**
- The revoked pause (task revoke-device), the phone screens, queue position, any automatic move.
- A setting to turn the push off (D10 has "on by default"; phase 1 has no setting).

## Decisions

1. **One git helper** (`daemon/src/continuity/git-branch.ts`). `fetchBranch(cwd, branch)` runs `git fetch origin +refs/heads/<b>:refs/remotes/origin/<b>` with a 60 s timeout and returns the remote commit, `no_remote` (no `origin` URL), `no_branch` ("couldn't find remote ref") or `failed`. `pushBranch({cwd, local, remote, lease})` runs `git push --force-with-lease=refs/heads/<remote>:<lease or empty> origin refs/heads/<local>:refs/heads/<remote>`, never `--no-verify`, 60 s timeout. It returns `pushed`, `rejected` (stale info or non-fast-forward), `hook` (the push failed with no `[rejected]` and no `fatal:` line, and `git rev-parse --git-path hooks/pre-push` is a file: the hook named), `no_remote` or `failed`. An empty lease means "the remote branch must not exist" (checked with git 2.54).
   - Alternative: `--force-with-lease` with no value uses `refs/remotes/origin/<b>`, which a `git fetch` of the person moves. Rejected.
2. **Push rule at Stop** (`daemon/src/sessions/checkpoint.ts`, `CheckpointPusher`). Only the session whose `record.epoch` is the highest claim epoch of the task pushes. The push runs after the hook returns, one at a time per session; a Stop during a push runs one more push after it. Steps: fetch; remote = local: nothing; the remote commit is an ancestor of the local branch, or it is `record.checkpoint` (the remote commit that this session last based on or pushed): push with that lease; no remote branch: push with an empty lease; else refuse with cause `diverged`. After a push, `record.checkpoint` = the pushed commit.
3. **Comments once per cause.** A failure writes `comment.added` by `aw@<device>`: "AW could not push <local branch> to <checkpoint branch> on origin: <cause>. A move to another device starts from the last pushed commit." The cause text never has the user or the password of a remote URL (`scrubUrls`). The pusher keeps the last cause per session in memory and writes again only for a new cause, or after a success. No remote gives no comment (a local repository is valid) and one log line.
4. **Prepare before a worktree.** `prepareBranch({checkout, local, remote, folder})` runs before `host.worktree()` (Orca) and before `git worktree add` (tmux). With a remote commit R: no local branch: `git branch <local> R`; local is an ancestor of R: fast-forward (`git branch -f` when it is not checked out, else `git merge --ff-only R` in the folder that has it); R is an ancestor of local: keep; diverged: when each local-only commit is on another local branch or a remote (`git rev-list <local> --not --remotes --branches --exclude=<local>` is empty), move the branch to R (`git branch -f`, or `git reset --keep R` in its folder); else keep it and write one comment "aw/AW-21 on ubuntu-01 has commits that origin does not have, and origin has commits that it does not have. AW keeps the local branch. Merge origin/aw/AW-21 into it by hand." The result gives the base commit for `record.checkpoint` (R when the local branch contains R, else null). The Orca host then sees a known branch and passes `--base-branch` (no Orca change).
5. **Branch name rule.** `checkpointBranch(task, tasks)`: `task.branch` (the first session) or `aw/<key>`. When `task.branch` is `aw/<key of another task of the same project>` and differs from `aw/<own key>`, the name is `aw/<own key>`. A new device uses this name for its local and remote branch. The old device keeps its local branch (`record.branch`) and pushes it to the remote name.
6. **Wake branch.** `git add -u` instead of `git add -A`; the untracked files (`git ls-files --others --exclude-standard`, at most 5 names and a count) go in the comment: "N untracked files stay in the worktree on <device>: …". No `--no-verify`. A refused commit (hook) keeps the changes in the worktree, and the comment names the hook; the committed unpushed work still gets its branch. A refused push keeps the local branch and names the hook. The unpushed check also excludes the remote-tracking refs that the checkpoint push updates.
7. **Pause from the presence in the clients.** `withPresencePause(tasks, presence, names)` in `shared/client/src/pause.ts` (subpath `@aw/client/pause`, no Node import, so the renderer can use it). For each `offline_tasks` row of a task with no own pause, it sets `paused = {cause, since, resumes_at: null, next_step, needs_human: cause === "device_revoked", device}`. `next_step`: "It continues when MacBook Pro is back. Assign it to another device to continue now." The renderer applies it in the `select` of `useTasks` and `useTask` with the presence query (10 s); the CLI calls the presence and devices routes in `aw task list` and `aw task show`. The pause label is "MacBook Pro offline" (`device_revoked`: "MacBook Pro was revoked").
   - Alternative: the daemon task route adds the pause. Rejected: presence changes with no file change, so the desktop task query would not refetch, and the route reply would no longer be the merged event state.
8. **Notifications.** No notification for `device_offline` (`docs/architecture.md` 4.6.5: needs the human No, push No). The main process does not read the presence.

## Risks / Trade-offs

- [A push to the person's remote] → accepted decision D10 (README decision 13); explicit lease; tests use local bare repositories only.
- [git asks for credentials and waits] → `GIT_TERMINAL_PROMPT=0` and the 60 s timeout; the failure comment names the cause.
- [The fetch before a worktree is slow] → 60 s timeout; on failure the session starts from the local branch, and one comment says so.
- [Untracked files no longer reach the wake branch] → they stay on the disk, and the comment names them.
- [2 tasks with one branch name before a rekey] → the name rule and the lease.

## Migration Plan

The session record gets `checkpoint: string | null` (default null). An older record parses; its first push fetches and pushes when the remote branch is an ancestor or absent. Rollback: remove the push call; the field is ignored.

## Open Questions

None.
