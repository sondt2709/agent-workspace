## 1. Identity package

- [x] 1.1 Create `shared/identity` (`@aw/identity`) with the 5 standard scripts and the dependencies `@noble/curves`, `@noble/hashes`, `@scure/bip39`, `@scure/base`, `age-encryption`, `@napi-rs/keyring`
- [x] 1.2 Recovery phrase, master key, user id, device keys, age recipient conversion
- [x] 1.3 Canonical JSON, `signRecord`, `verifyRecord`
- [x] 1.4 Pairing offer code (`aw1:`), request HMAC, check code
- [x] 1.5 `seal` and `open` (age), the sealed-credential content
- [x] 1.6 Keystore: `FileKeystore`, `OsKeystore`, `openKeystore(kind)`
- [x] 1.7 Unit tests for each part (keys, records, signatures, codes, expiry, sealing)

## 2. Schemas and files layer

- [x] 2.1 `device.v1`: `addresses`, `revoked_at`; `credential.imported`: `sealed`; samples; `pnpm schema:generate`
- [x] 2.2 Layout rule `secure/keys/<device>.age`; `removeCredentialFile`; tests

## 3. Merge

- [x] 3.1 Revoke rule in the task fold and the workspace fold; refold on a device record change
- [x] 3.2 `verifyDeviceRecord` option: `bad_signature`, `old_sequence`
- [x] 3.3 Merge case `contracts/fixtures/merge/device-revoked` with `expected.json`
- [x] 3.4 Kotlin port of the revoke rule and the case list

## 4. Sync transport

- [x] 4.1 `persistPeers` option and `setPeers()`
- [x] 4.2 REST pending devices and folders, folder delete; transport pairing methods
- [x] 4.3 Real-engine test of a pending device and a pairing folder

## 5. awd

- [x] 5.1 Settings `AW_KEYSTORE`
- [x] 5.2 `IdentityService`: device key, master key at the first new workspace, own record, `identity.yaml`, records cache, verifier, peers, revoke
- [x] 5.3 `CredentialService`: credential key, add, list, remove, get, rotation, phone outbox import, secrets for the redaction
- [x] 5.4 `PairingService`: start, pending handling, request check, approve, response, join, finish, cleanup
- [x] 5.5 Wiring in `Daemon`, `WorkspaceService` (record check, master key, secrets), `SyncService` (setPeers)
- [x] 5.6 Routes and `@aw/client/identity`; `pnpm api:generate`
- [x] 5.7 Commands `aw identity`, `aw device`, `aw pair`, `aw credential`
- [x] 5.8 Daemon tests: identity, revoke, credentials, phone file, redaction, pairing between 2 awd with real engines

## 6. End to end and docs

- [x] 6.1 Docker e2e: pair with a code, records valid on both, secure only between computers, revoke, peer removed, events ignored, secret grep
- [x] 6.2 Docs: `phase-1.md`, `architecture.md`, `tech-stack.md`, `AGENTS.md`; CODEOWNERS
- [x] 6.3 `task check` passes
