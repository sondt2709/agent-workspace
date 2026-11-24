# android-identity Specification

## Purpose
The identity formats and the crypto of the phone in `android/identity`: canonical JSON, the pairing code and request, the check code, the device record check, the device key and the age sealer, with the shared vectors of `contracts/test-vectors/identity.json`.
## Requirements
### Requirement: Kotlin identity module
The Android project SHALL have the KMP module `:identity` (`jvm()` and Android) with the identity formats of `shared/identity`: canonical JSON (object keys sorted by UTF-16 code unit, no spaces, the string escapes of `JSON.stringify`), base64, base64url with no padding and bech32, the pairing code, the pairing request, the check code, the device record check, the phone device key and the age sealer. All Tink calls SHALL go through one wrapper class. Its JVM tests SHALL run with no Android SDK.

#### Scenario: Canonical JSON equals TypeScript
- **WHEN** the Kotlin test computes the canonical JSON of each case of `contracts/test-vectors/identity.json`
- **THEN** each result equals the `canonical` text that TypeScript wrote

### Requirement: Kotlin pairing code and request
The module SHALL decode a pairing code `aw1:` + base64url JSON with the checks of `pairingOfferSchema` (version 1, user id, 32-byte keys, UUIDv7 workspace id, slug, sync device id, nonce of 32 hex characters, secret of 43 base64url characters, ISO expiry, at most 16 addresses), SHALL give the expiry check, and SHALL refuse a damaged or invalid code with a message. It SHALL sign a request as `signRequest()` does: `sig` = Ed25519 of the device key over `aw-pair-request-sig-v1\n` + canonical JSON of the request without `sig` and `mac`, then `mac` = HMAC-SHA256 with the secret over `aw-pair-request-v1\n` + canonical JSON of the request without `mac`. The check code SHALL be the first 4 bytes of SHA-256 of `aw-check-v2\n` + canonical JSON of `{showing: {ed25519, sync_id}, request: <request without sig and mac>}`, big-endian, modulo 1,000,000, with 6 digits.

#### Scenario: Same request and check code as TypeScript
- **WHEN** the Kotlin test signs the request fields of the vectors with the device secret and the secret of the code
- **THEN** `sig`, `mac` and the check code equal the values that TypeScript wrote

#### Scenario: Bad code
- **WHEN** the code is `aw2:…`, damaged base64, or JSON with a workspace id that is not a UUIDv7
- **THEN** the decode fails with a message and no pairing starts

### Requirement: Kotlin device record check
The module SHALL verify a raw device record (the parsed YAML value) as `verifyRecord()` does: Ed25519 of the master public key over `aw-device-record-v1\n` + canonical JSON of the record without `signature`. A record with no `signature`, a changed field, or a signature of another key SHALL fail.

#### Scenario: Vectors
- **WHEN** the Kotlin test verifies each record of the vectors with the master public key
- **THEN** the result equals `valid` of each record

### Requirement: Kotlin age sealer
The module SHALL seal bytes to one or more age X25519 recipients in the age v1 format (one `X25519` stanza per recipient, the header MAC, the 64 KiB payload chunks) and SHALL open such a file with an age identity `AGE-SECRET-KEY-1…`. The opener SHALL refuse a file with a wrong header MAC, a stanza of another type only, or a damaged payload.

#### Scenario: Kotlin file opens in TypeScript
- **WHEN** the TypeScript test opens the `kotlin_sealed` file of the vectors with its identity through `openCredential()`
- **THEN** it gets the sealed credential of the vectors

#### Scenario: TypeScript file opens in Kotlin
- **WHEN** the Kotlin test opens the `typescript_sealed` file of the vectors with its identity
- **THEN** it gets the content of the vectors

#### Scenario: Changed byte
- **WHEN** one byte of the header or of the payload of a sealed file changes
- **THEN** the open fails

### Requirement: Shared identity vectors
`contracts/test-vectors/identity.json` SHALL hold the identity vectors. A script of `shared/identity` SHALL write the TypeScript part from fixed inputs, and a TypeScript test SHALL compute each deterministic value again and open the Kotlin file. The Kotlin tests SHALL read the same file.

#### Scenario: Changed format
- **WHEN** a code change makes the TypeScript or the Kotlin result differ from the file
- **THEN** the test of that language fails and names the vector
