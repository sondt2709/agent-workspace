## ADDED Requirements

### Requirement: Message to a session
`POST /v1/workspaces/{ws}/tasks/{task}/messages {text}` SHALL write `message.sent {id, text, to_session}` to the log of this device, with `to_session` = the running session of the task, as `human@<device>`. The reply SHALL have the event and the merge decision. A task with no running session SHALL give 409 `conflict` and write nothing. An empty text SHALL give 400 `invalid_input`.

#### Scenario: Message to the running session
- **WHEN** the task `AW-3` has a running session `s1` and a client sends the text "Use the staging database"
- **THEN** the log of this device has a `message.sent` line with that text and `to_session: s1`, and the session device delivers it as `[AW message <id> from <device>] Use the staging database`

#### Scenario: No session
- **WHEN** the task has no running session
- **THEN** the reply is 409 `conflict` and the log has no new line
