## ADDED Requirements

### Requirement: Identity fields
`device.v1` SHALL have the optional fields `addresses` (a list of engine addresses, default empty) and `revoked_at` (an HLC or null, default null). The event `credential.imported` SHALL have the optional field `sealed` (the id of the phone file, or null). Both are minor changes: the generated JSON Schemas, the samples and the Kotlin classes SHALL be generated again.

#### Scenario: Old record without the new fields
- **WHEN** `device.v1` parses the device record of the fixture folder
- **THEN** the parse succeeds with `addresses: []` and `revoked_at: null`

#### Scenario: Bad revoke time
- **WHEN** a device record has `revoked_at: "yesterday"`
- **THEN** the parse fails with an issue that names `revoked_at`
