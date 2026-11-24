## MODIFIED Requirements

### Requirement: Kotlin revoke rule
The Kotlin merge SHALL apply the revoke rule of the TypeScript merge: an event of a revoked device whose HLC sorts after `revoked_at` is not applied, with the reason `device_revoked`, and a change of a device record folds each task and the workspace log again. When the phone knows the master public key, the Kotlin merge SHALL also check each device record as the TypeScript merge does with `verifyDeviceRecord`: a record whose raw YAML value has no valid signature keeps the last valid record (issue reason `bad_signature`), a valid record that drops a kept revoke or has a lower `seq` keeps the last valid record (`old_sequence`), and a kept revoke stays when its file is removed (`revoke_removed`). Without the master public key the merge SHALL NOT check signatures.

#### Scenario: Same view for device-revoked
- **WHEN** the Kotlin JVM test merges `contracts/fixtures/merge/device-revoked` in 40 read orders
- **THEN** each view equals `expected.json` of the TypeScript engine

#### Scenario: Record with a bad signature
- **WHEN** the merge has a verifier and a device record changes one field after the signature
- **THEN** the last valid record stays and the issue reason is `bad_signature`

#### Scenario: Revoke dropped
- **WHEN** the merge has a verifier, a revoked record is kept, and a validly signed record of the same device without the revoke arrives
- **THEN** the revoke stays and the issue reason is `old_sequence`

#### Scenario: Revoke file removed
- **WHEN** the merge has a verifier and the file of a kept revoke record is removed
- **THEN** the device stays revoked and the issue reason is `revoke_removed`
