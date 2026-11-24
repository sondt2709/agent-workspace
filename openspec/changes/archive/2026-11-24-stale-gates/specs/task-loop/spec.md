## ADDED Requirements

### Requirement: Gates with no session
At each check, the owner device of a task that is not archived SHALL close each open gate that no session can use, with `gate.resolved {answer_event: null}` by `aw@<device>`. The session of a gate SHALL be the session of the newest applied `session.started` or `session.resumed` before its `gate.opened`. That session ended when its newest session event is `session.ended`, or when the task shows another session. The close answer SHALL be "Session ended" for:
- an `approve_command` gate, at each end reason (`stopped`, `crashed`, `moved`, `replaced`, `done`, or another session);
- a `question`, `reply`, `confirm_approach`, `custom` or `continue_after_limit` gate, only when the reason is `stopped` or `done`.

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
