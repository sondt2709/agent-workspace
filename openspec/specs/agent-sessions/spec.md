# agent-sessions Specification

## Purpose
The agent sessions of a device in `daemon/src/sessions/`: claims, start, resume, stop, the hook spool, the thread from hooks, gates from hooks, safe delivery, the permission gate and the 1-second log buffer.
## Requirements
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
awd SHALL write the first input to `~/.aw/sessions/<session>/first-input.md` and SHALL never put user text in a command line, a window name or a shell string. The folder SHALL have mode 0700 and its files mode 0600. The first input of a session with no confirmed approach SHALL be the first message as is. With a confirmed approach or a parent, it SHALL be the first message, the confirmed approach word for word, and "Read `aw thread <key> --ancestors` before you act.". A session that starts at Ready (a subtask with the confirmed approach of its parent) SHALL also get the ready step: "Run `aw ready <key>` … and end your turn".

#### Scenario: Special characters
- **WHEN** the first message has quotes, a backtick, `$(touch x)` and 3 lines
- **THEN** the agent gets the text as is, the file `x` does not exist, and the thread has the same text as `message.human` with source `first`

### Requirement: SessionStart context
awd SHALL write `context.md` of the session before each window open (new and resume): the task fields, the open gates, the AW rules, and the text of the knowledge context builder of the knowledge store for the task (`KnowledgeService.context`) with the task paths. The task paths SHALL be the paths named in the confirmed approach and the changed files of the session worktree (`git status` and `git diff --name-only <checkout HEAD>...HEAD`, at most 500, a failure gives none). The AW rules SHALL say to search the knowledge first and to record `aw learn` or `aw learn <key> --nothing-new` before `aw done`. The file SHALL have at most 10,000 characters; a knowledge list that does not fit SHALL be cut at a line end and end with "run `aw kb context <key>`" and the thread line. When the knowledge store gives no context, the file SHALL name the cause. The SessionStart hook SHALL give the file to the agent.

#### Scenario: Knowledge of the project
- **WHEN** the knowledge has the rule `shared/rules/style.md`, the `auto` file `projects/billing-api/invoices.md` and a file of another project, and a session of a billing-api task starts
- **THEN** `context.md` lists the rule under "Read now", the invoices file with its description under "Read when relevant", and not the file of the other project, and the agent gets the whole file

#### Scenario: Files knowledge of a task path
- **WHEN** the knowledge has `projects/billing-api/invoice-api.md` with `apply: files` and `globs: ["src/api/**"]`, and the first message of the task names `src/api/invoice.ts`
- **THEN** `context.md` lists `invoice-api.md` under "Read now"

#### Scenario: Changed file of a resumed session
- **WHEN** the worktree of the session has a new file `src/api/tax.ts`, and the session resumes
- **THEN** `context.md` lists the `files` file with the glob `src/api/**` under "Read now"

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
PreToolUse of `AskUserQuestion` SHALL open a gate `question` that keeps each question of the tool input with its header, its multiSelect value and each option with its label and description in `questions`. With one question and multiSelect false, `options` SHALL be the labels of that question; else `options` SHALL be `[]`. The title SHALL be the first question, and the text SHALL list each question with its option labels. PreToolUse of `ExitPlanMode` SHALL write the plan as `approach/v<n>.md`, `approach.proposed` and a gate `confirm_approach`. The hook SHALL make the gate id and deny the tool with a text that names the gate id and tells the agent to end its turn.

#### Scenario: AskUserQuestion
- **WHEN** the agent calls `AskUserQuestion` with 2 options
- **THEN** the tool is denied with a reason that has the gate id, and that gate is open with the 2 options

#### Scenario: Descriptions and a header
- **WHEN** the agent calls `AskUserQuestion` with the question "Which color?", the header "Color", multiSelect false and the options red ("Use red") and blue ("Use blue")
- **THEN** the gate has the options red and blue, and `questions` has the header "Color" and both descriptions

#### Scenario: Two questions
- **WHEN** the agent calls `AskUserQuestion` with 2 questions, the second with multiSelect true
- **THEN** the gate has `options: []` and `questions` with both questions and all their options

