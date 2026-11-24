# sync-transport Specification

## Purpose
The SyncTransport interface and its Syncthing transport: targeted scans, Sync now, the status of each peer and folder, and the engine events.
## Requirements
### Requirement: Sync transport interface
`@aw/plugin-api` SHALL export the `SyncTransport` interface of `docs/architecture.md` 6.1 (`id`, `start`, `stop`, `addPeer`, `removePeer`, `addFolder`, `wrote`, `syncNow`, `pause`, `resume`, `status`, `events`, and the optional `waitDelivered`) and the types `PeerStatus`, `SyncResult` and `SyncEvent`. `@aw/sync-syncthing` SHALL implement it with the id `syncthing`. `waitDelivered(device, workspace, path, timeoutMs)` (the path relative to the workspace root) SHALL scan the path, then resolve `true` when the peer has the newest version of the file (the engine `availability` lists it), and `false` when the peer is not known or not connected, the path is in no folder, or the time ends.

#### Scenario: Type check
- **WHEN** the plugin compiles
- **THEN** `SyncthingTransport` satisfies `SyncTransport` with no cast

#### Scenario: File delivered
- **WHEN** 2 real engines share `tasks` and one writes `devices/ubuntu-01/device.yaml`
- **THEN** `waitDelivered("ubuntu-01", ws, "tasks/devices/ubuntu-01/device.yaml", 20000)` resolves `true` after the other engine has the file

#### Scenario: Peer not connected
- **WHEN** the peer is not connected
- **THEN** `waitDelivered` resolves `false` at once

### Requirement: Targeted scan after each write
Each write of the files layer (document, event, file, removal, conflict operation) SHALL call the write hook, and awd SHALL request `POST /rest/db/scan` for the folder of the path with `sub` set to the path in that folder.

#### Scenario: Task event
- **WHEN** awd appends an event to `tasks/<task-id>/log/macbook-pro.jsonl`
- **THEN** the engine gets a scan request for the folder `aw-<workspace>-tasks` and the sub path `<task-id>/log/macbook-pro.jsonl`

### Requirement: Sync now
`syncNow({timeoutMs})` SHALL first scan each folder, then poll the completion of each peer for each folder that it shares and the connections. A peer SHALL count as synced only when it is connected and each folder has `needItems` 0 and `remoteState` `valid`. The total completion SHALL NOT be used. The result SHALL list each peer that is not synced at the timeout, with its items and the reason `offline` or `timeout`. The default timeout SHALL be 20 s, and the scans SHALL use only the time that is left of it. A folder whose scan fails SHALL NOT stop Sync now: awd SHALL log the folder and go on with the completion poll.

#### Scenario: All synced
- **WHEN** 200 files changed on this device and the peer is connected
- **THEN** Sync now returns with no pending peer after the peer has each file

#### Scenario: Offline peer
- **WHEN** a file changed and the peer is offline
- **THEN** Sync now returns the peer as pending with 1 item and the reason `offline`, and the status text says "1 change not synced to <peer> (offline)", not 100 %

### Requirement: Status per peer and folder
`status()` SHALL give for each peer: the device slug, connected, the route (`lan`, `tailscale`, `relay` or `internet`), `needItems`, `needBytes`, `inSync`, the last seen time, the last time the peer got a change (the last FolderCompletion with 0 items, or the first status that saw it in sync; a status poll does not move it), and the same counts per folder. The status text SHALL be "Synced <n> s ago" (or minutes, hours) when the peer is in sync, and "<n> changes not synced to <peer> (<offline|syncing>)" when it is not.

#### Scenario: Synced text
- **WHEN** a peer was last seen synced 12 s ago and is still in sync
- **THEN** the text is "Synced 12 s ago"

### Requirement: Engine events
`events()` SHALL long-poll the engine events StateChanged, FolderSummary, FolderCompletion, DeviceConnected, DeviceDisconnected, DevicePaused, DeviceResumed, FolderErrors, PendingDevicesChanged and the disk events, and SHALL skip the Item events. After an engine restart it SHALL read from the first event again.

#### Scenario: Restart resets the cursor
- **WHEN** the engine restarts and its event ids start at 1 again
- **THEN** the reader gets the new events and does not wait for an id above the old one
