## ADDED Requirements

### Requirement: Session host choice
awd SHALL pick the host of a new session in this order: the `session_host` of the newest event of the task that names one, from the applied `task.assigned` events and `task.created` (an assignment with no `session_host` keeps the host of an earlier event); the `session_host` of the checkout in the bindings of the device; `orca` when the bindings have `use_orca: true`; else `tmux`. When the choice is `orca` but `use_orca` is false, Orca is not available, or the contract tests do not cover the Claude Code version of the device (AW cannot answer its trust screen in Orca), the session SHALL run in tmux and the task SHALL get one comment with the cause. awd SHALL detect Orca again at most once per 60 s. The session record SHALL keep its host, a resume SHALL use that host, and `session.started` SHALL name it. A task SHALL keep its branch and its folder when it changes host: when the branch of the task is checked out in a folder that AW made for the task (`<AW_HOME>/worktrees/<task-id>` or the Orca worktree `aw-<task-id>`), a tmux session SHALL run in that folder; when the choice is `orca` and the branch is checked out in `<AW_HOME>/worktrees/<task-id>`, the session SHALL run in tmux there and the task SHALL get one comment that names the branch and the folder. A comment about a cause SHALL be written again when the same cause comes back after a session in Orca.

#### Scenario: Use Orca on this device
- **WHEN** the bindings of the device have `use_orca: true` and a task with no `session_host` is assigned to `claude@macbook-pro`
- **THEN** the session runs in Orca, and `session.started` has `host: orca`

#### Scenario: Orca asked but off
- **WHEN** a task has `session_host: orca` and the bindings have `use_orca: false`
- **THEN** the session runs in tmux, and the task gets one comment "Orca is off on macbook-pro"

#### Scenario: Claude Code version not covered
- **WHEN** the bindings have `use_orca: true` and the Claude Code version of the device is 2.2.0 (not covered)
- **THEN** the session runs in tmux, and the task gets one comment "Orca needs a Claude Code version that AW covers"

#### Scenario: Host of the create, assignment later
- **WHEN** a task is created with `session_host: orca` and no assignee, and is then assigned to `claude@macbook-pro` with no `session_host`
- **THEN** the session runs in Orca

#### Scenario: Checkout binding
- **WHEN** the bindings have `use_orca: true`, the checkout has `session_host: tmux`, and the task names no host
- **THEN** the session runs in tmux

#### Scenario: From Orca to tmux
- **WHEN** a session of AW-1 ran in the Orca worktree `aw-<task-id>` on `aw/AW-1`, it stopped, and AW-1 is assigned again with `session_host: tmux` (or Orca is down)
- **THEN** the new session runs in tmux in that Orca worktree on `aw/AW-1`, and git gives no "already checked out" error

#### Scenario: From tmux to Orca
- **WHEN** a session of AW-1 ran in tmux in `<AW_HOME>/worktrees/<task-id>` on `aw/AW-1`, it stopped, and AW-1 is assigned again with `session_host: orca`
- **THEN** the new session runs in tmux in the same folder, the task gets one comment "The branch aw/AW-1 is checked out in ...", and no branch `aw/AW-1-2` exists

### Requirement: Delivery through a host that does not read the screen
For a host with `readsScreen: false`, awd SHALL deliver a text only after the SessionStart hook of the current pane (the record keeps it as `ready_pane`), and only when the record is not `busy`, no permission request waits, and no `permission_prompt` or `elicitation_dialog` notification is open. It SHALL use `submit()` when the host has it, else `paste()` and one Enter. It SHALL not answer a trust screen and SHALL not write "Answer waits" for such a host. When the current pane sends no SessionStart in 120 s after it opened, the task SHALL get one comment that says so. A comment that tells a person to open the terminal SHALL name only the Orca worktree `aw-<task-id>` for an Orca session (the program in a terminal can change the terminal title).

#### Scenario: Answer that waits for a new terminal
- **WHEN** a gate answer of 2 lines comes while the Orca agent is down, and awd opens a new terminal for it
- **THEN** awd sends the answer only after the SessionStart of the new terminal, and the agent gets one input with both lines

#### Scenario: No SessionStart in Orca
- **WHEN** the agent in a new Orca terminal sends no SessionStart in 120 s
- **THEN** the task gets one comment "The agent did not start in 120 s" that names the Orca worktree

#### Scenario: Busy agent in Orca
- **WHEN** the Orca agent is in a turn and a gate answer is ready
- **THEN** awd waits, and sends the answer after the Stop hook

#### Scenario: Orca restart during a session
- **WHEN** the Orca runtime stops for 20 s while a session runs, and then starts again
- **THEN** the agent keeps running, awd does not resume or stop the session, and a later answer reaches the agent

### Requirement: Session host that does not answer
When a host with `find()` throws for a running session (Orca does not answer), awd SHALL neither resume nor stop the session. After 120 s the task SHALL get one comment "<host> does not answer on <device> since <time>", and one more comment when the host answers again. A forced stop (`aw session stop`) while the host does not answer SHALL fail with 503 `not_ready`, and the session SHALL keep running. A stop whose signals fail SHALL also fail with 503 `not_ready`, with the cause of that failure. While a running session of a task did not stop (for example, a person assigned the task again while its host does not answer), awd SHALL start no new session for that task: two agents never work in one folder. The task SHALL get one comment "The new session waits" with the cause, and the new session SHALL start at the first check after the old one stops. When the signals of a stop ran and only the close of the window fails, awd SHALL log it, the stop SHALL succeed, and awd SHALL not resume the session. The comment "does not answer" SHALL count as written only after the write succeeds. When the host knows the stored handle only with another process (another incarnation), awd SHALL close the handle with no signal before it opens a new terminal.

#### Scenario: Orca does not answer
- **WHEN** the Orca runtime does not answer for longer than 120 s while a session runs
- **THEN** the task gets one comment "Orca does not answer on macbook-pro since ...", and `aw session stop` gives 503 `not_ready`

#### Scenario: Assigned again while Orca does not answer
- **WHEN** a person assigns a task again on the same device (also to tmux) while the Orca runtime of its running session does not answer
- **THEN** awd starts no second session, the task gets one comment "The new session waits", and after Orca answers again awd stops the old session (`replaced`) and starts the new one

#### Scenario: Another incarnation
- **WHEN** `terminal show` gives another `incarnationId` than the stored one
- **THEN** awd closes that terminal with no signal and resumes the session in a new terminal

#### Scenario: Close fails after the stop
- **WHEN** `aw session stop` stops the agent of an Orca session and `terminal close` then fails
- **THEN** the stop succeeds, the record is `stopped`, and awd does not resume the agent
