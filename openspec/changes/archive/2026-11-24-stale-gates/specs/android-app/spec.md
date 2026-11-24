## MODIFIED Requirements

### Requirement: Phone gate cards with the full context
A gate card SHALL show each decision of `gate.opened` `data.decisions` with its question, its options and the recommended option marked "Recommended", and SHALL cut the text at the last `\n\n## Decisions\n` when `data.decisions` is not empty. The task detail SHALL have an Approach section with each version and its state ("Confirmed", "Waits for you", "Replaced", as on the desktop); a version SHALL open to the full text of its synced file. A resolved gate whose newest answer of this phone became a comment, and that the used answer of another device resolved, SHALL show a closed card in the task detail (a gate that a newer version replaced has no used answer and shows no card): "Your answer “X” came after the answer of <device>. It is a comment now." A resolved gate that AW closed with no answer of a person ("Session ended", or "Denied after <n> s") and whose newest answer of this phone became a comment SHALL show the closed card "Your answer “X” came after AW closed the gate: <answer>. It is a comment now."

#### Scenario: Decisions on the phone
- **WHEN** the "Confirm approach" card of AW-12 has 2 decisions
- **THEN** the card shows both with the recommended options marked, and no "## Decisions" text block

#### Scenario: Late answer
- **WHEN** the phone answered "Request changes" and ubuntu-01 resolved the gate with the answer "Confirm" of macbook-pro
- **THEN** the task detail shows "Your answer “Request changes” came after the answer of macbook-pro. It is a comment now."

#### Scenario: Answer to a gate of an ended session
- **WHEN** the phone answered "Allow once" and the owner device closed the gate with "Session ended"
- **THEN** the gate leaves Needs you, and the task detail shows "Your answer “Allow once” came after AW closed the gate: Session ended. It is a comment now."
