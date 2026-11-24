## ADDED Requirements

### Requirement: Slot leases
`aw slot acquire <resource>` and the MCP tool `slot_acquire {resource}` SHALL ask for a lease of the resource for the session task. The device that has the resource in its `bindings.yaml` SHALL give the lease: `slot.acquired {resource, slot, fencing_token, ttl_ms, task, session}` with a TTL of 30 min and a fencing token above each earlier token of that slot. When each slot is taken, the reply SHALL be the queue position (first come, first served); a queue entry SHALL end when its session does not ask again for 2 min. A session on another device SHALL get `not_available` that names the resource device.

#### Scenario: Free slot
- **WHEN** the session of AW-7 runs `aw slot acquire k3d` on the device with `k3d: 1`
- **THEN** the reply has `slot` 0, a fencing token and `ttl_ms` 1800000, and the workspace log has `slot.acquired`

#### Scenario: Slot taken
- **WHEN** a second session asks for `k3d` while the first holds it
- **THEN** the reply has the queue position 1 and no lease

### Requirement: Renewal and release
A second acquire of the same session SHALL renew its lease (`slot.renewed`), and awd SHALL renew the lease of a running session at ttl/3 (the session heartbeat). `aw slot release <resource>` and `slot_release` SHALL write `slot.released` for the lease of the session. A lease past its expiry SHALL be revoked (`slot.revoked expired`); the lease of a session that no longer runs SHALL be released; after a new boot, each lease from before the boot SHALL be revoked with the reason `reboot`.

#### Scenario: Release at the session end
- **WHEN** a session that holds a lease ends
- **THEN** the workspace log has `slot.released` for its lease, and the next session in the queue gets the slot at its next acquire
