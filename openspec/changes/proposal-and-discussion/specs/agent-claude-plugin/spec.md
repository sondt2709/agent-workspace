## MODIFIED Requirements

### Requirement: Decision context in the question
The skill `aw` SHALL tell the agent to ask each question to the human only with the MCP tool `ask` or `aw ask`, never also with `message`; to put each question that it has in one `ask` per turn; to put the full context of a decision (the options, the trade-offs, the risks and a recommendation) in `details` or `aw ask --details-file`; and never to write "see the message above". The SKILL.md SHALL stay below 6,000 characters.

#### Scenario: Skill text
- **WHEN** the contract test reads `plugin/skills/aw/SKILL.md`
- **THEN** it has the words `--details-file` and `details`, the rule that a question goes only through `ask`, and it has fewer than 6,000 characters

### Requirement: Update rules of the skill
The skill `aw` and the AW rules of `context.md` SHALL say that the text output of the agent goes only to the Session log and that the human reads only AW. They SHALL tell the agent to end each turn with one AW call: `ask`, `proposal`, `ready`, `result`, `gate`, `message`, `learn` or `done`. They SHALL say that a `message` is short, for a phone screen, and does not repeat a gate or a result. They SHALL say that `[AW notice <id>] Your turn ended with no AW update` asks for that update. The fake agent SHALL be able to run `aw message` and then end the turn with a long text.

#### Scenario: Skill text
- **WHEN** a test reads `plugin/skills/aw/SKILL.md`
- **THEN** it has the turn rule and the Session log rule, and it has fewer than 6,000 characters

## ADDED Requirements

### Requirement: Discuss loop of the skill
The skill `aw` SHALL describe the Discuss stage as a conversation: read the thread and the knowledge; send short messages; ask the questions with `ask`; write a proposal with `proposal` only when no question is open; a proposal SHALL have no open question and no choice; the agent SHALL never ask for permission to write a proposal; after a message of the person about the proposal, the agent answers it with `message` or sends a new version with `proposal`. The skill, the session context and the notices SHALL use the term "proposal" and never "approach". The `ExitPlanMode` hook SHALL turn a plan into a proposal (`proposal/v<n>.md`, `proposal.proposed` and the gate `approve_proposal`).

#### Scenario: Skill text of the Discuss loop
- **WHEN** the contract test reads `plugin/skills/aw/SKILL.md`
- **THEN** it has "only when no question is open" and "Never ask for permission to write a proposal", it has no word "approach", and it has fewer than 6,000 characters

#### Scenario: Notice after approval
- **WHEN** the person approves proposal v2 of AW-12
- **THEN** the session gets "Proposal v2 approved. Run `aw ready AW-12` and end your turn."
