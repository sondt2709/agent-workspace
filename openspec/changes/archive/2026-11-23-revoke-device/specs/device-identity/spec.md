## MODIFIED Requirements

### Requirement: Revoke a device
`aw device revoke <device>` (and `POST /v1/workspaces/{ws}/devices/{device}/revoke`) SHALL run only on a device with the master key. It SHALL write the record again with `revoked: true`, `seq` + 1, `revoked_at` (the HLC of this device) and a new signature; make a new credential key, write each credential again with it and seal it to each remaining computer. A credential that no key of this awd opens SHALL keep its file, and the reply SHALL name it (`closed`); when this device cannot open its own credential key, the reply SHALL name each credential file. awd SHALL keep the old credential keys in memory: the device with the master key SHALL write a credential that only an old key opens (a file that another computer wrote during the revoke) again with the current key. Before it removes the revoked device from its engine, awd SHALL keep it as a peer until the engine reports that the device has the new record, the device is not connected, or 10 s pass. The reply SHALL come after the removal. Each awd SHALL remove the revoked device from its engine. A revoke of this device or of an unknown device SHALL be refused.

#### Scenario: Revoke ubuntu-01
- **WHEN** the local device revokes `ubuntu-01`
- **THEN** the record has `revoked: true` and `seq` 2, the engine has no device `ubuntu-01`, and each credential opens with the new key but not with the key that `ubuntu-01` has

#### Scenario: Revoked device online
- **WHEN** `ubuntu-01` is connected and runs a session of a task when `macbook-pro` revokes it
- **THEN** `ubuntu-01` gets its revoke record before the peer goes, stops the session with the state `stopped`, and starts no new session
