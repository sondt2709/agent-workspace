## ADDED Requirements

### Requirement: Revoked devices
A device record with `revoked: true` and `revoked_at` SHALL stop the events of that device: the task fold and the workspace fold SHALL not apply an event whose device is the revoked device and whose HLC sorts after `revoked_at`, with the reason `device_revoked`. Its earlier events, its heartbeats and its comments before `revoked_at` SHALL stay. A change of a device record SHALL fold each task and the workspace log again, so the incremental update and a full read give the same view.

#### Scenario: Merge case device-revoked
- **WHEN** the engine merges `contracts/fixtures/merge/device-revoked` (the fixture folder with the record of ubuntu-01 revoked at 14:20:00)
- **THEN** the view equals `expected.json` for each read order, the task progress, the agent message and the slot release of ubuntu-01 after 14:20:00 have the reason `device_revoked`, and its earlier events are applied

### Requirement: Device record check in the merge
The engine SHALL take an optional check of device records. With the check, a record that fails SHALL be the issue `bad_document` with the reason `bad_signature`, and a valid record with a lower `seq` than the kept record SHALL be the reason `old_sequence`; the kept record SHALL stay in both cases. Without the check, the engine SHALL use each record that passes its schema.

#### Scenario: Check refuses a record
- **WHEN** the check refuses the new text of `tasks/devices/ubuntu-01/device.yaml`
- **THEN** the view has the earlier record of ubuntu-01 and the issue `bad_document` with the reason `bad_signature`
