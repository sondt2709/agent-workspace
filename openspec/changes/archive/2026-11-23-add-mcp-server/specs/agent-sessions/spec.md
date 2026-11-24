## ADDED Requirements

### Requirement: Session token lifetime
awd SHALL mint the session token before the first window of a session opens, SHALL keep it over each resume and each new start of the same session, and SHALL revoke it when the session state becomes `stopped`, `moved`, `replaced`, `ended` or `failed`. A session record that runs with no token file SHALL get a token at its next window open.

#### Scenario: Move to another device
- **WHEN** the person assigns a running task to `claude@ubuntu-01`, and the session on this device stops with `moved`
- **THEN** the token of that session gets 401 on the MCP endpoint and on the local API

#### Scenario: Resume keeps the token
- **WHEN** the agent process of a session dies and awd resumes the session
- **THEN** the resumed agent has the same `AW_MCP_TOKEN` as before
