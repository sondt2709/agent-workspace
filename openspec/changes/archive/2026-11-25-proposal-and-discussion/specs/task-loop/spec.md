## RENAMED Requirements

- FROM: `### Requirement: Approach versions`
- TO: `### Requirement: Proposal versions`

## MODIFIED Requirements

### Requirement: Stage effects
The owner device of a task SHALL write the stage changes of `docs/workflow.md` 3 as `task.stage_changed` by `aw@<device>`: backlog → discuss at the first claim (backlog → ready for a subtask with no own proposal and a confirmed parent proposal); discuss → ready when it resolves "Approve proposal" with "Approve" (or "Confirm" on a gate from before the rename); ready → implement when the ready checks pass; implement → review at `result`; review → implement when it resolves "Approve result" with "Request changes". Only a gate answer of the human or the ready checks SHALL move a task past a gate.

#### Scenario: Approve moves to Ready
- **WHEN** the human answers "Approve" to the gate "Approve proposal" of AW-7 in Discuss
- **THEN** the session device writes `gate.resolved`, `task.stage_changed` discuss → ready, and delivers "Proposal v1 approved. Run `aw ready AW-7` and end your turn."

#### Scenario: Request changes on a result
- **WHEN** the human answers "Request changes" with a comment to "Approve result"
- **THEN** the task goes back to Implement and the same session gets the answer and the comment

### Requirement: Proposal versions
`proposal` SHALL write the Markdown once to `proposal/v<n>.md` (n = the latest version + 1; a task with an approach v5 from before the rename gets v6), then resolve the open "Approve proposal" gate with "Replaced by proposal v<n>", then write `proposal.proposed` and the gate "Approve proposal" with the one option "Approve" and the Markdown as text. A task SHALL have at most one open "Approve proposal" gate. `proposal` SHALL refuse `decisions` with exit code 2 (`invalid`). A message of the person while the gate is open SHALL go to the session as a message and SHALL NOT close the gate.

#### Scenario: Second version
- **WHEN** the person writes "Also send Retry-After" while proposal v1 is open, and the agent runs `aw proposal AW-7 --file p.md`
- **THEN** `proposal/v2.md` exists, v1 is unchanged, the v1 gate is resolved with "Replaced by proposal v2", and one gate "Approve proposal" with the option "Approve" names `proposal/v2.md`

#### Scenario: Decisions refused
- **WHEN** the agent runs `aw proposal AW-7 --file p.md --decisions d.json`
- **THEN** the command exits with code 2 and AW writes nothing

#### Scenario: Old approach gate
- **WHEN** a task has an open `confirm_approach` gate from before the rename and the person answers "Confirm"
- **THEN** the task moves to Ready as with "Approve"

### Requirement: Ready checks
`ready` SHALL write `task.ready {missing, gates}` and open one `question` gate per missing item. The implementing device SHALL send the notice "Start implementing" and move the task to Implement only when: the newest `task.ready` of this device sorts after the claim of the session and each of its gates is resolved; the proposal is approved (or, for a subtask with no own proposal, the parent proposal); the task has an assignee; no dependency is open; and each `knowledge` and `secure` folder is in sync with each connected peer. While the sync check fails, the task SHALL have the pause `waiting_for_sync` with the next step "Waiting for sync: <folder> <percent> %"; the pause SHALL end when the check passes. While the task has a pause of another cause (for example `login_expired`), the loop SHALL write no sync pause and SHALL send no "Start implementing", so 2 pause writers never overwrite each other at each check.

#### Scenario: Missing item
- **WHEN** the agent runs `aw ready AW-7 --missing "test account"` after the proposal is approved
- **THEN** a question gate "Missing: test account" opens, and the task stays in Ready until the human answers it; then AW sends "Start implementing"

#### Scenario: Waiting for sync
- **WHEN** the knowledge folder is at 92 % with a connected peer
- **THEN** the task shows the pause "Waiting for sync: knowledge 92 %" and gets no "Start implementing"

### Requirement: Gates with no session
At each check, the owner device of a task that is not archived SHALL close each open gate that no session can use, with `gate.resolved {answer_event: null}` by `aw@<device>`. The session of a gate SHALL be the session of the newest applied `session.started` or `session.resumed` before its `gate.opened`. That session ended when its newest session event is `session.ended`, or when the task shows another session. The close answer SHALL be "Session ended" for:
- an `approve_command` gate, at each end reason (`stopped`, `crashed`, `moved`, `replaced`, `done`, or another session);
- a `question`, `reply`, `approve_proposal`, `custom` or `continue_after_limit` gate, only when the reason is `stopped` or `done`.

The gates `approve_result`, `take_over_terminal`, `approve_knowledge`, `approve_device`, `assign` and `fix_file` SHALL stay open. A gate with a pending answer of its current version SHALL stay open while its session runs. Each pending answer of a closed gate SHALL become a late-answer comment, and no `[AW answer]` SHALL go to a session for the close. The rule SHALL read only the merged log, so a gate that was stuck before an update closes at the first check after it.

#### Scenario: Stop with 2 open gates
- **WHEN** a session has an open `approve_command` gate and an open question, and a person stops the session
- **THEN** the owner device resolves both gates with "Session ended", and the task leaves Needs you

#### Scenario: Late phone answer
- **WHEN** the phone answers "Allow once" to the gate of a stopped session
- **THEN** the answer is a late-answer comment, and `aw gate list` shows no gate with a pending answer

#### Scenario: Question after a move
- **WHEN** a person assigns a task with an open question again, and a new session claims it
- **THEN** the question stays open, and the new session gets its answer

#### Scenario: Crash
- **WHEN** a session crashes with an open question and an open `approve_command` gate
- **THEN** the `approve_command` gate resolves with "Session ended", and the question stays open

#### Scenario: Gates from before the update
- **WHEN** awd starts with a task whose session ended with `stopped` and whose 3 `approve_command` gates are open with pending answers
- **THEN** the first check resolves the 3 gates with "Session ended", and the 3 answers become late-answer comments

#### Scenario: Result gate
- **WHEN** a person stops a session with an open "Approve result" gate
- **THEN** the gate stays open

## ADDED Requirements

### Requirement: Questions replace older questions
When the agent opens a question (`ask`, `AskUserQuestion`, the `Stop` hook gate "Reply") or sends a proposal, the session device SHALL first resolve each open `question` and `reply` gate of the task with `gate.resolved {answer_event: null}` by `aw@<device>` and the answer "Replaced by a newer question" or "Replaced by proposal v<n>". The ready check gates ("Missing: <item>") SHALL stay open. A later answer to a replaced gate SHALL become a comment (rule 2 of the gate table).

#### Scenario: Question after a question
- **WHEN** AW-7 has an open question "Where do the counters live?" and the agent asks "Limit per key or per IP?"
- **THEN** the first gate is resolved with "Replaced by a newer question", and only the second gate needs the person

#### Scenario: Proposal closes the question
- **WHEN** AW-7 has an open question and the agent runs `aw proposal`
- **THEN** the question is resolved with "Replaced by proposal v1"

#### Scenario: Late answer
- **WHEN** the person answers the replaced question from the phone
- **THEN** the answer is a late-answer comment, and no `[AW answer]` goes to the session