### Requirement: Safe delivery
awd SHALL deliver each gate answer and each `message.sent` to the session through one function. It SHALL send only when no dialog is open (a waiting permission request, a `permission_prompt` notification with no later hook event, or the layout of a dialog at the bottom of the visible screen: a footer, a selection cursor on an option above it, and no prompt line below it). Free text on the screen SHALL NOT count as a dialog. A retry SHALL NOT count while the agent is in a turn (from a UserPromptSubmit to the next Stop). It SHALL paste the text with `load-buffer` and `paste-buffer -p`, then press Enter once. Each text SHALL start with `[AW answer <gate>]` or `[AW message <id> from <device>]`, and awd SHALL count it as delivered only when a `message.human` with that delivery id is in the log. It SHALL make at most 3 attempts, 30 s apart, then write the comment "Answer not delivered" with the pane lines, and the next texts SHALL go on. An answer to a question, approach or reply gate of an earlier session of the task SHALL go to the current session when awd resolved the gate after the claim of the current session. A gate that AW resolved with no answer of a person (`answer_event: null`, for example "Replaced by approach v2" when the agent proposed a new approach) SHALL NOT be delivered. awd SHALL answer the trust screen of a Claude Code version that the tests do not cover once per window, before the first SessionStart. It SHALL press Enter only when the selection cursor is on "Yes, I trust this folder", and SHALL move the cursor down once at most.

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
For each PermissionRequest, awd SHALL apply the rules of the task first, else open the gate `approve_command` with a unique request id `p-<uuidv7>` and wait at most 120 s from the gate open, also across retries of the hook and awd restarts. The gate event SHALL hold the tool, a summary and the sha256 of the input, not the input. While awd starts, a request of a running session SHALL get 503, and when awd stops, a waiting request SHALL get 503 at once. "Allow once" and "Allow for this task" SHALL allow; another answer SHALL deny, and awd SHALL also deliver "Denied by human@<device>: <reason>" as the next input. "Allow for this task" SHALL add a rule of the tool and one key: the command of `Bash`, the file of a file tool (`file_path`, `notebook_path` or `path`), else the sha256 of the whole input. A rule SHALL allow only a later call with the same tool and key, so a rule for one Write never allows a Write of another file (final check fc1-9). After 120 s the hook SHALL deny with `interrupt: true`. The gate SHALL stay open after the deny while the agent waits on it: a later "Allow" SHALL allow the next request with the same tool and input once, and awd SHALL deliver "Approved: run it again". The owner device SHALL close the gate with "Denied after <n> s" (n = the timeout in seconds) when its session starts a new turn after the gate opened (a `message.human` of the session that is not the delivery of an `approve_command` gate), or opens another `approve_command` gate more than the timeout after it, and with "Session ended" when its session ends (task-loop "Gates with no session").

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

#### Scenario: New turn after the timeout
- **WHEN** nobody answers a permission request for 120 s, and then a person sends the session a message
- **THEN** the owner device resolves the gate with "Denied after 120 s", and a later "Allow once" becomes a late-answer comment

#### Scenario: Parallel requests
- **WHEN** the agent asks for 2 tool calls in the same second and nobody answers
- **THEN** both gates stay open after the deny, until a new turn, another request after 120 s, or the session end

### Requirement: Session log buffer
awd SHALL write the session events of the agent commands (`message.agent`, `task.progress`, `artifact.added`, `handoff.written`) of a task at most once per second. The events of a hook SHALL be written at once. A claim, a gate, a session start or end, a stage change and `message.human` SHALL be written at once, after the waiting events of the same task. A waiting event that fails SHALL stay in the buffer and SHALL NOT stop the event that is written at once.

#### Scenario: Gate after an agent reply
- **WHEN** a Stop event and an `aw ask` of the same task arrive in the same second
- **THEN** the log has `message.agent` before `gate.opened`, and both lines are on disk when `aw ask` returns

### Requirement: Reconcile and resume
At start and every 5 s, awd SHALL match its session records to the tmux panes by the stored pane pid, never by a process search. A session that holds the accepted claim and has no live process SHALL be resumed in a new window with `--resume <uuid>`, the stored launch flags, and a continue message after `--` that names the interrupted step. awd SHALL write `session.resumed`. A forced stop SHALL send SIGTERM to the process group, SIGKILL after 5 s, then SIGKILL to each remaining descendant. A resume SHALL signal no process when the session host does not list the stored pane with the stored pid. A session whose agent has no conversation yet (it stopped before its first prompt, so it has no transcript) SHALL start again with `--session-id` and the first input, not with `--resume`, at most 3 times; such a start SHALL NOT count as a resume.

