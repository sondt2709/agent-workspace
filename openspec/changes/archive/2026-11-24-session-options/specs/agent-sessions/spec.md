## ADDED Requirements

### Requirement: Working folder of a session
A new session SHALL work in the folder of the effective `work_in`. `worktree`: the folder that the task used before, else a new git worktree `<AW_HOME>/worktrees/aw-<key>` (tmux, with `-<n>` when the name is taken) or the Orca worktree `aw-<key>`. `checkout`: the project checkout with `aw/<key>` checked out by `git switch`; at most one running session per checkout. `folder`: the absolute folder as it is, with no branch and no checkpoint push; awd SHALL refuse a missing folder and a folder in AW_HOME or in a workspace folder. Each refusal SHALL be one thread comment, and the task SHALL get no session.

#### Scenario: Worktree named by key
- **WHEN** the first session of AW-1 starts in tmux
- **THEN** its folder is `<AW_HOME>/worktrees/aw-AW-1` on the branch `aw/AW-1`

#### Scenario: Second session in the checkout
- **WHEN** AW-1 runs in the project checkout and AW-2 asks for the checkout
- **THEN** AW-2 gets the comment that the checkout has the session of AW-1, and no session

### Requirement: Stop on request
The session device SHALL stop a running session named by an applied `session.stop_requested` with the reason `stopped`, once.

#### Scenario: Request for a session of this device
- **WHEN** `session.stop_requested` names a running session of this device
- **THEN** awd stops it and writes `session.ended {reason: "stopped"}`

### Requirement: Move between the worktree and the checkout
A session in the project checkout SHALL remove the clean tmux worktree that AW made for an earlier session of the same task when that worktree holds the task branch and no session runs there, and SHALL write one comment. A session in a separate worktree SHALL refuse a task branch that the project checkout has, with one comment.

#### Scenario: From the worktree to the checkout
- **WHEN** AW-1 ran in `<AW_HOME>/worktrees/aw-AW-1` and a person starts a new session with "Project checkout"
- **THEN** AW removes that worktree, writes "AW removed the worktree …", and the session runs in the checkout on `aw/AW-1`
