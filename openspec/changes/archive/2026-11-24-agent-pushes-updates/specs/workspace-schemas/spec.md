## ADDED Requirements

### Requirement: Agent message source and session link fields
`message.agent` SHALL have an optional `source` (`turn` | `tool`). `message.sent` SHALL have an optional `kind` (`nudge`). `session.started` SHALL have an optional `name` (a string or null) and an optional `terminal {window: string | null, pane: string | null}`. `session.resumed` SHALL have an optional `terminal` and optional `pids`. An event without these fields SHALL stay valid. `pnpm schema:generate` SHALL write the JSON Schemas, the samples and the Kotlin classes.

#### Scenario: Old agent message
- **WHEN** the schema parses `message.agent` `{text: "Done.", session: null}`
- **THEN** the event is valid and has no source

#### Scenario: Turn message
- **WHEN** the schema parses `message.agent` with the source `turn`
- **THEN** the event is valid, and the source `other` is not valid
