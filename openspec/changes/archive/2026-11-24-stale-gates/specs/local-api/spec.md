## MODIFIED Requirements

### Requirement: Gates
The API SHALL list gates (`GET .../gates`, default the open gates; `state=all` for each gate; `task` to filter) and answer a gate (`POST .../gates/{gate}/answer`). The answer SHALL be a `gate.answered` event in the log of this device with the current version of the gate. An answer to a gate that this device knows as resolved SHALL give 409 `gate_not_open` and write nothing. Its details SHALL have the gate id, the answer and `answer_event` of the resolution (null when AW closed the gate with no answer of a person).

#### Scenario: Answer a gate of another device
- **WHEN** `ubuntu-01` opened a question gate and a client on `macbook-pro` answers it
- **THEN** `macbook-pro.jsonl` of the task has a valid `gate.answered` line, and the gate in the reply has the answer with `use: pending`

#### Scenario: Answer to a gate that AW closed
- **WHEN** the owner device closed a gate with "Session ended", and a client answers it
- **THEN** the reply is 409 `gate_not_open` with the details `answer: "Session ended"` and `answer_event: null`
