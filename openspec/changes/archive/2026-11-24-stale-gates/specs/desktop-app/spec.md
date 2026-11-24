## MODIFIED Requirements

### Requirement: Answer notices
After an answer, the card SHALL show: for the error `gate_not_open`, "Another answer resolved this gate first: “<answer>”. AW did not send your answer.", or "AW closed this gate first: “<answer>”. AW did not send your answer." when the details have `answer_event: null`; for `applied: false`, "AW did not use your answer: <reason>."; for an answer that the reply marks `use: comment`, "Your answer came after another answer. It is a comment now.", or "Your answer came after AW closed this gate: “<answer>”. It is a comment now." when the gate has no answer event. The notice SHALL show also when the gate closes before the reply arrives. In the Inbox, the card of the task SHALL stay until the person closes the notice.

#### Scenario: Gate resolved first
- **WHEN** the person answers a gate that this device knows as resolved with "Approve"
- **THEN** the card shows "Another answer resolved this gate first: “Approve”. AW did not send your answer."

#### Scenario: Refused answer in the Inbox
- **WHEN** the person answers "Approve" in the Inbox, awd refuses with `gate_not_open`, and the task leaves the "Needs you" lane
- **THEN** the Inbox keeps the card of the task with the notice until the person closes it

#### Scenario: Gate that AW closed
- **WHEN** the person answers "Allow once" to a gate that the owner device closed with "Session ended"
- **THEN** the card shows "AW closed this gate first: “Session ended”. AW did not send your answer."
