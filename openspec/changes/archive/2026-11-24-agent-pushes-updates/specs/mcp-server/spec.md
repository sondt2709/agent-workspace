## ADDED Requirements

### Requirement: Source of an agent message and the turn rule
The tool `message` SHALL write `message.agent` with the source `tool`. The server instructions SHALL say that the text output of the agent goes only to the Session log, that the human reads only AW, and that the agent ends each turn with an AW call. They SHALL say that a `message` is short, for a phone screen, and does not repeat a gate.

#### Scenario: Message through MCP
- **WHEN** the agent of AW-7 calls `message` with `{"text": "Tests pass"}`
- **THEN** AW-7 has `message.agent` with the text "Tests pass" and the source `tool`
