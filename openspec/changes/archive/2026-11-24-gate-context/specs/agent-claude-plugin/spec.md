## ADDED Requirements

### Requirement: Decision context in the question
The skill `aw` SHALL tell the agent to put the full context of a decision (the options, the trade-offs, the risks and a recommendation) in the question with `details` of the MCP tool `ask` or `aw ask --details-file`, and never to write "see the message above". The SKILL.md SHALL stay below 6,000 characters.

#### Scenario: Skill text
- **WHEN** the contract test reads `plugin/skills/aw/SKILL.md`
- **THEN** it has the words `--details-file` and `details`, and it has fewer than 6,000 characters

### Requirement: Fake AskUserQuestion with a full input
The fake agent SHALL have the step `ask-tool-json <json>`, which calls the AskUserQuestion tool with that JSON as the tool input and ends the turn.

#### Scenario: Two questions
- **WHEN** a test sends `ask-tool-json {"questions":[…2 questions…]}`
- **THEN** the PreToolUse payload has both questions, and a gate opens with both in `questions`
