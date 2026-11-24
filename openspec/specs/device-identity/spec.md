# device-identity Specification

## Purpose
The master key and the recovery phrase, the device keys, the keystore, the signed device records, their check, the sync peers from the records and the revoke (`shared/identity`, `daemon/src/service/identity.ts`, `devices.ts`).
## Requirements
### Requirement: Identity package
`@aw/identity` SHALL give: a new 24-word recovery phrase, the master key pair from a phrase (Ed25519, HKDF-SHA256 of the BIP-39 seed), the user id from the master public key, a new device key (Ed25519 and an age X25519 identity), the age recipient of a device record, `signRecord`, `verifyRecord`, `seal` and `open` (age format, one or more recipients). A phrase with a wrong checksum SHALL be refused.

#### Scenario: Same phrase, same key
- **WHEN** a test derives the master key 2 times from the same phrase
- **THEN** both public keys and both user ids are equal, and a phrase with one changed word is refused

#### Scenario: Seal to 2 recipients
- **WHEN** a value is sealed to the X25519 keys of 2 devices
- **THEN** each device opens it with its own identity, and a third device cannot open it

### Requirement: Keystore
awd SHALL keep the device key and the recovery phrase in the keystore that `AW_KEYSTORE` selects: `os` (the OS keystore through `@napi-rs/keyring`) or `file` (`<AW_HOME>/keys/<name>`, mode 0600, folder 0700). The default SHALL be `os` on macOS with the default state folder when `<AW_HOME>/keys/device` does not exist, and `file` on other platforms, with `AW_HOME`, or when `<AW_HOME>/keys/device` exists (after `aw service move-keys`). A key SHALL never be in a log line, an event, a synced file or `config.yaml`.

#### Scenario: File keystore modes
- **WHEN** awd starts with `AW_KEYSTORE=file` and no key
- **THEN** `<AW_HOME>/keys/device` exists with mode 0600 in a folder with mode 0700, and a second start uses the same key

#### Scenario: Bad setting
- **WHEN** `AW_KEYSTORE` is `vault`
- **THEN** the settings module throws an error that names the allowed values

#### Scenario: Moved key
- **WHEN** awd starts on macOS with the default state folder, no `AW_KEYSTORE`, and `~/.aw/keys/device` exists
- **THEN** the keystore is `file`

### Requirement: Device key and master key
awd SHALL make the device key of this device at the first start. The first `aw workspace init` of a new workspace on a device with no identity SHALL make the master key, save the user id and the master public key in `<AW_HOME>/identity.yaml`, write the signed record of this device (`seq` 1, its keys, its sync device id, its addresses) to `tasks/devices/<device>/device.yaml`, and make the workspace credential key. A device that registers an existing folder SHALL make no master key. `aw identity show` SHALL print the user id, the device and the public keys; `aw identity phrase` SHALL print the recovery phrase only on a device with the master key.

#### Scenario: First workspace
- **WHEN** a new local device runs `aw workspace init <path> --name acme`
- **THEN** `tasks/devices/<device>/device.yaml` has a valid signature of the master key and `secure/keys/<device>.age` exists

#### Scenario: Phrase on a device without the master key
- **WHEN** `aw identity phrase` runs on a paired remote device
- **THEN** it exits with 1 and prints no phrase

### Requirement: Device record check
Each awd that knows the master public key SHALL use only device records with a valid master-key signature over the record as written, and for each device only the highest `seq` that it read. A record that fails SHALL be the issue `bad_document` with the reason `bad_signature` or `old_sequence`, and the last valid record SHALL stay. `aw device list` SHALL show each device with its role, state (`valid`, `revoked`, `bad_signature`) and sync device id.

#### Scenario: Changed role
- **WHEN** another device changes the role in a signed record from `remote` to `local`
- **THEN** the view keeps the old record and the issue has the reason `bad_signature`

#### Scenario: Old record again
- **WHEN** a record with `seq` 1 replaces a valid record with `seq` 2
- **THEN** the view keeps `seq` 2 and the issue has the reason `old_sequence`

### Requirement: Durable records
The device with the master key SHALL write the kept record of a device again when the file on disk is missing, has no valid signature, has a lower `seq`, or drops a kept revoke, so that each device gets the newest record through sync again. A revoke SHALL be final in the merge (workspace-merge "Device record check in the merge").

#### Scenario: Revoked device undoes the revoke
- **WHEN** the revoked device `ubuntu-01` removes its revoke record, or writes its old record with `seq` 1 back
- **THEN** the local device keeps `ubuntu-01` revoked and not a peer, and writes the revoke record again

### Requirement: Peers from device records
awd SHALL add each device of a valid, not revoked record (other than this device) as a sync peer, with its role, its sync device id and its record addresses plus `dynamic`, and remove each other peer. Each workspace has its own `seq`: awd SHALL compare `seq` only inside one workspace, and a device (device key or sync device id) that one workspace revokes SHALL be no peer. It SHALL not read `<AW_HOME>/sync-peers.json`. The peers SHALL be computed again after each change of a device record.

#### Scenario: New record arrives
- **WHEN** a valid record of `mac-mini-lab` arrives on `ubuntu-01`
- **THEN** the engine of `ubuntu-01` has `mac-mini-lab` with the `tasks`, `knowledge` and `secure` folders

#### Scenario: Revoke in one of 2 workspaces
- **WHEN** workspace `beta` revokes `edge-01` (`seq` 2) and the first workspace has a valid record of `edge-01` with `seq` 3
- **THEN** the engine has no device `edge-01`

### Requirement: Revoke a device
`aw device revoke <device>` (and `POST /v1/workspaces/{ws}/devices/{device}/revoke`) SHALL run only on a device with the master key. It SHALL write the record again with `revoked: true`, `seq` + 1, `revoked_at` (the HLC of this device) and a new signature; make a new credential key, write each credential again with it and seal it to each remaining computer. A credential that no key of this awd opens SHALL keep its file, and the reply SHALL name it (`closed`); when this device cannot open its own credential key, the reply SHALL name each credential file. awd SHALL keep the old credential keys in memory: the device with the master key SHALL write a credential that only an old key opens (a file that another computer wrote during the revoke) again with the current key. Before it removes the revoked device from its engine, awd SHALL keep it as a peer until the engine reports that the device has the new record, the device is not connected, or 10 s pass. The reply SHALL come after the removal, also when a step after the record write fails. The reply SHALL say if the device confirmed its record (`delivered`); when it did not, the CLI and the desktop SHALL say that its agent sessions continue and that the person stops them on that device. Each awd SHALL remove the revoked device from its engine. A revoke of this device or of an unknown device SHALL be refused.

#### Scenario: Revoke ubuntu-01
- **WHEN** the local device revokes `ubuntu-01`
- **THEN** the record has `revoked: true` and `seq` 2, the engine has no device `ubuntu-01`, and each credential opens with the new key but not with the key that `ubuntu-01` has

#### Scenario: Revoked device online
- **WHEN** `ubuntu-01` is connected and runs a session of a task when `macbook-pro` revokes it
- **THEN** `ubuntu-01` gets its revoke record before the peer goes, stops the session with the state `stopped`, and starts no new session

#### Scenario: Revoked device offline
- **WHEN** `ubuntu-01` is offline when `macbook-pro` revokes it
- **THEN** the reply has `delivered: false`, and `aw device revoke` prints "ubuntu-01 did not get the revoke, so its agent sessions continue. Stop them on that device, or turn it off."

#### Scenario: Rotation fails after the record write
- **WHEN** the credential rotation of a revoke fails, for example on a full disk
- **THEN** the revoke answers an error, and the engine has no device `ubuntu-01`
