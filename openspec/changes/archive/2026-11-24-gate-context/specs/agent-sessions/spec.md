## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Question gate with details
`ask` with details SHALL open a gate `question` whose title is the question (redacted, line breaks as spaces, at most 500 characters) and whose text is the redacted details. Details SHALL have at most 262,144 characters. Details over 16,384 characters SHALL be written in full to `artifacts/<device>/text-<gate>.md`; the gate text SHALL be the first 16,384 characters and a line that names that file, and `file` SHALL name it. `ask` with an option description SHALL write `questions` with one question. `ask` with no details SHALL write the gate as before (the title is the first line of the question, the text is the question).

#### Scenario: Short details
- **WHEN** the agent asks "Which queue library?" with 2 KiB of details
- **THEN** the gate title is "Which queue library?" and the gate text is the details

#### Scenario: Long details
- **WHEN** the agent asks with 40,000 characters of details
- **THEN** `artifacts/<device>/text-<gate>.md` has the 40,000 characters, and the gate text has the first 16,384 characters and the file name
