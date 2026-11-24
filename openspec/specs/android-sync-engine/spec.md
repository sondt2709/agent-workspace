# android-sync-engine Specification

## Purpose
The built-in Syncthing engine of the Android app: the pins and the build of `libawsync.so`, the config before the first start, the REST client, the supervision, the folders and peers of the phone, Sync now, the index refresh, and the foreground service.
## Requirements
### Requirement: Android engine pins and build
The repository SHALL keep one version file `android/engine/engine-version.properties` with the Syncthing tag (the same tag as `plugins/sync-syncthing/engine/engine.json`), the sha256 of the source tarball `syncthing-source-<tag>.tar.gz`, the Go version and the sha256 of each supported Go host archive, the NDK version, and the sha256 of `libawsync.so` for arm64-v8a and x86_64. The script `android/engine/scripts/build-libawsync.sh` SHALL build `libawsync.so` for both ABIs with `go run build.go -goos android -no-upgrade`, `CGO_ENABLED=1`, the NDK clang of the pinned NDK and `EXTRA_LDFLAGS=-checklinkname=0`. It SHALL refuse a Go archive or a source tarball whose sha256 differs from the pin, and an NDK whose version differs from the pin. When a `libawsync.so` sha256 pin is set and the built file differs, the script SHALL fail. The built files SHALL NOT be in git.

#### Scenario: Wrong source tarball
- **WHEN** the downloaded source tarball has a sha256 that differs from the pin
- **THEN** the script fails with the expected and the actual sha256 and builds nothing

#### Scenario: Wrong NDK
- **WHEN** the NDK folder has a `Pkg.Revision` that differs from the pinned NDK version
- **THEN** the script fails and names both versions

#### Scenario: Same tag as the computers
- **WHEN** the JVM tests run
- **THEN** a test fails if the Android tag differs from the tag in `plugins/sync-syncthing/engine/engine.json`

### Requirement: Phone engine config before the first start
When `<filesDir>/sync/config.xml` does not exist or is not an AW config, the app SHALL run `libawsync.so generate` and `device-id`, and SHALL write `config.xml` from the AW template before the first `serve`. The template SHALL have the same values as the awd template, with these phone values: the phone slug as the device name, the REST API on the Unix socket `<filesDir>/run/sync.sock` (or the loopback fallback address with TLS), a new random API key, the listen address `tcp://0.0.0.0:22300` and a reconnect interval of 20 s. An existing config SHALL count as the AW config only when its REST address is the socket or a loopback address of the fallback, it has an API key, and NAT traversal, usage reports, crash reports and automatic upgrades are off.

#### Scenario: First start
- **WHEN** the engine home has no `config.xml`
- **THEN** the app runs `generate`, writes the AW template with the device id of `device-id`, and only then runs `serve`

#### Scenario: Config of generate only
- **WHEN** the engine home has the `config.xml` of `generate` (GUI on `127.0.0.1:8384`, NAT on)
- **THEN** the app writes the AW template again before `serve`, and the device id stays the same

### Requirement: Phone engine REST client
The app SHALL call the engine REST API with its own Kotlin client (Ktor, OkHttp engine) and the API key in `X-API-Key`. The client SHALL connect through the Unix socket of the config. With the loopback fallback, the client SHALL use HTTPS and SHALL trust only the certificate in `<filesDir>/sync/https-cert.pem`. When the engine process runs but the socket does not answer for 2 starts in a row, the app SHALL write the loopback fallback address and start again. A new app process SHALL keep the fallback of an existing AW config and SHALL NOT write the config again. A reply that does not have the fields that AW reads SHALL be an error with the route and the field. The read timeout of a request SHALL be its request timeout (30 s by default; a long poll waits its `timeout` and 10 s more; a scan 120 s), not the 10 s default of OkHttp.

#### Scenario: Reply without a field
- **WHEN** `/rest/db/completion` answers without `remoteState`
- **THEN** the client throws an error that names the route and `remoteState`

