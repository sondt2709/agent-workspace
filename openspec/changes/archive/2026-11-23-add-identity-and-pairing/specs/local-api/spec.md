## ADDED Requirements

### Requirement: Identity, device, pairing and credential routes
The local API SHALL serve `GET /v1/identity`, `GET /v1/identity/phrase`, `GET /v1/workspaces/{ws}/devices`, `POST /v1/workspaces/{ws}/devices/{device}/revoke`, `POST /v1/workspaces/{ws}/pairing`, `GET /v1/pairing/{id}`, `POST /v1/pairing/{id}/approve {check_code}`, `DELETE /v1/pairing/{id}`, `POST /v1/pairing/join {code, path?, slug?, name?}`, `GET|POST /v1/workspaces/{ws}/credentials`, `DELETE /v1/workspaces/{ws}/credentials/{name}` and `GET /v1/workspaces/{ws}/credentials/{name}/value`. A credential value SHALL be in a request body or in the reply of the value route only, never in a path, a query or a log line. `@aw/client/identity` SHALL have the zod schemas and a typed client.

#### Scenario: No master key
- **WHEN** a device without the master key sends `POST /v1/workspaces/-/pairing`
- **THEN** the reply is 403 `refused`

#### Scenario: Credential value in the log
- **WHEN** a client adds a credential and reads its value
- **THEN** no awd log line has the value

## MODIFIED Requirements

### Requirement: Sync routes
The local API SHALL serve `GET /v1/sync` (the engine state, this device's sync id and the status of each peer with its text), `POST /v1/sync/now` with an optional `timeout_ms` (the Sync now result and the status), `POST /v1/sync/pause`, `POST /v1/sync/resume`, `POST /v1/sync/peers` (`{device_id, addresses, name?, role?}`) and `DELETE /v1/sync/peers/{device}`. Without a running engine, each route except `GET /v1/sync` SHALL answer 503 `not_ready` with the engine state. `POST /v1/sync/peers` shares each folder, `secure` too, with a device id that has no signed device record: it is a test path only (pairing adds the peers from the signed records), the peer stays in memory until the next awd start, and awd SHALL answer it with 403 `refused` unless `AW_SYNC_TEST_PEERS` is `on`.

#### Scenario: Sync now
- **WHEN** a client sends `POST /v1/sync/now` and each peer is synced
- **THEN** the reply has `pending: []` and the time of the result

#### Scenario: Test peers off
- **WHEN** a client sends `POST /v1/sync/peers` and `AW_SYNC_TEST_PEERS` is not `on`
- **THEN** the reply is 403 `refused`, it names the setting, and the engine gets no new device

#### Scenario: No engine
- **WHEN** a client sends `POST /v1/sync/now` and the engine is not installed
- **THEN** the reply is 503 `not_ready` and names the state `not_installed`