The resume count SHALL reset only after progress: a Stop or a PostToolUse hook after the window opened, or 10 min alive. A SessionStart alone SHALL NOT reset it. After 2 resumes with no progress, or 5 resumes in one hour, the session SHALL become `failed` with the comment "Resume failed" and the gate "Take over terminal". When the task shows this session and this device is the owner, awd SHALL then write `session.ended` with the reason `crashed` (no person stopped it). The answer "Resume again" SHALL set the session running and SHALL write `session.resumed` for a session that the task shows as ended. A dead agent that AW resumes SHALL NOT get a `session.ended`. A dead pane with the exit status 3 (aw-launch: awd was not ready) SHALL open again after 30 s with no count, at most 20 times in a row. When a resume would fail and the agent has no conversation while a prompt reached it before (a lost transcript), awd SHALL start the session again with `--session-id`, the first input and the note "the earlier conversation of this session was lost; read `aw thread <key>`". A resume of a session whose first input never reached the agent SHALL send the first input as the message. Before a resume opens a window, awd SHALL adopt a live window `aw-<task>` whose process has the session id in its arguments, and SHALL stop any other live window with that name.

#### Scenario: Agent process killed
- **WHEN** the claude process of a session gets SIGKILL
- **THEN** awd starts a new window with `--resume` and the same session id, and the first input after SessionStart `resume` is the continue message

#### Scenario: Agent killed after the resume limit
- **WHEN** the claude process of a session gets SIGKILL 3 times with no progress
- **THEN** the first 2 kills give a resume and no `session.ended`, and the third kill gives `session.ended` with the reason `crashed`, the comment "Resume failed" and the gate "Take over terminal"

#### Scenario: Resume again after a crash
- **WHEN** a person answers "Resume again" to the gate of a crashed session
- **THEN** awd writes `session.resumed`, the task shows the session running, and the next check resumes it

#### Scenario: Agent stops before its first prompt
- **WHEN** the agent of a new session exits before SessionStart
- **THEN** awd opens a new window with `--session-id` and the first input, the thread has one `message.human` with source `first`, and no `session.resumed`

#### Scenario: Window gone after a reboot
- **WHEN** the window of a session is gone and its stored pid is now the pid of another program
- **THEN** awd resumes the session, and the other program keeps running

#### Scenario: awd restart with a live session
- **WHEN** awd gets SIGKILL and starts again while the agent runs
- **THEN** the tmux window still runs the same pid, and awd does not resume it

#### Scenario: Crash after SessionStart
- **WHEN** the agent dies after each SessionStart, before any Stop or PostToolUse
- **THEN** the session is `failed` after 2 resumes, not resumed forever

#### Scenario: awd not ready
- **WHEN** the pane of a session ends with the exit status 3
- **THEN** awd opens it again after 30 s, and the resume count does not change

#### Scenario: Lost transcript
- **WHEN** a prompt reached the agent, its transcript is gone, and the resumes fail
- **THEN** awd starts the session with `--session-id`, and the first input with the note about the lost conversation

#### Scenario: Unknown window of the same task
- **WHEN** a live window `aw-<task>` runs the session id that the record does not store
- **THEN** awd adopts that window and opens no second one

### Requirement: Session token lifetime
awd SHALL mint the session token before the first window of a session opens, SHALL keep it over each resume and each new start of the same session, and SHALL revoke it when the session state becomes `stopped`, `moved`, `replaced`, `ended` or `failed`. A session record that runs with no token file SHALL get a token at its next window open.

#### Scenario: Move to another device
- **WHEN** the person assigns a running task to `claude@ubuntu-01`, and the session on this device stops with `moved`
- **THEN** the token of that session gets 401 on the MCP endpoint and on the local API

#### Scenario: Resume keeps the token
- **WHEN** the agent process of a session dies and awd resumes the session
- **THEN** the resumed agent has the same `AW_MCP_TOKEN` as before

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

### Requirement: Redacted agent files
Each task file that awd writes from agent text SHALL go through the redaction of the files layer: the long message file `artifacts/<device>/text-<id>.md`, the approach version of the ExitPlanMode hook and of `approach`, and each copied file of `artifact add`, `result` (the result file and its artifacts) and `handoff`. `artifact.added` SHALL have the size and the sha256 of the written bytes, and the gate "Approve result" SHALL show the written result text. A retry of the ExitPlanMode hook SHALL compare the version file with the redacted plan, so it writes no second version.

