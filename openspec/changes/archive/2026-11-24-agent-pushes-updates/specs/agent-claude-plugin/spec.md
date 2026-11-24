## ADDED Requirements

### Requirement: Update rules of the skill
The skill `aw` and the AW rules of `context.md` SHALL say that the text output of the agent goes only to the Session log and that the human reads only AW. They SHALL tell the agent to end each turn with one AW call: `ask`, `approach`, `ready`, `result`, `gate`, `message`, `learn` or `done`. They SHALL say that a `message` is short, for a phone screen, and does not repeat a gate or a result. They SHALL say that `[AW notice <id>] Your turn ended with no AW update` asks for that update. The fake agent SHALL be able to run `aw message` and then end the turn with a long text.

#### Scenario: Skill text
- **WHEN** a test reads `plugin/skills/aw/SKILL.md`
- **THEN** it has the turn rule and the Session log rule, and it has fewer than 6,000 characters
