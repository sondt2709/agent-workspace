## 1. Kotlin identity module

- [x] 1.1 Add `android/identity` (KMP `jvm()` + Android, `jvmCommonMain`), Tink 1.24.0 in the version catalog, the module in `settings.gradle.kts` and `task android:check`
- [x] 1.2 Encodings and canonical JSON (`Encoding.kt`, `CanonicalJson.kt`, `Bech32`)
- [x] 1.3 `Crypto` wrapper (Ed25519, X25519, HKDF, ChaCha20-Poly1305 with a fixed nonce, HMAC, SHA-256)
- [x] 1.4 Pairing formats: offer decode and check, request sign and check, check code
- [x] 1.5 Record verify; device key (`DeviceKey`, `DeviceKeyStore`, `SecretBox`)
- [x] 1.6 Age v1 X25519 seal and open

## 2. Shared vectors

- [x] 2.1 `shared/identity/scripts/vectors.ts` writes `contracts/test-vectors/identity.json` (TypeScript part); `vectors.test.ts` checks it and opens the Kotlin file
- [x] 2.2 Kotlin vector tests (canonical JSON, records, code, request, check code, age both ways); the Kotlin-sealed file in the vectors

## 3. Merge record check

- [x] 3.1 `MergeEngine(verifyDeviceRecord)`: `bad_signature`, `old_sequence`, `revoke_removed`
- [x] 3.2 Kotlin tests with records signed by the vector master key

## 4. Engine

- [x] 4.1 `startForPairing`, pairing devices and folder, `removePairing*`, `scanFolder`, the config step keeps pairing devices
- [x] 4.2 `removeWorkspace`, `setPeers`, `EnginePlatform.recordVerifier`
- [x] 4.3 Engine tests on the fake REST API

## 5. Phone pairing and sealer

- [x] 5.1 `PhoneIdentity` files (identity, slug, records cache) and `RecordPeers`
- [x] 5.2 `PhonePairing` state machine on an `EnginePairing` port
- [x] 5.3 `AgeCredentialSealer`; remove `PendingSealer`
- [x] 5.4 Tests: join, approved, forged record, refused, expired, wrong workspace.yaml, sealer output opens

## 6. App

- [x] 6.1 `KeystoreSecretBox`, graph wiring (identity, device key, sealer, verifier, peers after refresh)
- [x] 6.2 Pairing route and screen, QR scanner adapter (ML Kit code scanner), paste, name, check code, `ACCESS_LOCAL_NETWORK`
- [x] 6.3 Manifest permission; build the APK once with an Android SDK

## 7. Docs and checks

- [x] 7.1 `docs/phase-1.md`, `docs/tech-stack.md`, `docs/engineering-rules.md`, `AGENTS.md`
- [x] 7.2 `task check` green; leak check; one commit with the archived change
