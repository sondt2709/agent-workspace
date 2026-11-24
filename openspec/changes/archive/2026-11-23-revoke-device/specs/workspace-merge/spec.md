## MODIFIED Requirements

### Requirement: Presence
The merge SHALL mark a device offline when this device received no new heartbeat for 90 seconds. On the first read of a heartbeat file (a new engine or `rebuild()`), the receive time SHALL be the earlier of the local time and the heartbeat HLC time; on a later read, the local time of the read. `rebuild()` SHALL forget the receive times. The claimed tasks of an offline owner (the claim device is the owner) that are not done, archived or paused SHALL show `device_offline`. The task SHALL wait: presence SHALL not open a gate, move the task or put it in the "Needs you" lane, also after a long time offline. A task that is not done and not archived, whose device (the device of the assignee, else the device of the claim) has a kept record with `revoked: true`, SHALL show `device_revoked` with the device and the time of `revoked_at`, also when the task has its own pause. This row SHALL replace a `device_offline` row of the task. The TypeScript and the Kotlin merge SHALL give the same presence.

#### Scenario: Device goes offline
- **WHEN** the last heartbeat of `ubuntu-01` is 4 minutes old and it owns a task in Implement
- **THEN** `ubuntu-01` is offline and the task shows `device_offline`

#### Scenario: Device offline for a long time
- **WHEN** `ubuntu-01` is offline for 2 hours and owns a task in Implement
- **THEN** the task still shows only `device_offline`, its owner and assignee do not change, and it has no "Needs you" reason from presence

#### Scenario: Device revoked
- **WHEN** the record of `ubuntu-01` is revoked at 14:20:00 and `ubuntu-01` holds the claim of a task in Implement assigned to `claude@ubuntu-01`
- **THEN** `offline_tasks` has the task with the cause `device_revoked`, the device `ubuntu-01` and the time `2026-11-22T14:20:00.000Z`

#### Scenario: Task assigned to another device
- **WHEN** the person assigned the task of revoked `ubuntu-01` to `claude@macbook-pro`
- **THEN** the task has no `device_revoked` row

#### Scenario: Merge case device-revoked
- **WHEN** the TypeScript and the Kotlin engine merge `contracts/fixtures/merge/device-revoked`
- **THEN** both presences equal `expected.json`, with one `device_revoked` row for the task of ubuntu-01