#### Scenario: Long poll
- **WHEN** the engine answers `rest/events?timeout=30` after 11 s
- **THEN** the client returns the events and does not fail with a socket timeout

#### Scenario: Other certificate on the loopback port
- **WHEN** a server on the loopback port shows a certificate that is not `https-cert.pem`
- **THEN** the client refuses the connection and sends no API key

### Requirement: Phone engine supervision
The app SHALL start `libawsync.so serve --home=<filesDir>/sync --no-browser --no-upgrade --no-restart` as a child process, copy its output to `<filesDir>/logs/sync-engine.log` and rotate that log at 10 MB while the engine runs, keeping 3 old files (with `STMONITORED=1` the engine writes no own log file) with `STHOMEDIR`, `STNOUPGRADE=1` and `STMONITORED=1`, check `/rest/system/ping` every 10 s, and restart the engine with a backoff from 1 s to 60 s after a process exit or 3 failed checks. The backoff SHALL go back to 1 s only after the engine ran healthy for 60 s, and after 10 restarts with no healthy minute the state SHALL be `failed` while the restarts go on (the awd values). A stop SHALL end the process, and force it after 10 s. At start, the app SHALL stop an engine that an earlier app process left, only when its command line has `libawsync.so` and the engine home. A failed config step after a start SHALL NOT stop the engine; the app SHALL try it again at the next health check. The engine state SHALL be one of `not_installed`, `starting`, `running`, `restarting`, `stopped`, `failed`.

#### Scenario: Engine exits
- **WHEN** the engine process exits
- **THEN** the state goes to `restarting`, the app starts the engine again after the backoff, and the state goes to `running`

#### Scenario: Crash loop
- **WHEN** each engine start answers one ping and then exits
- **THEN** the backoff grows to 60 s and the state is `failed` after 10 restarts

#### Scenario: No binary
- **WHEN** `libawsync.so` is not in the native library folder
- **THEN** the state is `not_installed` and the app starts no process

#### Scenario: Config step fails
- **WHEN** a REST call of the config step after a start fails
- **THEN** the engine process keeps running, and the app runs the config step again at the next health check

### Requirement: Phone folders and peers
For each workspace, the app SHALL share the engine folders `aw-<workspace id>-tasks` and `aw-<workspace id>-knowledge` in `<filesDir>/aw/<workspace id>/` with each peer, send and receive, `fsWatcherDelayS 1`, `maxConflicts 10` and no file versioning. The app SHALL NOT create the `secure` folder. The app SHALL set the ignore patterns `*.aw-tmp` in both folders and also `/*/artifacts` in `tasks`. Before `/*/artifacts`, the tasks folder SHALL have one line `!/<task>/<path>` for each artifact that the person requested on the phone, and only for a path that matches `^[0-9a-f-]{36}/artifacts/[a-z0-9-]+/[A-Za-z0-9._-]+$`. A new request SHALL send the new ignore list at once when the engine runs. The app SHALL turn on local discovery, set global discovery and relays from the community switch, keep NAT traversal off, and set the reconnect interval to 5 s while the app is open and 20 s else. The app SHALL send a config value only when it differs from the engine config. The peers SHALL come from the signed device records of the workspaces (each record that is not revoked and is not this phone, with its sync device id and its addresses or `dynamic`). A device whose device key or sync device id has a revoked record in any workspace SHALL be no peer, as on awd. A workspace with no valid record SHALL NOT change the peer list. The config step SHALL keep the engine devices of an open pairing.

#### Scenario: Restart with the same config
- **WHEN** the engine starts again and its folders, devices and options equal the wanted values
- **THEN** the app sends no config change

#### Scenario: App opened
- **WHEN** the app comes to the foreground
- **THEN** the app restarts the engine and the reconnect interval is 5 s

#### Scenario: Revoked record
- **WHEN** a computer record of the workspace becomes revoked
- **THEN** the app removes that computer from the peers and from the engine devices

