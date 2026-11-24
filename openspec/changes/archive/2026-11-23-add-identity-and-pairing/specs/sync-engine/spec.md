## MODIFIED Requirements

### Requirement: Peers
The transport SHALL add a peer from its slug, sync device id, role and addresses, and remove it by its slug. A device id with a wrong form or wrong check characters SHALL be bad input. A peer added during a pause SHALL be paused. The transport SHALL share each folder with each peer (full mesh, introducer and auto-accept off), `secure` only with computers, and set the reconnect interval to 5 s until each new peer is connected or 10 min passed, then to 60 s. awd SHALL give the peers with `setPeers()` from the signed device records and SHALL not keep a peers file (`persistPeers: false`). With `persistPeers` on (the plugin default for its own tests), the transport SHALL write a new peer to `<AW_HOME>/sync-peers.json` (mode 0600) only after the engine has the device and the folders. For pairing, the transport SHALL list the pending devices and folders of the engine, add a device with no workspace folder, add and remove the folder `aw-pair-<nonce>`, and remove a pairing device.

#### Scenario: Pair by REST only
- **WHEN** each of 2 devices adds the other with `aw sync peer add <device-id> <address>` and `AW_SYNC_TEST_PEERS=on`
- **THEN** the devices connect, and a task created on one device appears on the other

#### Scenario: Set peers
- **WHEN** awd calls `setPeers` with 1 peer and later with an empty list
- **THEN** the engine has the device with the 3 folders, then no device, and no peers file exists

#### Scenario: Pending device and pairing folder
- **WHEN** an engine that does not know a device gets a connection from it, and the device shares `aw-pair-<nonce>`
- **THEN** the pending list has the device, then after the add the pending folders have `aw-pair-<nonce>`, and after the folder add a file of the device arrives
