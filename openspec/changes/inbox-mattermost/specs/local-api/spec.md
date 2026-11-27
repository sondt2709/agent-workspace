## ADDED Requirements

### Requirement: Inbox routes
The local API SHALL have the person routes `GET /v1/workspaces/{ws}/inbox/cards`, `GET .../inbox/cards/{card}`, `POST .../inbox/cards/{card}/state`, `POST .../inbox/cards/{card}/ask`, `POST .../inbox/cards/{card}/reply`, `POST .../inbox/cards/{card}/task`, `POST .../inbox/run`, `GET .../sources`, `PUT .../sources/{source}`, `GET .../sources/{source}/conversations` and `GET .../sources/{source}/status`. An agent token SHALL get 403. `contracts/openapi.yaml` SHALL describe them.

#### Scenario: Agent token
- **WHEN** a session token calls `POST /v1/workspaces/{ws}/inbox/cards/{card}/reply`
- **THEN** awd answers 403 and writes no event
