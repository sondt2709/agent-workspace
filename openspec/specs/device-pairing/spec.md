# device-pairing Specification

## Purpose
Pairing of a device with a one-time code and QR code through the sync engine: the code, the request with its HMAC, the check code, the approval and the end of the pairing (`shared/identity`, `daemon/src/service/pairing.ts`).
## Requirements
### Requirement: Pairing code
A device with the master key SHALL start a pairing of a workspace with `aw device add` or `POST /v1/workspaces/{ws}/pairing`. The reply SHALL have the pairing id, the code `aw1:<base64url JSON>`, the QR code of the code as SVG, the expiry (10 min) and the state. The pairing id SHALL be the nonce in hex (it never starts with `-`). The code SHALL hold the user id, the master public key, the workspace id (a UUIDv7; a code with any other id SHALL be refused as invalid, because the new device uses it in paths) and name, the slug, Ed25519 key, sync device id and addresses of the showing device, a nonce, a one-time secret and the expiry. A device without the master key SHALL get 403 `refused`. A workspace SHALL have one open pairing at a time: a second start while one is open SHALL get 409 `conflict`.

#### Scenario: Second pairing of a workspace
- **WHEN** a pairing of a workspace is open and the human starts another one
- **THEN** the API replies 409 `conflict`, and `aw device add` exits with 1 and names the open pairing

#### Scenario: Start on a remote device
- **WHEN** a paired remote device runs `aw device add`
- **THEN** it exits with 1 and names the master key

#### Scenario: Code round trip
- **WHEN** a test encodes an offer and decodes the code
- **THEN** each field is equal, and a code with a changed character or another prefix is refused as invalid

#### Scenario: Workspace id with a path
- **WHEN** a device runs `aw pair` with a code whose workspace id is `../../.claude/settings`
- **THEN** it exits with 2, and no file is written outside the state folder

### Requirement: Join with a code
`aw pair <code>` (`aw pair -` reads the code from stdin, so it stays out of the shell history) (and `POST /v1/pairing/join {code, path?, parent?, slug?, name?}`) SHALL refuse an expired or invalid code, a code of a workspace that is registered already, a code whose pairing runs on this device already (409 `conflict`), a device with a master key, a path or parent that is not absolute (the CLI makes `--path` and `--in` absolute against its working folder), and a folder that the rules of the `workspace-folder` capability refuse (409 `conflict`, before any change). `--path` SHALL be the workspace folder itself; `--in` (`parent`) SHALL be the location that holds it; with neither, the location SHALL be `~/AW`. The folder of a location SHALL follow the folder rule (`<name>`, then `<name>-aw1` ..). It SHALL add the showing device to its engine, share the pairing folder `aw-pair-<nonce>` with `request.json` (slug, name, role `remote`, keys, sync device id, addresses, an Ed25519 signature with its device key, HMAC-SHA256 with the secret) and show the check code. The pairing view SHALL have `folder` and `folder_note`, and `aw pair` SHALL print the folder. When the engine does not add the pairing device or folder, the pairing SHALL end as `failed` (503 `not_ready`), so the same code works again. `aw pair` SHALL wait until the pairing is done, failed or expired, and exit with 0 only when it is done.

#### Scenario: Expired code
- **WHEN** a device runs `aw pair` with a code whose expiry is past
- **THEN** it exits with 2, names the expiry, and the engine gets no new device

#### Scenario: Folder of another workspace
- **WHEN** a device runs `aw pair <code> --path <folder>` and the folder has `tasks/workspace.yaml` of another workspace
- **THEN** it exits with 1, names the other workspace, and the engine gets no new folder

#### Scenario: Location with a taken name
- **WHEN** ubuntu-01 runs `aw pair <code> --in /srv/work` for the workspace "demo", and `/srv/work/demo` holds other files
- **THEN** the pairing view has `folder: /srv/work/demo-aw1`, `aw pair` prints that folder and the note, and after the approval awd registers `/srv/work/demo-aw1`

### Requirement: Accept and approve a request
While a pairing is open, the showing awd SHALL add each pending device of the engine with no workspace folder, accept only the pending folder `aw-pair-<nonce>` of the open pairing (from a pending device of the pairing or from a peer already), and check the HMAC of the request and its signature with the Ed25519 key of the request (the public keys of the devices are not secret). The first valid request SHALL use the code; a later request and a request with a wrong HMAC SHALL be refused. A device whose request is refused, or that writes no request 60 s after its folder was accepted, SHALL be removed, and it MAY offer again. Both devices SHALL show the same 6-digit check code; it SHALL cover the keys and sync device id of the showing device and each field of the request without its HMAC and its signature, so another X25519 key or sync device id gives another code. `aw device approve <pairing> <check code>` SHALL take the code with or without the space, and SHALL refuse a wrong check code, a second approve while one runs, a request with the slug, Ed25519 key or sync device id of the showing device, a slug that a valid record of another key has, and a slug, device key or sync device id of a revoked record; it SHALL check that it can open the credential key before it writes a record. Else it SHALL sign the record of the new device (once per pairing, also after a failed later step), write it, seal the credential key to it, copy the knowledge history store (each version, not `seen.json`) into a new `history` folder of the pairing folder, write `response.json` with the newest signed record of each device of the workspace (revoked ones too) and add the peer. While approve runs, the code SHALL NOT expire and a cancel SHALL get 409 `conflict`. The showing device SHALL end the pairing as `done` only on `done.json` or on a heartbeat of the new device that is newer than at the approval.

#### Scenario: Second use of a code
- **WHEN** a second device sends a request with the HMAC of a code that a first device used
- **THEN** the showing device refuses it, and the second device gets no record

#### Scenario: Revoked device pairs again
- **WHEN** a device asks to pair with the slug of a revoked device, and the human approves with the right check code
- **THEN** it exits with 1, names the revoke, and no record is written

#### Scenario: Same Ed25519 key with another X25519 key
- **WHEN** a request has the Ed25519 key of the new device but another X25519 key or sync device id
- **THEN** the check code differs from the code that the new device shows

#### Scenario: Request with a known public key
- **WHEN** a code holder sends a request with the Ed25519 key of a known device, signed with another key
- **THEN** the showing device refuses the request, and the check code is never shown

#### Scenario: Cancel and expiry during the approval
- **WHEN** the human cancels the pairing, or the code expires, while approve runs
- **THEN** the cancel exits with 1, the pairing stays open, and approve ends with `approved`

#### Scenario: Wrong check code
- **WHEN** the human runs `aw device approve <pairing> 000000` and the check code is another number
- **THEN** it exits with 1 and no record is written

### Requirement: Finish the pairing
The new device SHALL accept `response.json` only when each record has a valid signature of the master public key of the code and its own record has its keys and its sync device id. It SHALL then save the identity, set its slug and role in `config.yaml`, copy the history into `<AW_HOME>/history/<workspace>/`, add the workspace folders at the path (default `~/AW/<workspace name>`), wait for `tasks/workspace.yaml`, check that its id is the workspace id of the code (else remove the folders from the engine and end as `failed`), register the workspace and write `done.json`. Both devices SHALL remove the pairing folder. The `secure` folder SHALL be shared only between computers. An awd restart SHALL end an open pairing.

#### Scenario: Pair a remote computer in Docker
- **WHEN** `macbook-pro` runs `aw device add`, `ubuntu-01` runs `aw pair <code>`, and the human approves with the check code that `ubuntu-01` shows
- **THEN** both devices have both valid records, the 3 folders sync, a task created on one device appears on the other, and no pairing folder is left

