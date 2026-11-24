## MODIFIED Requirements

### Requirement: Secrets for the redaction
At the open of a workspace, after each credential change and every 10 s, awd SHALL give each credential value to the redaction of the files layer and to the knowledge store (`setSecrets`). The redaction of the files layer SHALL cover the events and the text files of a task (the terminal snapshot, the approach versions and the text artifacts). A credential file that does not open for a time (a half-synced rotation) SHALL keep its last value. A value that a session got SHALL stay in the redaction while awd runs, also after a rotation or a remove. The token of each running session SHALL be in the redaction with the name `mcp-token`, from the time awd mints or loads it until awd revokes it, for the events and for the text files of a task. `aw credential get` of a file that does not open SHALL be 503 `not_ready`.

#### Scenario: Knowledge write with a value
- **WHEN** a credential exists and `aw kb write` writes a text with its value
- **THEN** the knowledge file has `[redacted:<name>]` and no value

#### Scenario: Agent message with the session token
- **WHEN** the agent of a session writes a message that contains its session token
- **THEN** the event has `[redacted:mcp-token]` and no token

#### Scenario: Long message with the session token and a value
- **WHEN** the agent writes a message of more than 32 KiB that contains its session token and a credential value
- **THEN** the file `artifacts/<device>/text-<id>.md` has `[redacted:mcp-token]` and `[redacted:<name>]`, and no token and no value
