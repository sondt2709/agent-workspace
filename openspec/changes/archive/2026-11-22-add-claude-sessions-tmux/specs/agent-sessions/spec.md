## ADDED Requirements

### Requirement: Claim before a session
awd SHALL start or resume a session of a task only after it wrote `task.claimed {epoch, device, session, based_on}` with an epoch 1 above the highest epoch that it knows, and only when the merge applied that claim. awd SHALL claim only a task whose assignee is `claude@<this device>`, that is not archived or done, and that has no accepted claim, or whose newest accepted `task.assigned` sorts after the accepted claim, or whose accepted claim is on another device that released it. awd SHALL never claim because another device is offline, and SHALL never claim for another device.

#### Scenario: Assignment starts a session
- **WHEN** a human assigns a task to `claude@macbook-pro` and awd runs on macbook-pro
- **THEN** awd writes `task.claimed` with epoch 1, the merge applies it, and a tmux window `aw-<task-id>` runs the agent

#### Scenario: Task of another device
- **WHEN** a task is assigned to `claude@ubuntu-01` and awd runs on macbook-pro
- **THEN** awd writes no claim and starts no session

### Requirement: Stop when the task moves
When the assignee device or the accepted claim of a task is not this device and session any more, awd SHALL stop the running session of this device by its process group and SHALL write `session.ended {reason: moved}` and `task.released`. When a person assigns the task again on this device (another agent, or the same agent after the claim), awd SHALL stop the session with `session.ended {reason: replaced}` and `task.released` before a new session claims the task. A task whose session cannot start SHALL get one comment with the cause, SHALL be tried again after 60 s, and SHALL NOT stop the other sessions of the workspace. A checkout that is not a git repository SHALL get no session (AW runs a session only in a git worktree that it creates). When the window of a new session does not open, awd SHALL forget that session, so the next try writes a new claim.

#### Scenario: Human moves the task
- **WHEN** a session of AW-7 runs on macbook-pro and a human assigns AW-7 to `claude@ubuntu-01`
- **THEN** macbook-pro stops the session, no process of its process group is left, and its log has `session.ended` with reason `moved` and `task.released`

#### Scenario: Another agent on the same device
- **WHEN** a session of AW-7 runs on macbook-pro and a human assigns AW-7 to `codex@macbook-pro`
- **THEN** macbook-pro stops the session and writes `session.ended` with reason `replaced` and `task.released`

#### Scenario: A task that cannot start
- **WHEN** `git worktree add` fails for AW-1 and AW-2 asks a question
- **THEN** AW-1 gets one comment "The session did not start", and the answer to AW-2 reaches its session

#### Scenario: Checkout that is not a git repository
- **WHEN** the bound checkout of the project is a plain folder
- **THEN** the task gets the comment "The session did not start" with "is not a git repository", no window opens, and no trust entry is written

#### Scenario: Window did not open
- **WHEN** tmux fails to open the window of a new session once
- **THEN** the task gets the comment "The session did not start", the next try writes a claim with epoch 2, and that session runs

### Requirement: Session files and first input
awd SHALL write the first input to `~/.aw/sessions/<session>/first-input.md` and SHALL never put user text in a command line, a window name or a shell string. The folder SHALL have mode 0700 and its files mode 0600. The first input of a session with no confirmed approach SHALL be the first message as is. With a confirmed approach or a parent, it SHALL be the first message, the confirmed approach word for word, and "Read `aw thread <key> --ancestors` before you act.".

#### Scenario: Special characters
- **WHEN** the first message has quotes, a backtick, `$(touch x)` and 3 lines
- **THEN** the agent gets the text as is, the file `x` does not exist, and the thread has the same text as `message.human` with source `first`

### Requirement: Hook spool
The hook command SHALL write each hook event as one JSON file in `~/.aw/sessions/<session>/spool/` with a temp file and a rename, and SHALL exit without awd. awd SHALL handle the spool files in name order at start and after each change, each file once. awd SHALL write the events of a hook at once and SHALL move a spool file to `spool/done/` only after its events are in the log. A retry of a spool file SHALL NOT write an event of that file again: the id of each event of a spool file SHALL come from the session, the file name and the step, and awd SHALL skip an event whose id is in the log.

