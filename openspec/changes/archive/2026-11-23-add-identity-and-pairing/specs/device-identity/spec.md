## ADDED Requirements

### Requirement: Identity package
`@aw/identity` SHALL give: a new 24-word recovery phrase, the master key pair from a phrase (Ed25519, HKDF-SHA256 of the BIP-39 seed), the user id from the master public key, a new device key (Ed25519 and an age X25519 identity), the age recipient of a device record, `signRecord`, `verifyRecord`, `seal` and `open` (age format, one or more recipients). A phrase with a wrong checksum SHALL be refused.

#### Scenario: Same phrase, same key
- **WHEN** a test derives the master key 2 times from the same phrase
- **THEN** both public keys and both user ids are equal, and a phrase with one changed word is refused

#### Scenario: Seal to 2 recipients
- **WHEN** a value is sealed to the X25519 keys of 2 devices
- **THEN** each device opens it with its own identity, and a third device cannot open it

### Requirement: Keystore
awd SHALL keep the device key and the recovery phrase in the keystore that `AW_KEYSTORE` selects: `os` (the OS keystore through `@napi-rs/keyring`) or `file` (`<AW_HOME>/keys/<name>`, mode 0600, folder 0700). The default SHALL be `os` on macOS with the default state folder, and `file` on other platforms or with `AW_HOME`. A key SHALL never be in a log line, an event, a synced file or `config.yaml`.

#### Scenario: File keystore modes
- **WHEN** awd starts with `AW_KEYSTORE=file` and no key
- **THEN** `<AW_HOME>/keys/device` exists with mode 0600 in a folder with mode 0700, and a second start uses the same key

#### Scenario: Bad setting
- **WHEN** `AW_KEYSTORE` is `vault`
- **THEN** the settings module throws an error that names the allowed values

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

### Requirement: Peers from device records
awd SHALL add each device of a valid, not revoked record (other than this device) as a sync peer, with its role, its sync device id and its record addresses plus `dynamic`, and remove each other peer. It SHALL not read `<AW_HOME>/sync-peers.json`. The peers SHALL be computed again after each change of a device record.

#### Scenario: New record arrives
- **WHEN** a valid record of `mac-mini-lab` arrives on `ubuntu-01`
- **THEN** the engine of `ubuntu-01` has `mac-mini-lab` with the `tasks`, `knowledge` and `secure` folders

### Requirement: Revoke a device
`aw device revoke <device>` (and `POST /v1/workspaces/{ws}/devices/{device}/revoke`) SHALL run only on a device with the master key. It SHALL write the record again with `revoked: true`, `seq` + 1, `revoked_at` (the HLC of this device) and a new signature; make a new credential key, write each credential again with it and seal it to each remaining computer. Each awd SHALL remove the revoked device from its engine. A revoke of this device or of an unknown device SHALL be refused.

#### Scenario: Revoke ubuntu-01
- **WHEN** the local device revokes `ubuntu-01`
- **THEN** the record has `revoked: true` and `seq` 2, the engine has no device `ubuntu-01`, and each credential opens with the new key but not with the key that `ubuntu-01` has
