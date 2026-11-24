# checkpoint-branch Specification

## Purpose
The checkpoint branch `aw/<key>` of a task (decision D10): the fetch and base rule before a new worktree, the push at each Stop with an explicit lease, the failure comments, the branch name after a rekey, and the skill line (archived change move-paused-task).
## Requirements
### Requirement: Checkpoint push at each Stop
At each Stop hook of a session whose claim epoch is the highest epoch of its task, awd SHALL push the local task branch to the checkpoint branch on `origin` with an explicit `--force-with-lease` and without `--no-verify`. It SHALL push only when the remote branch does not exist, when the remote commit is an ancestor of the local branch, or when the remote commit is the commit that the session last based on or pushed. The push SHALL run outside the manager queue with a 60 s timeout that counts the `pre-push` hook too: at the timeout AW SHALL stop the process group of git (the hook and its children), and with a `pre-push` hook the cause SHALL name that hook, not `origin`. A session with a lower epoch SHALL not push. A checkout with no `origin` SHALL get no push and no comment.

#### Scenario: Agent commits and the turn ends
- **WHEN** the agent of the session with the highest epoch commits on `aw/AW-1` and the Stop hook arrives
- **THEN** `origin` has `aw/AW-1` at that commit

#### Scenario: Older session
- **WHEN** a Stop hook arrives from a session whose epoch is lower than another claim of the task
- **THEN** awd pushes nothing

#### Scenario: Another device pushed first
- **WHEN** the remote `aw/AW-1` has a commit that the local branch does not have and that the session never saw
- **THEN** awd does not push, and the thread has one comment that says why

### Requirement: Push failure comment once per cause
When a checkpoint push fails, awd SHALL write one `comment.added` by `aw@<device>` that names the branch and the cause (rejected, the name of a refusing hook, a timeout or the git error). It SHALL not write the same cause again for the session until a push succeeds.

#### Scenario: Lease failure twice
- **WHEN** 2 Stops in a row fail with the same rejected lease
- **THEN** the thread has one failure comment

#### Scenario: Pre-push hook refuses
- **WHEN** the pre-push hook of the repository exits with an error
- **THEN** the comment names the `pre-push` hook with its exit code and no line of its output, and the local branch keeps its commits

### Requirement: Base a new worktree on the checkpoint branch
Before awd creates a worktree for a task (tmux or Orca), it SHALL fetch the checkpoint branch from `origin`, ignoring a missing remote and a missing branch. When the remote branch exists, awd SHALL create a missing local branch at the remote commit, and fast-forward a local branch that the remote contains. When the local branch has commits that the remote does not have and the remote has commits that the local branch does not have, awd SHALL keep the local branch and write one comment, unless each local-only commit is on another local branch or a remote; then it SHALL move the local branch to the remote commit. A failed fetch SHALL start the session from the local branch and write one comment. The local task branch SHALL be the branch of the AW worktree of the task only when it is the checkpoint branch or the branch of the first session of the task; else it SHALL be the checkpoint branch, and awd SHALL check it out again in that worktree before the session starts (a failed checkout SHALL fail the start with the cause). awd SHALL never move or push another branch: a branch of the first session that does not start with `aw/` SHALL give the checkpoint branch `aw/<key>`. When the local task branch is checked out in a folder that AW did not make for the task (the checkout of the person), awd SHALL not fetch into it, merge or reset it: the start SHALL fail with the cause that names that folder.

#### Scenario: Move to a new device
- **WHEN** a human assigns a task to an agent on ubuntu-01 and `origin` has `aw/AW-1` with the commits of macbook-pro
- **THEN** the new worktree on ubuntu-01 has those commits

#### Scenario: Agent checked out another branch
- **WHEN** the agent ran `git checkout -b person-work` in the AW worktree of AW-1, and the task moves away and back while `origin/aw/AW-1` has new commits
- **THEN** `person-work` keeps its commits, and the new session works on `aw/AW-1` with the commits of `origin`

#### Scenario: Stale local branch
- **WHEN** the local `aw/AW-1` is an ancestor of the remote `aw/AW-1`
- **THEN** the local branch moves to the remote commit

#### Scenario: Diverged local branch
- **WHEN** the local `aw/AW-1` has a commit that no other ref has, and the remote has another commit
- **THEN** the local branch keeps its commit, and the thread has one comment

### Requirement: Branch name after a rekey
The checkpoint branch of a task SHALL be the branch of its first session, else `aw/<key>`. When that name is `aw/<key>` of another task of the same project and not `aw/<own key>`, the checkpoint branch SHALL be `aw/<own key>`; a device with a local branch of the old name SHALL push it to the new name.

#### Scenario: Two tasks started as AW-1
- **WHEN** task B started its first session on `aw/AW-1` and a rekey changed its key to `AW-2`, while task A has the key `AW-1`
- **THEN** the checkpoint branch of task B on `origin` is `aw/AW-2`

### Requirement: Skill line about the push
The plugin `SKILL.md` SHALL tell the agent to commit its work on the task branch and that AW pushes it at each Stop, so the agent does not push it.

#### Scenario: Skill text
- **WHEN** a test reads `plugins/agent-claude/plugin/skills/aw/SKILL.md`
- **THEN** it has the line about the push and is below 6,000 characters