#### Scenario: awd is down
- **WHEN** awd is killed with SIGKILL during a session and the agent ends 2 turns
- **THEN** after the restart the thread has both `message.agent` events in order, and no hook event is lost

#### Scenario: Killed before the move to done
- **WHEN** awd wrote the events of a Stop spool file and was killed before it moved the file to `spool/done/`
- **THEN** after the restart the log of the device has one line with that `message.agent`

### Requirement: Thread from hooks
awd SHALL write `message.human` with the raw prompt for each UserPromptSubmit, with the source `first`, `answer`, `phone` or `typed` and the delivery id of a delivered text, and `message.agent` with `last_assistant_message` for each Stop. A prompt that starts with `[AW resume]` SHALL be written as `session.resumed` with the text. A Stop text that ends with a question mark SHALL open the gate `reply`, unless a gate `question`, `confirm_approach` or `reply` of the session that opened after its last `message.human` is open.

#### Scenario: Agent ends with a question
- **WHEN** the agent ends its turn with "Do you want the 1000/min limit?" and no gate is open
- **THEN** the task has an open gate of kind `reply` with that text

#### Scenario: Old gates do not stop a Reply gate
- **WHEN** a gate "Approve command" of the session is open after its timeout, or a reply gate is open and the human sent a message instead, and the agent ends a later turn with a question
- **THEN** the task gets a new open gate of kind `reply`

### Requirement: Gates from tools
PreToolUse of `AskUserQuestion` SHALL open a gate `question` with the question and the option labels, and PreToolUse of `ExitPlanMode` SHALL write the plan as `approach/v<n>.md`, `approach.proposed` and a gate `confirm_approach`. The hook SHALL make the gate id and deny the tool with a text that names the gate id and tells the agent to end its turn.

#### Scenario: AskUserQuestion
- **WHEN** the agent calls `AskUserQuestion` with 2 options
- **THEN** the tool is denied with a reason that has the gate id, and that gate is open with the 2 options

### Requirement: Safe delivery
awd SHALL deliver each gate answer and each `message.sent` to the session through one function. It SHALL send only when no dialog is open (a waiting permission request, a `permission_prompt` notification with no later hook event, or the layout of a dialog at the bottom of the visible screen: a footer, a selection cursor on an option above it, and no prompt line below it). Free text on the screen SHALL NOT count as a dialog. A retry SHALL NOT count while the agent is in a turn (from a UserPromptSubmit to the next Stop). It SHALL paste the text with `load-buffer` and `paste-buffer -p`, then press Enter once. Each text SHALL start with `[AW answer <gate>]` or `[AW message <id> from <device>]`, and awd SHALL count it as delivered only when a `message.human` with that delivery id is in the log. It SHALL make at most 3 attempts, 30 s apart, then write the comment "Answer not delivered" with the pane lines, and the next texts SHALL go on. An answer to a question, approach or reply gate of an earlier session of the task SHALL go to the current session when awd resolved the gate after the claim of the current session. awd SHALL answer the trust screen of a Claude Code version that the tests do not cover once per window, before the first SessionStart. It SHALL press Enter only when the selection cursor is on "Yes, I trust this folder", and SHALL move the cursor down once at most.

#### Scenario: Multi-line answer
- **WHEN** a person on pixel-9 answers a question gate with 3 lines
- **THEN** the agent gets one input with the 3 lines, and the thread has one `message.human` with source `answer` and the gate id as delivery id

#### Scenario: Agent text that asks a question
- **WHEN** the agent ends its turn with "Do you want to use Postgres or SQLite?" and a person answers the reply gate
- **THEN** the answer reaches the session, and the thread has `message.human` with the gate id as delivery id

#### Scenario: Missed answer after a restart
- **WHEN** an answer arrives while awd is down
- **THEN** after the start awd resolves the gate and delivers the answer once

