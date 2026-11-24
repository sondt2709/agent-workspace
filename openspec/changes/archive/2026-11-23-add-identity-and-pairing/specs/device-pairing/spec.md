## ADDED Requirements

### Requirement: Pairing code
A device with the master key SHALL start a pairing of a workspace with `aw device add` or `POST /v1/workspaces/{ws}/pairing`. The reply SHALL have the pairing id, the code `aw1:<base64url JSON>`, the QR code of the code as SVG, the expiry (10 min) and the state. The code SHALL hold the user id, the master public key, the workspace id and name, the slug, Ed25519 key, sync device id and addresses of the showing device, a nonce, a one-time secret and the expiry. A device without the master key SHALL get 403 `refused`.

#### Scenario: Start on a remote device
- **WHEN** a paired remote device runs `aw device add`
- **THEN** it exits with 1 and names the master key

#### Scenario: Code round trip
- **WHEN** a test encodes an offer and decodes the code
- **THEN** each field is equal, and a code with a changed character or another prefix is refused as invalid

### Requirement: Join with a code
`aw pair <code>` (and `POST /v1/pairing/join {code, path?, slug?, name?}`) SHALL refuse an expired or invalid code, a code of a workspace that is registered already, and a device with a master key. It SHALL add the showing device to its engine, share the pairing folder `aw-pair-<nonce>` with `request.json` (slug, name, role `remote`, keys, sync device id, addresses, HMAC-SHA256 with the secret) and show the check code. `aw pair` SHALL wait until the pairing is done, failed or expired, and exit with 0 only when it is done.

#### Scenario: Expired code
- **WHEN** a device runs `aw pair` with a code whose expiry is past
- **THEN** it exits with 2, names the expiry, and the engine gets no new device

### Requirement: Accept and approve a request
While a pairing is open, the showing awd SHALL add each pending device of the engine with no workspace folder, accept only the pending folder `aw-pair-<nonce>` of the open pairing, and check the HMAC of the request. The first valid request SHALL use the code; a later request and a request with a wrong HMAC SHALL be refused. Both devices SHALL show the same 6-digit check code. `aw device approve <pairing> <check code>` SHALL refuse a wrong check code and a slug that a valid record has; else it SHALL sign the record of the new device, write it, seal the credential key to it, copy the knowledge history store (each version, not `seen.json`) into the pairing folder, write `response.json` with the signed records and add the peer.

#### Scenario: Second use of a code
- **WHEN** a second device sends a request with the HMAC of a code that a first device used
- **THEN** the showing device refuses it, and the second device gets no record

#### Scenario: Wrong check code
- **WHEN** the human runs `aw device approve <pairing> 000000` and the check code is another number
- **THEN** it exits with 1 and no record is written

### Requirement: Finish the pairing
The new device SHALL accept `response.json` only when each record has a valid signature of the master public key of the code and its own record has its keys and its sync device id. It SHALL then save the identity, set its slug and role in `config.yaml`, copy the history into `<AW_HOME>/history/<workspace>/`, add the workspace folders at the path (default `~/AW/<workspace name>`), wait for `tasks/workspace.yaml`, register the workspace and write `done.json`. Both devices SHALL remove the pairing folder. The `secure` folder SHALL be shared only between computers. An awd restart SHALL end an open pairing.

#### Scenario: Pair a remote computer in Docker
- **WHEN** `macbook-pro` runs `aw device add`, `ubuntu-01` runs `aw pair <code>`, and the human approves with the check code that `ubuntu-01` shows
- **THEN** both devices have both valid records, the 3 folders sync, a task created on one device appears on the other, and no pairing folder is left
