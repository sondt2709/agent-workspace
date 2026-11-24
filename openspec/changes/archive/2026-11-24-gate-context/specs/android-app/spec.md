## ADDED Requirements

### Requirement: Question details and context on phone gate cards
A phone gate card SHALL show the gate body as plain text above the choices, clamped to 6 lines with "Show more". A `question` or `reply` gate with no body SHALL show "Context" with the same rule and the same fixture as the desktop (`contracts/fixtures/gates/context.json`). When `gate.opened` has `questions`, the card SHALL show each option description, and a gate with 2 or more questions or a multiSelect question SHALL show each question with its options as choices and "Send answers", with the answer text of `contracts/fixtures/gates/questions.json`.

#### Scenario: Context on the phone
- **WHEN** the agent writes its analysis and then asks "Which option? (see the gate message above)" in the same turn
- **THEN** the phone card shows the start of the analysis under "Context" and "Show more"

#### Scenario: Two questions on the phone
- **WHEN** the person picks one option for each of 2 questions and taps "Send answers"
- **THEN** the gate answer is the same text as the desktop sends for the same picks
