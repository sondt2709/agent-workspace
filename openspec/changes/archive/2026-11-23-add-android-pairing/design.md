## Context

identity-pairing built the computer side of identity in `shared/identity` and awd: the pairing code `aw1:`, the signed request (`sig` with the device key, `mac` with the one-time secret), the check code `aw-check-v2`, the signed device records (`aw-device-record-v1` + canonical JSON), the age sealing, and the phone outbox import on the computers. The awd that shows a code polls the pending devices and folders of its engine, accepts the folder `aw-pair-<nonce>`, reads `request.json`, and after the approval writes `response.json` with the newest signed record of each device. For a request with `role: "mobile"` it shares only `tasks` and `knowledge` and seals no credential key.

On the phone, android-engine built the engine controller (peers from `sync-peers.json`, the engine starts only when a workspace exists, the config step removes each engine device that is not a peer), android-ui built the screens, the `CredentialSealer` seam with `PendingSealer`, and the outbox. The Kotlin merge has the revoke rule, but no signature check. Android has Ed25519 in the platform only from API 33 and X25519 key agreement only from API 31; the app has minSdk 29.

## Goals / Non-Goals

**Goals:**
- The phone joins a workspace with one code (QR or paste) through the engine, as a computer does with `aw pair`, with `role: "mobile"`.
- The phone checks each signed record with the master public key of the code, and the phone merge refuses a record with a bad signature, a lower `seq` or a dropped revoke.
- The phone seals a credential with age to the X25519 keys of the computers; the file opens in TypeScript.
- The Kotlin formats equal the TypeScript formats, proved by one shared vectors file that both test suites read.

**Non-Goals:**
- The phone shows no pairing code and approves no device (it has no master key). The master key sealed to the phone (docs/phase-1.md 7.5, "a later task") is not built.
- No revoke on the phone, no workspace switch, no second workspace UI (the flow supports more than one workspace in the files).
- No separate Play and non-Play build variants (release-pipeline).
- No run on an emulator, a real phone or the Linux test server (lean mode: "Test later").

## Decisions

1. **New KMP module `:identity`** (`android/identity`, namespace `com.agentworkspace.identity`, `jvm()` + Android, code in `jvmCommonMain`), the twin of `shared/identity`. `:shared` stays free of crypto: `MergeEngine` takes a verifier function. `:control` and `:engine` depend on `:identity` only where they need it. Alternative: put the code in `:shared` (rejected: the TypeScript split is `shared/core` vs `shared/identity`, and the merge tests must not need Tink).

