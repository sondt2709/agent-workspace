## ADDED Requirements

### Requirement: Source of a CLI agent message
`aw message <task> <text>` SHALL write `message.agent` with the source `tool`.

#### Scenario: Message through the CLI
- **WHEN** the session of AW-7 runs `aw message AW-7 "Tests pass"`
- **THEN** AW-7 has `message.agent` with the source `tool`
