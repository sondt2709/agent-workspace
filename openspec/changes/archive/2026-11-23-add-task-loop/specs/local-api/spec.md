## ADDED Requirements

### Requirement: Task loop session routes
The local API SHALL have the agent routes `POST /v1/sessions/{session}/approach`, `/ready`, `/tasks`, `/gate`, `/result` and `/done` (access `agent`). Each SHALL act only on the session task (`/tasks` creates a subtask of it) and SHALL call the same method as the MCP tool.

#### Scenario: Another task
- **WHEN** the session of AW-7 posts `/v1/sessions/<session>/done` with the task AW-8
- **THEN** the reply is 403 `refused` and nothing is written