2. **Tink 1.24.0 (`com.google.crypto.tink:tink`) for the primitives** (the same artifact as the UnifiedPush connector: `tink-android` gave duplicate classes in the APK, and the connector's 1.23.0 now resolves to 1.24.0): `subtle.Ed25519Sign` and `Ed25519Verify` (the 32-byte seed form equals the `@noble` secret), `subtle.X25519`, `subtle.Hkdf`, and `aead.internal.InsecureNonceChaCha20Poly1305` (age needs a fixed nonce: zero for the header stanza, a counter for the payload). HMAC-SHA256 and SHA-256 come from the JDK (`Mac`, `MessageDigest`), which each Android version has. tech-stack 1.5 names Tink. Alternatives: `javax.crypto` XDH and EdDSA (API 31 and 33 only), Bouncy Castle (large, a second crypto stack). The `internal` package of Tink is a risk on an update: one class (`Crypto`) wraps all Tink calls, and the shared vectors fail on any change of the output.

3. **Own age v1 code for X25519 recipients only** (`Age.seal`, `Age.open`), about 200 lines on the primitives: the header `age-encryption.org/v1`, one `X25519` stanza per recipient (HKDF salt = ephemeral share + recipient, info `age-encryption.org/v1/X25519`, ChaCha20-Poly1305 with a zero nonce over the 16-byte file key), the header MAC (HKDF info `header`), the payload (16-byte nonce, HKDF info `payload`, 64 KiB chunks, the last-chunk flag). No scrypt, no armor, no plugins. The handoff allows "a small age implementation"; no maintained Kotlin age library meets the library criteria of `engineering-rules.md` 4.9. The opener exists for the interop tests and for the later master-key transfer; it checks the header MAC, the stanza shapes and a low-order shared secret, like `age-encryption`.

4. **Shared vectors in `contracts/test-vectors/identity.json`**. A script of `shared/identity` (`pnpm --filter @aw/identity vectors`) writes the TypeScript part from fixed inputs: canonical JSON cases, a master key from a fixed phrase, signed records (valid, changed field, other key, no signature), a pairing offer and its code, a phone request (fields, `sig`, `mac`, check code), bad codes, and an age file sealed by TypeScript to a fixed identity. The Kotlin test seals the same content with fixed randomness (file key, ephemeral keys, payload nonce); its bytes are in the file (`kotlin_sealed`). The TypeScript test `vectors.test.ts` computes each deterministic value again and opens the Kotlin file with `openCredential`; the Kotlin tests compute the same values and open the TypeScript file. So each language proves the other.

5. **The phone device key is made in software and kept encrypted with a key of the Android Keystore.** `DeviceKeyStore` writes `<files>/device-key.bin`: the JSON `{"v":1,"ed25519":<base64 seed>,"x25519":"AGE-SECRET-KEY-1…"}` (the shape of `DeviceSecret` of TypeScript), encrypted through a `SecretBox`. The app box is AES-256-GCM with the non-exportable key `aw-device-key` of `AndroidKeyStore` (API 23+); the JVM tests use a plain box. Reason: the platform keystore has no Ed25519 before API 33 and no X25519 before API 31, and the X25519 secret must open a sealed file later (the master key for the phone). A wiped Keystore key (a restore to a new phone) makes the file unreadable: the app then makes a new key, and the phone pairs again as a new device.

6. **Phone identity files**: `<files>/identity.json` (`{"user","master_public"}`), `<files>/records/<ws>.json` (the signed records of the response, until `tasks` syncs), `<files>/device-slug` (android-engine reads it), `<files>/pairing/<nonce>/` (the pairing folder). Files of the app-private storage, written with an atomic move.

7. **The pairing flow is a state machine in `:control` (`PhonePairing`)** on an `EnginePairing` port, so the JVM tests run it with a fake engine and real files: `join(code, name)` decodes and checks the code (version, expiry, UUIDv7 workspace id), refuses an identity of another user and a workspace that the phone has, writes `request.json`, adds the pairing device and folder, and shows the check code at once (the phone computes it from its own request). A loop of 1 s reads `response.json`: a refused or invalid response ends `failed`; an approved one is accepted only when each record passes the schema and the signature check, the phone record has the keys and the sync device id of the phone and the role `mobile`, and the record of the showing device has the key of the code. Then the phone saves the identity, the slug and the records, sets the peers, adds the workspace folders, waits for `tasks/workspace.yaml` (5 min after the expiry), checks its id, writes `done.json`, scans the folder and ends `done` after 3 s. A wrong `workspace.yaml` removes the workspace folders and ends `failed`. Each end removes the pairing folder from the engine, the pairing device unless it is a peer now, and the local folder. The constants and the texts are those of `daemon/src/service/pairing.ts`.

8. **Engine changes**: `startForPairing()` starts the supervisor with no workspace; `addPairingDevice`, `addPairingFolder`, `scanFolder`, `removePairingFolder`, `removePairingDevice` (the routes and values of `transport.ts`); the config step keeps the pairing devices (as awd keeps them); `removeWorkspace(id)` removes the 2 engine folders, the index registration and the folder; `setPeers(list)` replaces the peer list and applies it. `EnginePlatform.recordVerifier` gives the merge verifier of a workspace when the identity exists.

9. **Peers from the signed records**: after the accept and after each index refresh, the app computes the peers from the valid device records of each workspace (the merge keeps only valid records when it has a verifier) plus the cached response records: each record that is not revoked, is not this phone and has a sync device id; the addresses of the record or `dynamic`. The union over workspaces replaces the peer list when it differs. `sync-peers.json` stays the store of the peer list, but no test path writes it any more. A workspace with no record yet does not remove peers (the index is not loaded yet).

10. **Record check in the Kotlin merge** is a port of `#checkRecord` and `#isStickyRevoke` of `shared/core/src/merge/engine.ts`: with a verifier, a device record must verify on its raw YAML value (`bad_signature`), must not drop a kept revoke (`old_sequence`), must not have a lower `seq` (`old_sequence`), and a removed revoke record stays (`revoke_removed`). Without a verifier the behavior does not change.

11. **The age sealer of the phone** (`AgeCredentialSealer` in `:control`): the content is the JSON `{"kind":"sealed-credential","v":1,"name":<name>,"value":<value>}` (the key order of `sealCredential()`), built byte by byte from the `CharArray`, so the value never becomes a `String`; the byte buffers are cleared after the seal. Each recipient is the `keys.x25519` of a valid, not revoked computer record.

12. **Slug and name**: the screen asks for a device name, prefilled with the model name of the phone (for example "Pixel 9"); the slug is made from the name (`pixel-9`). The person sees and can change it before the join, so no OS name goes out without the person. A slug equal to the showing device is refused (the TypeScript rule).

13. **Addresses**: the request has `tcp://<IPv4>:22300` of each non-loopback interface that is up (at most 8, sorted), like `localAddresses()` of awd.

14. **QR scan**: the ML Kit code scanner (`play-services-code-scanner` 16.1.0, no camera permission) behind the `QrScanner` adapter of the app; when the Play services module is missing or fails, the screen shows only the paste field. There is one build for now; the non-Play build without the scanner comes with release-pipeline (`engineering-rules.md` 4.9.1). The scanner has no release in the last 6 months: an exception row (4.9.2) with the reason "Google SDK, stable API, the only scanner with no camera permission".

15. **`ACCESS_LOCAL_NETWORK`** is in the manifest. On API 37 and later the pairing screen explains the permission and asks for it before the join; a refusal does not block the join (sync then uses Tailscale, discovery or relays).

## Risks / Trade-offs

- [Tink `internal` class for the fixed-nonce AEAD can change] → one wrapper class; the vectors fail on any change; pinned version.
- [Own age code has a bug that the TypeScript reader accepts but another age reader does not] → the TypeScript reader is the author's own library (`typage`); the opener checks the same rules; "Test later" adds a check with the `age` CLI.
- [The Kotlin canonical JSON differs from `JSON.stringify` for a float or an unusual string] → the records have only strings, integers, booleans, null and arrays; the vectors have escapes, non-ASCII text and key order cases; a float uses the shortest form and an integral double prints with no fraction.
- [Keystore key loss] → the phone pairs again as a new device; the old record can be revoked from a computer.
- [The engine starts for a pairing with no workspace, and the app stops the engine at the next app open when the pairing failed] → `appOpened()` starts the engine only with a workspace, as before; an open pairing keeps its own session while the screen is open.
- [Peers from the index could drop a peer while the index loads] → a workspace with no valid record does not change the list.
- Nothing ran on a phone. The flow runs only in JVM tests with a fake engine (lean mode).

## Migration Plan

A phone of an earlier build has no identity: it shows "Pair with a computer". A `sync-peers.json` of a test setup stays until the first record-based peer update replaces it. Rollback: revert the commit; the phone files of this change are local state only.

## Open Questions

- The master key on the phone (docs/phase-1.md 7.5) and the phone showing a code: a later task.
- Which device approves a phone that pairs while the person is away from the computer: out of scope (the person compares the check code on the computer).
