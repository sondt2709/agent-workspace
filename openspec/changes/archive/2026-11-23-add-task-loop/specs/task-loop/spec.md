## ADDED Requirements

### Requirement: Stage effects
The owner device of a task SHALL write the stage changes of `docs/workflow.md` 3 as `task.stage_changed` by `aw@<device>`: backlog → discuss at the first claim (backlog → ready for a subtask with no own approach and a confirmed parent approach); discuss → ready when it resolves "Confirm approach" with "Confirm"; ready → implement when the ready checks pass; implement → review at `result`; review → implement when it resolves "Approve result" with "Request changes". Only a gate answer of the human or the ready checks SHALL move a task past a gate.

#### Scenario: Confirm moves to Ready
- **WHEN** the human answers "Confirm" to the gate "Confirm approach" of AW-7 in Discuss
- **THEN** the session device writes `gate.resolved`, `task.stage_changed` discuss → ready, and delivers "Approach v1 confirmed. Run `aw ready AW-7` and end your turn."

#### Scenario: Request changes on a result
- **WHEN** the human answers "Request changes" with a comment to "Approve result"
- **THEN** the task goes back to Implement and the same session gets the answer and the comment

### Requirement: Approach versions
`approach` SHALL write the Markdown once to `approach/v<n>.md` (n = latest + 1), then `approach.proposed` and the gate "Confirm approach" (options Confirm, Request changes) with the Markdown as text and the optional decisions, each with a question, options and a recommended option.

#### Scenario: Second version
- **WHEN** the agent proposes an approach after "Request changes" of v1
- **THEN** `approach/v2.md` exists, v1 is unchanged, and a new gate names `approach/v2.md`

### Requirement: Ready checks
`ready` SHALL write `task.ready {missing, gates}` and open one `question` gate per missing item. The implementing device SHALL send the notice "Start implementing" and move the task to Implement only when: the newest `task.ready` of this device sorts after the claim of the session and each of its gates is resolved; the approach is confirmed (or, for a subtask with no own approach, the parent approach); the task has an assignee; no dependency is open; and each `knowledge` and `secure` folder is in sync with each connected peer. While the sync check fails, the task SHALL have the pause `waiting_for_sync` with the next step "Waiting for sync: <folder> <percent> %"; the pause SHALL end when the check passes.

#### Scenario: Missing item
- **WHEN** the agent runs `aw ready AW-7 --missing "test account"` after the approach is confirmed
- **THEN** a question gate "Missing: test account" opens, and the task stays in Ready until the human answers it; then AW sends "Start implementing"

#### Scenario: Waiting for sync
- **WHEN** the knowledge folder is at 92 % with a connected peer
- **THEN** the task shows the pause "Waiting for sync: knowledge 92 %" and gets no "Start implementing"

### Requirement: Result and Done
`result` SHALL copy the result file into the task, write `result.posted`, the gate "Approve result" (Approve, Request changes) and implement → review. After "Approve", AW SHALL deliver "Result approved", and the task SHALL be Done at the first Stop after that delivery or at `done`: `task.done`, `session.ended {reason: done}`, and the window closes. `done` before an approved result SHALL be refused.

#### Scenario: Done at the first Stop
- **WHEN** the agent ends the turn that "Result approved" started
- **THEN** the task is Done and its window is closed

### Requirement: Subtasks
`task_create` SHALL create a task whose parent is the session task, by the agent actor, with the project of the parent by default. `from_parent` SHALL copy the test server, the credential names and the links of the parent; explicit fields win. A new subtask SHALL have no assignee ("Needs you: assign"), unless the project switch "Assign new subtasks to the default device" is on: then the assignee SHALL be the default agent at the first online device of the project list. A task with an open dependency SHALL not be claimed.

#### Scenario: Subtask waits for assign
- **WHEN** the agent of AW-12 creates a subtask with the switch off
- **THEN** the subtask has the parent AW-12, no assignee, and the "Needs you" reason `assign`

#### Scenario: Dependency not done
- **WHEN** a human assigns AW-14, which depends on AW-13 in Implement
- **THEN** no device claims AW-14 until AW-13 is Done

### Requirement: Parent notice
When a subtask is Done, the owner device of the parent SHALL deliver "Subtask <key> done" to the parent session once. When the parent session does not run and the parent is not Done, it SHALL start a new session with the notice as the first input.

#### Scenario: Parent session ended
- **WHEN** AW-13 is Done and the session of its parent AW-12 ended
- **THEN** the device of AW-12 claims it again with a higher epoch and starts a session whose first input starts with the notice

### Requirement: Notices
A text of AW to a session SHALL be a `message.sent` by `aw@<device>`, delivered by the safe delivery with the prefix `[AW notice <id>]`. Its `message.human` SHALL have the source `notice` and the actor `aw@<device>`.

#### Scenario: Notice delivered once
- **WHEN** AW writes "Start implementing" and the session confirms it with UserPromptSubmit
- **THEN** the thread has one `message.human` with source `notice` and the delivery id of the notice

### Requirement: Gate push and reminders
The owner device of a task SHALL send a push for each gate as the gate table of `docs/workflow.md` 3 says (at the open, and the reminders at 1 h and 24 h, or 24 h only), "Assign task" only for a task that an agent created, no push for "Approve knowledge change", and one push when a task is Done. Each push SHALL be sent at most once, also over an awd restart.

#### Scenario: Reminder after 1 h
- **WHEN** a question gate is open for 1 h
- **THEN** the owner sends one reminder push for it, and no second one at the next check

### Requirement: Knowledge gates
For each pending knowledge suggestion of a task that this device owns, the loop SHALL open the gate "Approve knowledge change" (Approve, Reject) once. The answer SHALL accept or reject the suggestion with the comment. A suggestion resolved another way SHALL resolve the gate.

#### Scenario: Approve a suggestion
- **WHEN** the human answers "Approve" to the gate of a shared-knowledge suggestion
- **THEN** the suggestion is accepted and the gate is resolved

### Requirement: Credentials at session start
At each window open, the session device SHALL write each credential value that its credential provider gives to `~/.aw/sessions/<session>/credentials/<name>` (mode 0600) and set `AW_CREDENTIALS_DIR`. A credential name with no value SHALL get one comment per session.

#### Scenario: No provider value
- **WHEN** a task names the credential `stripe-test` and the provider has no value
- **THEN** the session starts and the thread has the comment that `stripe-test` has no value on this device
