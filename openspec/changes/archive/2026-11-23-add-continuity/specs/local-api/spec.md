## ADDED Requirements

### Requirement: Slot session routes
The local API SHALL have the agent routes `POST /v1/sessions/{session}/slots/acquire` and `POST /v1/sessions/{session}/slots/release` with the body `{resource}` (access `agent`). They SHALL call the slot service of the session workspace for the session task.

#### Scenario: Release with no lease
- **WHEN** a session posts `/slots/release` for a resource that it does not hold
- **THEN** the reply is 404 `not_found` and nothing is written