#### Scenario: Revoked in another workspace
- **WHEN** workspace `beta` revokes `mac-mini-lab` and the first workspace has a valid record of `mac-mini-lab` with the same device key and sync device id
- **THEN** the phone has no peer `mac-mini-lab` in any folder

#### Scenario: Pairing device kept
- **WHEN** the config step runs while a pairing device is in the engine and not in the peers
- **THEN** the config step keeps that device

#### Scenario: Requested artifact
- **WHEN** the person requests `artifacts/ubuntu-01/shot.png` of task T
- **THEN** the ignore list of the tasks folder is `*.aw-tmp`, `!/T/artifacts/ubuntu-01/shot.png`, `/*/artifacts`, and the engine gets it at once

#### Scenario: Path with a pattern character
- **WHEN** a request names `artifacts/ubuntu-01/*.png`
- **THEN** the app adds no ignore line for it

### Requirement: Phone Sync now and peer status
"Sync now" on the phone SHALL start the engine when it does not run, scan each folder, and poll the completion of each folder for each peer and the connections until each peer is synced or 60 s pass. When the engine cannot start (no workspace, or no `libawsync.so`), Sync now SHALL return at once with the cause ("This phone has no workspace yet: sync is off", "The sync engine is not installed: sync is off"), and the screen SHALL show it. A peer SHALL count as synced only when it is connected and each shared folder has 0 items to get and the remote state `valid`. The status of each peer SHALL have the texts of awd ("Synced 12 s ago", "3 changes not synced to ubuntu-01 (offline)").

#### Scenario: Peer offline
- **WHEN** Sync now runs and a peer is not connected
- **THEN** the result lists the peer as pending with the reason `offline` and its count of items

#### Scenario: All peers synced
- **WHEN** each peer is connected and each folder has 0 items to get and the state `valid`
- **THEN** Sync now returns with no pending peer before the timeout

### Requirement: Index refresh after engine changes
After each engine start and after each disk event (`RemoteChangeDetected`, `LocalChangeDetected`) of a workspace folder, the app SHALL wait 500 ms for more events and then run `MergeEngine.update()` and `WorkspaceIndex.write()` of that workspace. A failed update SHALL be logged and SHALL NOT stop the event loop. While the app is open, the app SHALL also run this refresh every 30 s with no disk event, so the presence of each device uses the current time (a computer with no heartbeat for more than 90 s shows offline when it is the only computer).

#### Scenario: File from a computer
- **WHEN** the engine writes a new log line of a computer into the `tasks` folder
- **THEN** the index of the phone has the new event after the refresh

### Requirement: Foreground service and battery check
The app SHALL run the engine in one foreground service of type `specialUse` with a permanent, low-importance notification while at least one workspace is set up. The notification SHALL say "AW · syncing with N devices". When the app is in the battery mode "Restricted" (`ActivityManager.isBackgroundRestricted()`), the notification SHALL say that sync stops in Doze and SHALL open the app settings. The applicationId SHALL be `com.agentworkspace.android`. The Firebase config file SHALL come only from a local path in the Gradle property `aw.googleServicesJson` and SHALL NOT be in git.

#### Scenario: Restricted battery mode
- **WHEN** the user sets the battery mode of the app to "Restricted"
- **THEN** the notification shows the warning and its action opens the app settings

### Requirement: Engine for a pairing
The controller SHALL start the engine for a pairing when the phone has no workspace, SHALL add a pairing device with no workspace folder (its addresses or `dynamic`), SHALL share a pairing folder `aw-pair-<nonce>` with that device only (send and receive, rescan 10 s, the ignore `*.aw-tmp`), SHALL scan it on request, and SHALL remove the folder and the device at the end (the device stays when it is a peer). It SHALL remove a workspace: its 2 engine folders, its index registration and its folder.

#### Scenario: Pairing with no workspace
- **WHEN** a pairing starts on a phone with no workspace
- **THEN** the engine starts, and the pairing device and folder are in the engine config

#### Scenario: Pairing ends
- **WHEN** the pairing ends and the showing device is not a peer
- **THEN** the pairing folder and the pairing device are not in the engine config