#### Scenario: Agent writes the value in its files
- **WHEN** a session with the credential `staging-api-key` writes the value in a long reply, an approach, a copied text file, a result and a handoff
- **THEN** each file in the task folder has `[redacted:staging-api-key]`, and no file in the workspace folder has the value

#### Scenario: Binary artifact of a session
- **WHEN** the agent adds a binary file that has the value inside
- **THEN** the artifact has the same bytes, and `artifact.added` has the sha256 of the file on disk

#### Scenario: Hook retry of a plan with a value
- **WHEN** the ExitPlanMode hook of a plan with the value runs a second time
- **THEN** awd finds the redacted `approach/v1.md` and writes no `approach/v2.md`

### Requirement: Redaction before a cut
Each writer that shortens agent text or screen text SHALL redact the full text with the redaction of the files layer first, then cut it. This SHALL cover the preview of a long message (2,000 characters), the gate title (500 characters) and the gate text (16 KiB) of `approach`, `gate` and `result`, the title of `ask`, of an AskUserQuestion gate (the agent plugin gives the full question), of a "Reply" gate and of a missing item of `ready`, the text of a knowledge change gate (16,000 characters), the summary of a permission gate (300 characters), and the "Last terminal line" of the watchdog (300 characters).

#### Scenario: Value across the preview cut
- **WHEN** a reply of 40 KiB has the value `stg_live_9f8e7d6c5b4a` at character 1,990
- **THEN** the `message.agent` event has `[redacted:staging-api-key]` and no prefix of the value

#### Scenario: Value across a gate title cut
- **WHEN** the first line of an approach is 520 characters long and has the value at character 495
- **THEN** the title of "Confirm approach" has no prefix of the value

#### Scenario: Long Bash command
- **WHEN** a permission request has a Bash command of 400 characters with the value at character 295
- **THEN** the title and the text of "Approve command" have no prefix of the value

### Requirement: Working folder of a session
A new session SHALL work in the folder of the effective `work_in`. `worktree`: the folder that the task used before, else a new git worktree `<AW_HOME>/worktrees/aw-<key>` (tmux, with `-<n>` when the name is taken) or the Orca worktree `aw-<key>`. `checkout`: the project checkout with `aw/<key>` checked out by `git switch`; at most one running session per checkout. `folder`: the absolute folder as it is, with no branch, no checkpoint push and no commit of unpushed work on a move; awd SHALL refuse a missing folder, a folder in AW_HOME or in a workspace folder, a folder that holds AW_HOME or a workspace folder, and a folder that is in, or holds, the folder of a running session of another task. Each refusal SHALL be one thread comment, and the task SHALL get no session.

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

### Requirement: Time limit of local git commands
awd SHALL run each git command that checks out files in a checkout of the person (`worktree add`, `checkout`, `switch`) with a time limit of 5 minutes, in its own process group, and SHALL stop the whole group at the limit. The start SHALL then fail with a thread comment that says "no end in 5 minutes". The reason: the hooks and filters of the repository (post-checkout, git-lfs) run with the command, inside the manager queue (final check fc1-7).

#### Scenario: A post-checkout hook that never ends
- **WHEN** the repository has a post-checkout hook that waits for ever, and a session starts
- **THEN** after 5 minutes awd stops the hook with git, the start fails with a comment, and the other sessions get their claims, gates and deliveries

### Requirement: Question gate with details
`ask` with details SHALL open a gate `question` whose title is the question (redacted, line breaks as spaces, at most 500 characters) and whose text is the redacted details. Details SHALL have at most 262,144 characters. Details over 16,384 characters SHALL be written in full to `artifacts/<device>/text-<gate>.md`; the gate text SHALL be the first 16,384 characters and a line that names that file, and `file` SHALL name it. `ask` with an option description SHALL write `questions` with one question. `ask` with no details SHALL write the gate as before (the title is the first line of the question, the text is the question).

#### Scenario: Short details
- **WHEN** the agent asks "Which queue library?" with 2 KiB of details
- **THEN** the gate title is "Which queue library?" and the gate text is the details

#### Scenario: Long details
- **WHEN** the agent asks with 40,000 characters of details
- **THEN** `artifacts/<device>/text-<gate>.md` has the 40,000 characters, and the gate text has the first 16,384 characters and the file name

