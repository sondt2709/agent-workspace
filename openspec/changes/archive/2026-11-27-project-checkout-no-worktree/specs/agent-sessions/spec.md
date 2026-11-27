## MODIFIED Requirements

### Requirement: Working folder of a session
A new session SHALL work in the folder of the effective `work_in`. `worktree`: the folder that the task used before, else a new git worktree `<AW_HOME>/worktrees/aw-<key>` (tmux, with `-<n>` when the name is taken) or the Orca worktree `aw-<key>`. `checkout`: the project checkout with `aw/<key>` checked out by `git switch`; at most one running session per checkout. `checkout` with `switch_branch: false`: the project checkout as it is, with no branch, no `git switch`, no checkpoint push and no commit of unpushed work on a move; at most one running session per checkout. `folder`: the absolute folder as it is, with no branch, no checkpoint push and no commit of unpushed work on a move; awd SHALL refuse a missing folder, a folder in AW_HOME or in a workspace folder, a folder that holds AW_HOME or a workspace folder, and a folder that is in, or holds, the folder of a running session of another task. Each refusal SHALL be one thread comment, and the task SHALL get no session.

#### Scenario: Worktree named by key
- **WHEN** the first session of AW-1 starts in tmux
- **THEN** its folder is `<AW_HOME>/worktrees/aw-AW-1` on the branch `aw/AW-1`

#### Scenario: Second session in the checkout
- **WHEN** AW-1 runs in the project checkout and AW-2 asks for the checkout
- **THEN** AW-2 gets the comment that the checkout has the session of AW-1, and no session

#### Scenario: Checkout with no branch switch
- **WHEN** the checkout has `main` checked out and AW-1 starts with `work_in: checkout` and `switch_branch: false`
- **THEN** the session works in the checkout, the checkout still has `main`, no branch `aw/AW-1` exists, and `session.started` has no branch

## ADDED Requirements

### Requirement: A worktree needs a commit
Before AW makes a worktree (tmux or Orca), awd SHALL check that the `HEAD` of the checkout names a commit. When it names none, the start SHALL fail before any `git worktree` or Orca call, with one comment: "The session did not start on <device>: <checkout> has no commit yet. AW makes the worktree of a session from a commit: make a first commit there, or start a session with "Project checkout". AW tries again in 60 s." The same cause SHALL give no second comment. After a first commit, the next start try SHALL start the session with no new assignment.

#### Scenario: Repository with no commit
- **WHEN** the checkout of billing-api is a git repository with no commit and AW-1 asks for a worktree
- **THEN** the task gets one comment that says "has no commit yet", the host gets no call, and no session runs

#### Scenario: First commit later
- **WHEN** the person makes a first commit in that checkout
- **THEN** a session of AW-1 starts within the start retry wait, with no new assignment

### Requirement: Host of a session in the project checkout
A session with `work_in: checkout` SHALL get its host by the rules of "Session host choice", as a worktree session does: with the choice `orca`, it SHALL run in Orca in the main folder of the checkout. A session with `work_in: folder` SHALL run in tmux, with the one comment of today when the choice is `orca`.

#### Scenario: Project checkout with Use Orca
- **WHEN** the bindings have `use_orca: true` and AW-1 starts with `work_in: checkout`
- **THEN** the session runs in Orca in the checkout, and `session.started` has `host: orca`
