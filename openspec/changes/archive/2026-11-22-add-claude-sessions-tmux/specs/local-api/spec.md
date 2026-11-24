## MODIFIED Requirements

### Requirement: Probes and headers
The local API SHALL serve `GET /healthz`, `GET /readyz` and `GET /version`. `/readyz` SHALL answer 503 until awd opened each workspace (its first index write) or recorded why it did not open. It SHALL report the sync engine as `not_configured` in this phase, the session host as `ok` when awd found a tmux binary, else `failed`, and the session agent as `ok` when the agent binary answers `--version`, else `failed`; neither changes the readiness. Each reply SHALL have the headers `X-AW-Version` and `X-Trace-Id`. A request `X-Trace-Id` that matches `[A-Za-z0-9_-]{1,128}` SHALL be the trace id of the reply; else awd SHALL make a new one.

#### Scenario: Trace id
- **WHEN** a client sends `X-Trace-Id: cli-test-1` to `/healthz`
- **THEN** the reply has `X-Trace-Id: cli-test-1` and an `X-AW-Version` header

#### Scenario: Bad trace id
- **WHEN** a client sends `X-Trace-Id: a b`
- **THEN** the reply has another trace id of the allowed pattern

#### Scenario: Session host
- **WHEN** awd found a tmux binary
- **THEN** `/readyz` reports `session_host: ok`

#### Scenario: Agent missing
- **WHEN** awd found tmux and `claude --version` fails
- **THEN** `/readyz` reports `session_host: ok` and `session_agent: failed`

### Requirement: Thread
`GET .../tasks/{task}/thread` SHALL return the events of the task in merge order with `applied` and `reason`, `limit` rows (default 200, maximum 1000) after the cursor `after` or from the offset `from`, and the cursor of the next page or null. `ancestors=true` SHALL add the threads of the parent tasks first.

#### Scenario: Pages
- **WHEN** a task has 5 events and a client reads pages with `limit=2`
- **THEN** 3 pages return the 5 events once each, in merge order, and the last page has `next: null`

## ADDED Requirements

### Requirement: Session routes
The local API SHALL serve `GET /v1/sessions`, `POST /v1/sessions/{session}/stop`, the agent routes `POST /v1/sessions/{session}/ask|message|stage|artifacts|handoff`, and `POST /v1/sessions/{session}/permission` for the PermissionRequest hook. Each route SHALL call the session manager. A route of an unknown or stopped session SHALL answer 403 `refused`. A route of a running session whose workspace has no session manager yet (awd starts) SHALL answer 503 `not_ready`.

#### Scenario: Unknown session
- **WHEN** a client posts to `/v1/sessions/<unknown uuid>/ask`
- **THEN** the reply is 403 with code `refused`

#### Scenario: Session of a workspace that is not attached yet
- **WHEN** awd starts and the hook of a running session posts to `/v1/sessions/<session>/permission` before the session manager of its workspace runs
- **THEN** the reply is 503 with code `not_ready`, and the hook tries again