#### Scenario: Answer after a new session
- **WHEN** a question of a session is open, a person assigns the task again on the same device, and the answer arrives after the new claim
- **THEN** the new session gets `[AW answer <gate>] <answer>`, and the thread has `message.human` of the new session with the gate id as delivery id

### Requirement: Permission gate
For each PermissionRequest, awd SHALL apply the rules of the task first, else open the gate `approve_command` with a unique request id `p-<uuidv7>` and wait at most 120 s from the gate open, also across retries of the hook and awd restarts. The gate event SHALL hold the tool, a summary and the sha256 of the input, not the input. While awd starts, a request of a running session SHALL get 503, and when awd stops, a waiting request SHALL get 503 at once. "Allow once" and "Allow for this task" SHALL allow; another answer SHALL deny, and awd SHALL also deliver "Denied by human@<device>: <reason>" as the next input. After 120 s the hook SHALL deny with `interrupt: true`. A later "Allow" SHALL allow the next request with the same tool and input once, and awd SHALL deliver "Approved: run it again".

#### Scenario: Timeout and late allow
- **WHEN** nobody answers a permission request for 120 s, and later a person answers "Allow once"
- **THEN** the hook denied with `interrupt: true`, awd delivers "Approved: run it again", and the next request with the same input is allowed without a new gate

#### Scenario: awd restarts while a request waits
- **WHEN** a permission request waits, awd restarts, and a person answers "Allow once" after the restart
- **THEN** the hook allows the tool, and the task has one gate "Approve command"

#### Scenario: Large tool input
- **WHEN** the agent asks to write a file with 100 KB of content
- **THEN** the gate "Approve command" opens, and its event has the sha256 of the input and not the input

#### Scenario: Two requests
- **WHEN** 2 permission requests wait and a person answers the second one
- **THEN** only the second request gets the answer

### Requirement: Session log buffer
awd SHALL write the session events of the agent commands (`message.agent`, `task.progress`, `artifact.added`, `handoff.written`) of a task at most once per second. The events of a hook SHALL be written at once. A claim, a gate, a session start or end, a stage change and `message.human` SHALL be written at once, after the waiting events of the same task. A waiting event that fails SHALL stay in the buffer and SHALL NOT stop the event that is written at once.

#### Scenario: Gate after an agent reply
- **WHEN** a Stop event and an `aw ask` of the same task arrive in the same second
- **THEN** the log has `message.agent` before `gate.opened`, and both lines are on disk when `aw ask` returns

### Requirement: Reconcile and resume
At start and every 5 s, awd SHALL match its session records to the tmux panes by the stored pane pid, never by a process search. A session that holds the accepted claim and has no live process SHALL be resumed in a new window with `--resume <uuid>`, the stored launch flags, and a continue message after `--` that names the interrupted step. awd SHALL write `session.resumed`. A forced stop SHALL send SIGTERM to the process group, SIGKILL after 5 s, then SIGKILL to each remaining descendant. A resume SHALL signal no process when the session host does not list the stored pane with the stored pid. A session whose agent has no conversation yet (it stopped before its first prompt, so it has no transcript) SHALL start again with `--session-id` and the first input, not with `--resume`, at most 3 times; such a start SHALL NOT count as a resume.

#### Scenario: Agent process killed
- **WHEN** the claude process of a session gets SIGKILL
- **THEN** awd starts a new window with `--resume` and the same session id, and the first input after SessionStart `resume` is the continue message

#### Scenario: Agent stops before its first prompt
- **WHEN** the agent of a new session exits before SessionStart
- **THEN** awd opens a new window with `--session-id` and the first input, the thread has one `message.human` with source `first`, and no `session.resumed`

#### Scenario: Window gone after a reboot
- **WHEN** the window of a session is gone and its stored pid is now the pid of another program
- **THEN** awd resumes the session, and the other program keeps running

#### Scenario: awd restart with a live session
- **WHEN** awd gets SIGKILL and starts again while the agent runs
- **THEN** the tmux window still runs the same pid, and awd does not resume it
