## MODIFIED Requirements

### Requirement: Wake branch
When a session stops because a person assigned its task to another device, AW SHALL commit the uncommitted changes of the tracked files of the worktree, and when the worktree has commits that no remote and no other branch has, it SHALL create the branch `aw/<key>-<device>-<HHMM>` and push it to `origin`. AW SHALL not commit untracked files; the comment SHALL name them (at most 5 names and the count) and say that they stay in the worktree on the device. The commit and the push SHALL run the hooks of the repository (no `--no-verify`). When a hook refuses, AW SHALL keep the changes or the local branch and the comment SHALL name the hook. It SHALL write a `comment.added` that names the branch, or says that the push failed and the branch is local. With no unpushed work and no untracked file it SHALL write nothing.

#### Scenario: Laptop wakes after a move
- **WHEN** the worktree of a moved task has a changed tracked file and the laptop sees the new assignment
- **THEN** a branch `aw/<key>-<device>-<time>` has the change, and the thread has a comment that names the branch

#### Scenario: Untracked file
- **WHEN** the worktree of a moved task has an untracked file `notes.txt`
- **THEN** no commit has `notes.txt`, and the comment names it

#### Scenario: Pre-push hook refuses
- **WHEN** the pre-push hook of the repository exits with an error
- **THEN** the branch stays local, and the comment names the `pre-push` hook
