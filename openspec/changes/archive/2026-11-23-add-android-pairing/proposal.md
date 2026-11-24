## Why

The phone has the sync engine and the screens, but it cannot pair. The peers come from a test file (`sync-peers.json`), the phone does not check the signatures of the device records, and "Add credential" is off because the phone has no age sealer. identity-pairing built the computer side; this change builds the phone side, so a person can pair a phone with one code or QR and add a credential from the phone.

## What Changes

- New Kotlin module `android/identity` (`:identity`): canonical JSON, base64, base64url and bech32, the pairing code `aw1:` (decode and check), the pairing request with its Ed25519 signature and its HMAC, the 6-digit check code, the device record signature check (`aw-device-record-v1`), the phone device key (Ed25519 and X25519) and an age v1 X25519 sealer and opener on Tink 1.24 primitives.
- New test vectors `contracts/test-vectors/identity.json`: the TypeScript package writes and checks the deterministic values (canonical JSON, records, pairing code, request, check code, an age file sealed in TypeScript); the Kotlin tests check the same values, and an age file sealed by Kotlin opens in the TypeScript test.
- Phone pairing (`android/control` `PhonePairing`): join with a code through the engine (pairing device and folder `aw-pair-<nonce>`, `request.json`, `response.json`, `done.json`), the check of each signed record with the master public key of the code, the phone identity file, the device slug, the peers from the records and the workspace folders.
- Engine (`android/engine`): the engine starts for a pairing with no workspace; pairing devices and folders; the config step keeps the pairing devices; remove a workspace; set the peers from the records.
- Merge (`android/shared`): `MergeEngine` takes an optional record verifier and applies the TypeScript rules `bad_signature`, `old_sequence` and `revoke_removed` when the phone knows the master public key.
- App: a pairing screen (scan the QR with the ML Kit code scanner, paste as a fallback, the check code, the state), the `ACCESS_LOCAL_NETWORK` request on Android 17, the device key encrypted with an AES key of the Android Keystore, the age sealer in place of `PendingSealer` (Add credential turns on).
- Docs: `docs/phase-1.md` (7, 6.7, 10.2), `docs/tech-stack.md` (Tink and the code scanner rows), `docs/engineering-rules.md` (exception row for the code scanner release age), `AGENTS.md`.

## Capabilities

### New Capabilities
- `android-identity`: the Kotlin identity formats and crypto of the phone, with the shared test vectors.
- `android-pairing`: the phone joins a workspace with a pairing code or QR, through the engine, and keeps its identity and device key.

### Modified Capabilities
- `android-app`: the credential outbox uses the age sealer; the Devices screen has "Pair with a computer".
- `android-shared-model`: the Kotlin revoke rule now also checks the record signatures when the master public key is known.
- `android-sync-engine`: the engine starts for a pairing, keeps the pairing devices and folders, and takes its peers from the signed records.
- `repository-tooling`: `task android:check` also runs the checks of `:identity`.

## Impact

- New Gradle module `android/identity`; new dependencies Tink `tink` 1.24.0 and `play-services-code-scanner` 16.1.0 (app only).
- `android/shared` `MergeEngine` constructor (new optional parameter), `android/engine` `SyncEngineController` and `EngineSetup`, `android/control` `Credentials.kt`, `android/app` manifest, graph and screens.
- `shared/identity`: a new test that checks the vectors file; no change to the TypeScript behavior.
- No change to the local API, the CLI or the file format. The phone files `<files>/identity.json`, `<files>/device-key.bin`, `<files>/records/<ws>.json` and `<files>/pairing/<nonce>/` are new local state of the phone.
