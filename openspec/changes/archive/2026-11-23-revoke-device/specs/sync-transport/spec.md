## MODIFIED Requirements

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
