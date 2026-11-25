## MODIFIED Requirements

### Requirement: Session files and first input
awd SHALL write the first input to `~/.aw/sessions/<session>/first-input.md` and SHALL never put user text in a command line, a window name or a shell string. The folder SHALL have mode 0700 and its files mode 0600. The first input of a session with no approved proposal SHALL be the first message as is. With an approved proposal or a parent, it SHALL be the first message, the approved proposal word for word, and "Read `aw thread <key> --ancestors` before you act.". A session that starts at Ready (a subtask with the approved proposal of its parent) SHALL also get the ready step: "Run `aw ready <key>` … and end your turn".

#### Scenario: Special characters
- **WHEN** the first message has quotes, a backtick, `$(touch x)` and 3 lines
- **THEN** the agent gets the text as is, the file `x` does not exist, and the thread has the same text as `message.human` with source `first`

### Requirement: SessionStart context
awd SHALL write `context.md` of the session before each window open (new and resume): the task fields, the open gates, the AW rules, and the text of the knowledge context builder of the knowledge store for the task (`KnowledgeService.context`) with the task paths. The task paths SHALL be the paths named in the approved proposal and the changed files of the session worktree (`git status` and `git diff --name-only <checkout HEAD>...HEAD`, at most 500, a failure gives none). The AW rules SHALL say to search the knowledge first and to record `aw learn` or `aw learn <key> --nothing-new` before `aw done`. The file SHALL have at most 10,000 characters; a knowledge list that does not fit SHALL be cut at a line end and end with "run `aw kb context <key>`" and the thread line. When the knowledge store gives no context, the file SHALL name the cause. The SessionStart hook SHALL give the file to the agent.

#### Scenario: Knowledge of the project
- **WHEN** the knowledge has the rule `shared/rules/style.md`, the `auto` file `projects/billing-api/invoices.md` and a file of another project, and a session of a billing-api task starts
- **THEN** `context.md` lists the rule under "Read now", the invoices file with its description under "Read when relevant", and not the file of the other project, and the agent gets the whole file

#### Scenario: Files knowledge of a task path
- **WHEN** the knowledge has `projects/billing-api/invoice-api.md` with `apply: files` and `globs: ["src/api/**"]`, and the first message of the task names `src/api/invoice.ts`
- **THEN** `context.md` lists `invoice-api.md` under "Read now"

#### Scenario: Changed file of a resumed session
- **WHEN** the worktree of the session has a new file `src/api/tax.ts`, and the session resumes
- **THEN** `context.md` lists the `files` file with the glob `src/api/**` under "Read now"

### Requirement: Thread from hooks
awd SHALL write `message.human` with the raw prompt for each UserPromptSubmit, with the source `first`, `answer`, `phone` or `typed` and the delivery id of a delivered text, and `message.agent` with `last_assistant_message` and the source `turn` for each Stop. A prompt that starts with `[AW resume]` SHALL be written as `session.resumed` with the text. A Stop text that ends with a question mark SHALL open the gate `reply`, unless a gate `question`, `approve_proposal` or `reply` of the session that opened after its last `message.human` is open.

#### Scenario: Agent ends with a question
- **WHEN** the agent ends its turn with "Do you want the 1000/min limit?" and no gate is open
- **THEN** the task has an open gate of kind `reply` with that text

#### Scenario: Old gates do not stop a Reply gate
- **WHEN** a gate "Approve command" of the session is open after its timeout, or a reply gate is open and the human sent a message instead, and the agent ends a later turn with a question
- **THEN** the task gets a new open gate of kind `reply`

#### Scenario: Turn text has the source turn
- **WHEN** the agent ends a turn with a text of 3,000 characters
- **THEN** the thread has `message.agent` with that text word for word and the source `turn`

### Requirement: Gates from tools
PreToolUse of `AskUserQuestion` SHALL open a gate `question` that keeps each question of the tool input with its header, its multiSelect value and each option with its label and description in `questions`. With one question and multiSelect false, `options` SHALL be the labels of that question; else `options` SHALL be `[]`. The title SHALL be the first question, and the text SHALL list each question with its option labels. PreToolUse of `ExitPlanMode` SHALL write the plan as `proposal/v<n>.md`, `proposal.proposed` and a gate `approve_proposal`. The hook SHALL make the gate id and deny the tool with a text that names the gate id and tells the agent to end its turn.

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
awd SHALL deliver each gate answer and each `message.sent` to the session through one function. It SHALL send only when no dialog is open (a waiting permission request, a `permission_prompt` notification with no later hook event, or the layout of a dialog at the bottom of the visible screen: a footer, a selection cursor on an option above it, and no prompt line below it). Free text on the screen SHALL NOT count as a dialog. A retry SHALL NOT count while the agent is in a turn (from a UserPromptSubmit to the next Stop). It SHALL paste the text with `load-buffer` and `paste-buffer -p`, then press Enter once. Each text SHALL start with `[AW answer <gate>]` or `[AW message <id> from <device>]`, and awd SHALL count it as delivered only when a `message.human` with that delivery id is in the log. It SHALL make at most 3 attempts, 30 s apart, then write the comment "Answer not delivered" with the pane lines, and the next texts SHALL go on. An answer to a question, proposal or reply gate of an earlier session of the task SHALL go to the current session when awd resolved the gate after the claim of the current session. A gate that AW resolved with no answer of a person (`answer_event: null`, for example "Replaced by proposal v2" when the agent sent a new proposal) SHALL NOT be delivered. awd SHALL answer the trust screen of a Claude Code version that the tests do not cover once per window, before the first SessionStart. It SHALL press Enter only when the selection cursor is on "Yes, I trust this folder", and SHALL move the cursor down once at most.

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

