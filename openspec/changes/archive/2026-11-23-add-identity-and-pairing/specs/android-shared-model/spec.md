## ADDED Requirements

### Requirement: Kotlin revoke rule
The Kotlin merge SHALL apply the revoke rule of the TypeScript merge: an event of a revoked device whose HLC sorts after `revoked_at` is not applied, with the reason `device_revoked`, and a change of a device record folds each task and the workspace log again. The Kotlin merge does not check signatures yet.

#### Scenario: Same view for device-revoked
- **WHEN** the Kotlin JVM test merges `contracts/fixtures/merge/device-revoked` in 40 read orders
- **THEN** each view equals `expected.json` of the TypeScript engine
