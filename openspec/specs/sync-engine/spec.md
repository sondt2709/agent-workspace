# sync-engine Specification

## Purpose
The built-in Syncthing engine of each computer: the pins and the fetch script, the config before the first start, the supervision, the 3 folders of each workspace and the peers.
## Requirements
### Requirement: Engine pins
The plugin SHALL keep one version file `plugins/sync-syncthing/engine/engine.json` with the Syncthing tag, the archive name and sha256 of each supported platform (macOS arm64 and x64 through the universal zip, Linux x64 and arm64) and the fingerprint of the release signing key. The fetch script SHALL refuse an archive whose sha256 is not the pinned value and SHALL NOT extract it. The pin check SHALL accept the pins only when the release file `sha256sum.txt.asc` has a valid signature from the pinned fingerprint and lists each pinned sha256 for its archive name. It SHALL read only the text that the signature covers: text before or after the one clear-signed block is not read, and a file with more than one block is refused.

#### Scenario: Wrong archive
- **WHEN** the fetch script downloads an archive whose sha256 differs from the pin
- **THEN** it fails with the expected and the actual sha256, and no binary is written

#### Scenario: Line after the signature
- **WHEN** the downloaded sums file has an extra `<sha256>  <archive>` line after the signature
- **THEN** the pin check does not read that line

#### Scenario: Pin not in the signed file
- **WHEN** a pinned sha256 differs from the line of the same archive in the signed release file
- **THEN** the pin check fails and names the archive

### Requirement: Config before the first start
When `<AW_HOME>/sync/config.xml` does not exist, awd SHALL run `syncthing generate` and then write `config.xml` from its template before the first `syncthing serve`. An existing `config.xml` SHALL count as the AW config only when its REST address is `<AW_HOME>/run/sync.sock`, it has an API key, and NAT traversal, usage reports, crash reports and automatic upgrades are off; else awd SHALL write the template again before the engine starts, with the device id of the existing certificate. The template SHALL set the AW device slug as the device name, the REST API on the Unix socket `<AW_HOME>/run/sync.sock` with mode 0600 and a new random API key, a TCP listen address (`AW_SYNC_LISTEN`, default `tcp://0.0.0.0:22300`), global discovery, local discovery, relays and NAT traversal off, usage reports refused (`urAccepted -1`), crash reports off, automatic upgrades off and a reconnect interval of 60 s. After the first start, awd SHALL change the engine only through the REST API. awd SHALL take the device id of this device from the engine certificate (`syncthing device-id`) and from `/rest/system/status`, never from the `config.xml` text, because the engine lists the folder devices and the peers there too.

#### Scenario: Stop between generate and the AW config
- **WHEN** awd stopped after `syncthing generate` and before it wrote the AW `config.xml`, and awd starts again
- **THEN** awd writes the AW template before the first `serve`, the device id stays the same, and the engine log has no line about global discovery, relays, NAT, UPnP or STUN

#### Scenario: Restart with shared folders
- **WHEN** awd starts again on an engine home whose folders are shared with a peer whose device id sorts first
- **THEN** awd reports the device id of this device, and the engine device names stay the same

#### Scenario: No third-party traffic at the first start
- **WHEN** awd starts the engine for the first time with the community switch off
- **THEN** the engine log has no line about global discovery, relays, NAT, UPnP or STUN, and the engine listens only on the configured TCP port and the Unix socket

#### Scenario: Community switch
- **WHEN** awd starts the engine with `AW_SYNC_COMMUNITY` on
- **THEN** awd turns on local discovery, global discovery and relays through REST after the start, and NAT traversal stays off

### Requirement: Engine supervision
awd SHALL start the engine with `serve --no-browser --no-upgrade --no-restart`, record the pid of each engine process, check `/rest/system/ping` every 10 s of the clock module and restart the engine with a backoff from 1 s to 60 s after a process exit or 3 failed checks. At start, awd SHALL stop an engine process that an earlier awd left, only when the process is a `syncthing` process with `--home=<AW_HOME>/sync` in its arguments. At stop, awd SHALL send SIGTERM to each recorded pid and SIGKILL after 10 s; a restart wait SHALL end at once. Only one restart loop SHALL run at a time. A failed config step after a start (options, devices, folders, ignores) SHALL NOT stop the engine: awd SHALL log it and try it again at the next health check. When awd cannot prepare the engine home (for example `generate` fails, or the socket path is longer than 103 bytes), the state SHALL be `failed`, awd SHALL log the cause, and the restart loop SHALL try again. The engine state SHALL be one of `not_installed`, `starting`, `running`, `restarting`, `stopped`, `failed`.

#### Scenario: Engine killed
- **WHEN** the engine process gets SIGKILL during a sync
- **THEN** awd starts it again, the state goes from `restarting` to `running`, and the sync completes

#### Scenario: Config step fails
- **WHEN** a REST call of the config step after a start fails
- **THEN** the engine keeps running with the same pid, and awd runs the config step again at the next health check

#### Scenario: No engine binary
- **WHEN** neither `AW_SYNC_ENGINE` nor `<AW_HOME>/engine/syncthing` exists
- **THEN** awd runs with sync off, and `/readyz` reports `sync_engine: "not_installed"`

#### Scenario: Engine installed after the start
- **WHEN** awd runs with no engine binary, and `aw engine install` places it
- **THEN** within 5 s awd starts the engine with the folders and the peers, with no restart of awd

### Requirement: Workspace folders
For each workspace, awd SHALL share the engine folders `aw-<workspace id>-tasks`, `aw-<workspace id>-knowledge` and `aw-<workspace id>-secure` (secure only with computers) with send and receive, `fsWatcherDelayS 1`, `maxConflicts 10`, and on computers simple file versioning that keeps 10 versions in `<AW_HOME>/sync-versions/<folder id>`. awd SHALL set the ignore pattern `*.aw-tmp` through REST on each device, and SHALL send a folder config only when it differs from the engine config.

#### Scenario: Restart with the same config
- **WHEN** awd starts again and the folder config in the engine is equal to the wanted config
- **THEN** awd sends no folder config change

#### Scenario: Secure folder and a mobile peer
- **WHEN** a peer with the role `mobile` is added
- **THEN** it shares the `tasks` and `knowledge` folders and not the `secure` folder

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

### Requirement: Community switch at run time
The transport SHALL change "Use community discovery and relay servers" on a running engine: `setCommunity(on)` SHALL send `PATCH /rest/config/options` with `globalAnnounceEnabled`, `relaysEnabled` and `announceLANAddresses` equal to `on`, and local discovery SHALL stay on. It SHALL then read `GET /rest/config/restart-required`. With no running engine, a failed PATCH or an engine that asks for a restart, the value SHALL apply at the next engine start (`applied: next_start`), and the call SHALL NOT fail.

#### Scenario: Off on a running engine
- **WHEN** awd calls `setCommunity(false)` on a running engine
- **THEN** the engine options have `globalAnnounceEnabled`, `relaysEnabled` and `announceLANAddresses` false and `localAnnounceEnabled` true
