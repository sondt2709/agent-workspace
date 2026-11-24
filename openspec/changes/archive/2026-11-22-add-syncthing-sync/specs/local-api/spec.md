## MODIFIED Requirements

### Requirement: Probes and headers
The local API SHALL serve `GET /healthz`, `GET /readyz` and `GET /version`. `/readyz` SHALL answer 503 until awd opened each workspace (its first index write) or recorded why it did not open. It SHALL report the sync engine state (`not_installed`, `starting`, `running`, `restarting`, `stopped` or `failed`) and the session host as `not_configured` in this phase. The sync engine state SHALL NOT change the readiness. Each reply SHALL have the headers `X-AW-Version` and `X-Trace-Id`. A request `X-Trace-Id` that matches `[A-Za-z0-9_-]{1,128}` SHALL be the trace id of the reply; else awd SHALL make a new one.

#### Scenario: Trace id
- **WHEN** a client sends `X-Trace-Id: cli-test-1` to `/healthz`
- **THEN** the reply has `X-Trace-Id: cli-test-1` and an `X-AW-Version` header

#### Scenario: Bad trace id
- **WHEN** a client sends `X-Trace-Id: a b`
- **THEN** the reply has another trace id of the allowed pattern

#### Scenario: Engine state
- **WHEN** the engine runs and each workspace is open
- **THEN** `/readyz` answers 200 with `sync_engine: "running"`

## ADDED Requirements

### Requirement: Sync routes
The local API SHALL serve `GET /v1/sync` (the engine state, this device's sync id and the status of each peer with its text), `POST /v1/sync/now` with an optional `timeout_ms` (the Sync now result and the status), `POST /v1/sync/pause`, `POST /v1/sync/resume`, `POST /v1/sync/peers` (`{device_id, addresses, name?, role?}`) and `DELETE /v1/sync/peers/{device}`. Without a running engine, each route except `GET /v1/sync` SHALL answer 503 `not_ready` with the engine state. `POST /v1/sync/peers` shares each folder, `secure` too, with a device id that has no signed device record: it is a test path until device pairing, and awd SHALL answer it with 403 `refused` unless `AW_SYNC_TEST_PEERS` is `on`.

#### Scenario: Sync now
- **WHEN** a client sends `POST /v1/sync/now` and each peer is synced
- **THEN** the reply has `pending: []` and the time of the result

#### Scenario: Test peers off
- **WHEN** a client sends `POST /v1/sync/peers` and `AW_SYNC_TEST_PEERS` is not `on`
- **THEN** the reply is 403 `refused`, it names the setting, and the engine gets no new device

#### Scenario: No engine
- **WHEN** a client sends `POST /v1/sync/now` and the engine is not installed
- **THEN** the reply is 503 `not_ready` and names the state `not_installed`
