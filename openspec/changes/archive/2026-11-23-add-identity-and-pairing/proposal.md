## Why

Devices of a person have no real identity yet. awd makes the device from the host name, any device id can get the `secure` folder through a test gate (`AW_SYNC_TEST_PEERS`), and credentials have no encryption. Phase 1 needs signed device records, pairing with one code, revoke, and encrypted credentials that only computers can read (`docs/phase-1.md` 7, `docs/architecture.md` 4.1, task-model decision §4 and §5.3).

## What Changes

- New package `shared/identity` (`@aw/identity`): the master key from a 24-word recovery phrase (Ed25519), the device keys (Ed25519 and X25519), the user id, signed device records (canonical JSON, Ed25519), the pairing code `aw1:…` with its HMAC and 6-digit check code, sealing with the age format, and the keystore (OS keystore through `@napi-rs/keyring`, a 0600 file fallback).
- awd identity (`daemon/src/service/identity.ts`): each device makes its device key at the first start. The local device makes the master key when it creates its first workspace, and signs its own device record. `config.yaml` keeps the device slug, name and role; pairing and the signed record set them, not the host name. `<AW_HOME>/identity.yaml` keeps the user id and the master public key.
- Device records: awd checks the master-key signature of each `devices/<device>/device.yaml` and keeps the highest sequence number. The sync peers come from the valid records (full mesh, `secure` only with computers). **BREAKING** (unreleased): `<AW_HOME>/sync-peers.json` is no longer used by awd; `POST /v1/sync/peers` stays a test path behind `AW_SYNC_TEST_PEERS`.
- Revoke: `aw device revoke <device>` writes a signed record with `revoked: true`, a new sequence number and `revoked_at`. The merge ignores each task and workspace event of the revoked device after `revoked_at` (reason `device_revoked`). Each awd removes the revoked peer. awd makes a new credential key, encrypts each credential again and seals the key to each remaining computer.
- Pairing: `aw device add` (and `POST /v1/workspaces/{ws}/pairing`) shows a one-time code and a QR code (10 min, single use). `aw pair <code>` (and `POST /v1/pairing/join`) on the new device joins through the engine: a pairing folder `aw-pair-<nonce>` carries the request with an HMAC; both sides show the same check code; `aw device approve <pairing> <check code>` signs the record, adds the peer, seals the credential key to a computer and copies the knowledge history store.
- Credentials: the workspace credential key (an age X25519 identity) sealed to each computer in `secure/keys/<device>.age`; values in `secure/credentials/<name>.age`; `aw credential add|list|remove|get` (values from stdin or a file, never in argv). A computer imports each phone file `devices/<phone>/sealed/<id>.age` into `secure/` and writes `credential.imported`. awd gives the values to the redaction of the files layer and to the knowledge store (`setSecrets`).
- Schema (minor): `device.v1` gets `addresses` and `revoked_at`; `credential.imported` gets `sealed`. The layout gets `secure/keys/<device>.age`. The files layer gets `removeCredentialFile`.
- The Kotlin merge in `android/shared` gets the same revoke rule and the new merge case `device-revoked`.
- CODEOWNERS line for the identity code.

## Capabilities

### New Capabilities
- `device-identity`: keys, master key and recovery phrase, keystore, signed device records, record checks, revoke.
- `device-pairing`: the pairing code and QR code, the pairing protocol through the engine, the pairing API and commands.
- `credentials`: the workspace credential key, credential files, the credential commands, the phone outbox import and the secrets for the redaction.

### Modified Capabilities
- `workspace-merge`: the revoke rule and the check of device records (signature, sequence number).
- `workspace-files`: the `secure/keys/<device>.age` rule and the `removeCredentialFile` delete.
- `workspace-schemas`: new optional fields of `device.v1` and `credential.imported`.
- `sync-engine`: the peers come from awd (signed records); the pairing devices and folders.
- `local-api`: the identity, device, pairing and credential routes; the sync peers route text.
- `aw-cli`: the identity, device, pair and credential commands.
- `awd-service`: the device configuration and the identity at start.
- `android-shared-model`: the Kotlin merge has the revoke rule.

## Impact

- New package `shared/identity` with the dependencies `@noble/curves`, `@noble/hashes`, `@scure/bip39`, `@scure/base`, `age-encryption`, `@napi-rs/keyring` (rows in `docs/tech-stack.md`; `@scure/*` are new rows). `daemon` adds `qr`.
- `shared/schema` (generated JSON Schemas, samples, Kotlin classes), `shared/core` (layout rule, delete, merge rule, record check), `plugins/sync-syncthing` (peers from awd, pending devices and folders, the pairing folder), `daemon` (identity, pairing and credential services, routes, commands, settings `AW_KEYSTORE`), `shared/client` (`@aw/client/identity`), `contracts/openapi.yaml`, `contracts/fixtures/merge/device-revoked`, `android/shared` (merge rule, case list), `e2e/` (pairing in Docker), `.github/CODEOWNERS`.
- Docs: `docs/phase-1.md` 3.1, 6.1, 6.2, 6.8, 7, 10.2; `docs/architecture.md` 4.1; `docs/tech-stack.md`; `AGENTS.md` Status.
- Undo: revert the commit. No released data exists.
