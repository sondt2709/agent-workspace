## MODIFIED Requirements

### Requirement: Thread from hooks
awd SHALL write `message.human` with the raw prompt for each UserPromptSubmit, with the source `first`, `answer`, `phone` or `typed` and the delivery id of a delivered text, and `message.agent` with `last_assistant_message` and the source `turn` for each Stop. A prompt that starts with `[AW resume]` SHALL be written as `session.resumed` with the text. A Stop text that ends with a question mark SHALL open the gate `reply`, unless a gate `question`, `confirm_approach` or `reply` of the session that opened after its last `message.human` is open.

#### Scenario: Agent ends with a question
- **WHEN** the agent ends its turn with "Do you want the 1000/min limit?" and no gate is open
- **THEN** the task has an open gate of kind `reply` with that text

#### Scenario: Old gates do not stop a Reply gate
- **WHEN** a gate "Approve command" of the session is open after its timeout, or a reply gate is open and the human sent a message instead, and the agent ends a later turn with a question
- **THEN** the task gets a new open gate of kind `reply`

#### Scenario: Turn text has the source turn
- **WHEN** the agent ends a turn with a text of 3,000 characters
- **THEN** the thread has `message.agent` with that text word for word and the source `turn`

## ADDED Requirements

### Requirement: Turn with no update
At each Stop, awd SHALL check the events of the session after the start of the turn: the last `message.human` or `session.resumed` of the session. The turn SHALL have an update when the agent actor wrote `message.agent` with source `tool`, `gate.opened`, `approach.proposed`, `task.ready`, `result.posted`, `task.done` or `task.learned` in that range. When the turn has no update, no gate of the task is open (a person already has an item to act on), the Stop opened no Reply gate, the task is not done, the turn did not start with a nudge notice, and the turn did not start with a `message.human` of source `typed` with no delivery id, awd SHALL write one notice `message.sent` with `kind: nudge` by `aw@<device>`. The text SHALL be "Your turn ended with no AW update, and the human reads only AW. Send the update now: `message` (short), or `ask`, `approach`, `result` or `gate`. Then end your turn." A retry of the Stop spool file SHALL NOT write a second notice.

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

### Requirement: Hook session check
The adapter SHALL return the `session_id` of each hook event. When it is not empty and not the AW session id, awd SHALL write the comment "Hook events of another Claude session (<first 8 characters of the id>) arrive in this session. AW keeps them. Check the terminal of this task." once for each foreign id of the session, and SHALL handle the event as before. The session record SHALL keep the foreign ids, so a restart of awd does not write the comment again.

#### Scenario: Another Claude session
- **WHEN** 2 hook events with the `session_id` 0193a7d1-9999-7000-8000-000000000002 arrive in the spool of another session
- **THEN** the task has one comment that names 0193a7d1, and the thread has the events of both hooks

#### Scenario: Subagent events
- **WHEN** a hook event has the AW session id and an `agent_id`
- **THEN** awd writes no comment

### Requirement: Session link data
`session.started` SHALL have `name` (the `-n` value of the launch, or null) and `terminal {window, pane}` from the pane record of the session host (each null when not known). The `session.resumed` of an `[AW resume]` input SHALL have the `terminal` and the `pids` of the new pane.

#### Scenario: tmux session
- **WHEN** a session of AW-7 starts in the tmux window `aw-<task-id>`
- **THEN** `session.started` has the name `AW-7`, and `terminal` with that window and the pane id
