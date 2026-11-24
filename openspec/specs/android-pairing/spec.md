# android-pairing Specification

## Purpose
The phone joins a workspace with one pairing code or QR code through the engine, keeps its device key in the Android Keystore, and checks the signed records of the response.
## Requirements
### Requirement: Phone device key
The phone SHALL make its device key (an Ed25519 key and an age X25519 identity) once and SHALL keep it in `<files>/device-key.bin`, encrypted with AES-256-GCM by a non-exportable key of the Android Keystore. The same key SHALL be used at each later start. A file that the Keystore key cannot open SHALL be replaced by a new key, and Devices SHALL say so ("This phone could not read its device key and made a new one. …") until the person selects "OK".

#### Scenario: Same key after a restart
- **WHEN** the app reads the device key two times with the same key box
- **THEN** both reads give the same public keys

### Requirement: Phone joins with a code
The phone SHALL join a workspace with a pairing code from a QR scan or a paste, through the engine: it SHALL refuse an expired code, a code whose user id is not the user id of its master key (`u` and base32 of SHA-256[0..16], as `userIdOf`), a code of another user or of another master key when the phone has an identity, and a workspace that the phone has. A phone that has an identity and a stored slug SHALL join with that slug and SHALL ignore a typed name, so the phone has one slug in each workspace. When the showing device has that slug, or the computer refuses it as in use or revoked, the message SHALL say that the phone keeps its name and what the person can do. It SHALL write `request.json` (role `mobile`, its slug and name, both public keys, its sync device id, its addresses, `sig` and `mac`) into `<files>/pairing/<nonce>/`, add the showing device as a pairing device with no workspace folder and share the folder `aw-pair-<nonce>` with that device only, and show the 6-digit check code at once. The engine SHALL start for the pairing when the phone has no workspace. A Keystore error, a disk error or an engine that does not start SHALL end the join with a message on the screen and SHALL end the pairing mode of the engine; the app SHALL NOT stop.

#### Scenario: Join
- **WHEN** the person pastes a valid code and selects "Join"
- **THEN** the pairing folder has a request that the TypeScript `checkRequest()` accepts, the engine has the pairing device and folder, and the screen shows the check code `123 456` format

#### Scenario: Expired code
- **WHEN** the code expired
- **THEN** the phone refuses it with "The pairing code expired" and writes nothing

#### Scenario: Kept slug in use
- **WHEN** a phone paired as `pixel-9` joins workspace Acme, and awd refuses because Acme has another device `pixel-9`
- **THEN** the pairing ends `failed` with "This phone is pixel-9 in your other workspaces and keeps that name, and Acme has another device pixel-9. Remove that device from Acme on the computer, then pair again."

#### Scenario: Forged master key
- **WHEN** a code has the user id of this phone and the master key of another person
- **THEN** the phone refuses it with "The pairing code is not valid: its user id is not the user id of its master key", writes nothing and keeps its stored master key

#### Scenario: Second workspace keeps the slug
- **WHEN** a phone paired as `pixel-9` joins another workspace and the name field holds another name
- **THEN** the request has the slug `pixel-9`, and `<files>/device-slug` stays `pixel-9`

### Requirement: Phone accepts the response
The phone SHALL read `response.json` every 1 s. It SHALL accept an approved response only when each record matches the device schema and has a valid signature of the master public key of the code, the record of the phone has the keys, the sync device id and the role `mobile` of the phone, and the record of the showing device has the Ed25519 key of the code. Then it SHALL save `identity.json`, `device-slug` and `records/<ws>.json`, set the peers (the current peers of the other workspaces, except a device that a record of the response revokes, and the peers of the records), and add the workspace folders. It SHALL wait for `tasks/workspace.yaml`, check that its id is the workspace id of the code, write `done.json` and end `done`. A refused, invalid or wrongly signed response, or a `workspace.yaml` of another workspace, SHALL end the pairing `failed`; a wrong `workspace.yaml` SHALL also remove the workspace folders. No response before the expiry SHALL end it `expired`. Each end SHALL remove the pairing folder and the pairing device (unless it is a peer now).

#### Scenario: Approved
- **WHEN** the computer approves and the response has valid records
- **THEN** the phone has `identity.json`, the slug of its record, the peers of the records and the 2 workspace folders, and ends `done` after `tasks/workspace.yaml` arrives

#### Scenario: Forged record
- **WHEN** a record of the response has a signature of another key
- **THEN** the pairing ends `failed` and the phone saves no identity and adds no workspace

### Requirement: Pairing screen
The app SHALL have the screen "Pair with a computer" (from Devices and from Home when the phone has no workspace): a "Scan QR code" button (the ML Kit code scanner, when Google Play services has it), a paste field, the device name (prefilled with the phone model, the slug shown) or, on a phone that has paired before, the text "This phone joins as <slug>", "Join", the check code with the text "Check that the computer shows the same code, then approve it there", the state, and "Cancel". On Android 17 and later the screen SHALL explain and ask for `ACCESS_LOCAL_NETWORK` before the join; a refusal SHALL NOT block the join.

#### Scenario: No scanner
- **WHEN** the phone has no Google Play services code scanner
- **THEN** the screen shows the paste field only and the join works with a pasted code

#### Scenario: Join another workspace
- **WHEN** a phone paired as `pixel-9` opens "Join another workspace"
- **THEN** the screen shows "This phone joins as pixel-9" and no name field
