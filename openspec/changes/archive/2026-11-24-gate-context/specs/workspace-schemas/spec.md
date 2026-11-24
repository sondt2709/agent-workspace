## ADDED Requirements

### Requirement: Questions of a gate
`gate.opened` SHALL have the optional field `questions` (default `[]`): at most 10 items `{question, header, multi_select, options}`, where `question` has 1 to 2,000 characters, `header` is null or at most 100 characters, `multi_select` is a boolean (default false), and `options` has at most 20 items `{label, description}` (`label` 1 to 500 characters, `description` at most 2,000 characters, default ""). The event writer SHALL redact each string of `questions`. The generated JSON Schema, samples and Kotlin classes SHALL have the field.

#### Scenario: Old event
- **WHEN** a reader parses a `gate.opened` of an older version with no `questions`
- **THEN** the event is valid and `questions` is `[]`

#### Scenario: Redacted description
- **WHEN** the description of an option has the value of the session credential `db-password`
- **THEN** the written line has `[redacted:db-password]` in its place