### Requirement: Redacted agent files
Each task file that awd writes from agent text SHALL go through the redaction of the files layer: the long message file `artifacts/<device>/text-<id>.md`, the proposal version of the ExitPlanMode hook and of `proposal`, and each copied file of `artifact add`, `result` (the result file and its artifacts) and `handoff`. `artifact.added` SHALL have the size and the sha256 of the written bytes, and the gate "Approve result" SHALL show the written result text. A retry of the ExitPlanMode hook SHALL compare the version file with the redacted plan, so it writes no second version.

#### Scenario: Agent writes the value in its files
- **WHEN** a session with the credential `staging-api-key` writes the value in a long reply, a proposal, a copied text file, a result and a handoff
- **THEN** each file in the task folder has `[redacted:staging-api-key]`, and no file in the workspace folder has the value

#### Scenario: Binary artifact of a session
- **WHEN** the agent adds a binary file that has the value inside
- **THEN** the artifact has the same bytes, and `artifact.added` has the sha256 of the file on disk

#### Scenario: Hook retry of a plan with a value
- **WHEN** the ExitPlanMode hook of a plan with the value runs a second time
- **THEN** awd finds the redacted `proposal/v1.md` and writes no `proposal/v2.md`

### Requirement: Redaction before a cut
Each writer that shortens agent text or screen text SHALL redact the full text with the redaction of the files layer first, then cut it. This SHALL cover the preview of a long message (2,000 characters), the gate title (500 characters) and the gate text (16 KiB) of `proposal`, `gate` and `result`, the title of `ask`, of an AskUserQuestion gate (the agent plugin gives the full question), of a "Reply" gate and of a missing item of `ready`, the text of a knowledge change gate (16,000 characters), the summary of a permission gate (300 characters), and the "Last terminal line" of the watchdog (300 characters).

#### Scenario: Value across the preview cut
- **WHEN** a reply of 40 KiB has the value `stg_live_9f8e7d6c5b4a` at character 1,990
- **THEN** the `message.agent` event has `[redacted:staging-api-key]` and no prefix of the value

#### Scenario: Value across a gate title cut
- **WHEN** the first line of a proposal is 520 characters long and has the value at character 495
- **THEN** the title of "Approve proposal" has no prefix of the value

#### Scenario: Long Bash command
- **WHEN** a permission request has a Bash command of 400 characters with the value at character 295
- **THEN** the title and the text of "Approve command" have no prefix of the value

### Requirement: Turn with no update
At each Stop, awd SHALL check the events of the session after the start of the turn: the last `message.human` or `session.resumed` of the session. The turn SHALL have an update when the agent actor wrote `message.agent` with source `tool`, `gate.opened`, `proposal.proposed`, `task.ready`, `result.posted`, `task.done` or `task.learned` in that range. When the turn has no update, no gate of the task is open (a person already has an item to act on), the Stop opened no Reply gate, the task is not done, the turn did not start with a nudge notice, and the turn did not start with a `message.human` of source `typed` with no delivery id, awd SHALL write one notice `message.sent` with `kind: nudge` by `aw@<device>`. The text SHALL be "Your turn ended with no AW update, and the human reads only AW. Send the update now: `message` (short), or `ask`, `proposal`, `result` or `gate`. Then end your turn." A retry of the Stop spool file SHALL NOT write a second notice.

#### Scenario: Turn with only text
- **WHEN** the agent gets "[AW message <id> from pixel-9] Status?" and ends the turn with a text and no AW call
- **THEN** the thread has one `message.sent` with `kind: nudge`, and the agent gets it as `[AW notice <id>] Your turn ended with no AW update…`

#### Scenario: Turn with a message
- **WHEN** the agent runs `aw message AW-7 "Tests pass"` and ends the turn in the same second
- **THEN** the thread has no nudge notice

#### Scenario: No second notice
- **WHEN** the agent gets a nudge notice and ends that turn with text only
- **THEN** the thread has no second nudge notice

#### Scenario: Person at the terminal
- **WHEN** a person types "explain the diff" in the terminal and the agent answers with text only
- **THEN** the thread has no nudge notice
