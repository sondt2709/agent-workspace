## MODIFIED Requirements

### Requirement: Phone folders and peers
For each workspace, the app SHALL share the engine folders `aw-<workspace id>-tasks` and `aw-<workspace id>-knowledge` in `<filesDir>/aw/<workspace id>/` with each peer, send and receive, `fsWatcherDelayS 1`, `maxConflicts 10` and no file versioning. The app SHALL NOT create the `secure` folder. The app SHALL set the ignore patterns `*.aw-tmp` in both folders and also `/*/artifacts` in `tasks`. The app SHALL turn on local discovery, set global discovery and relays from the community switch, keep NAT traversal off, and set the reconnect interval to 5 s while the app is open and 20 s else. The app SHALL send a config value only when it differs from the engine config. The peers SHALL come from the signed device records of the workspaces (each record that is not revoked and is not this phone, with its sync device id and its addresses or `dynamic`); a workspace with no valid record SHALL NOT change the peer list. The config step SHALL keep the engine devices of an open pairing.

#### Scenario: Restart with the same config
- **WHEN** the engine starts again and its folders, devices and options equal the wanted values
- **THEN** the app sends no config change

#### Scenario: App opened
- **WHEN** the app comes to the foreground
- **THEN** the app restarts the engine and the reconnect interval is 5 s

#### Scenario: Revoked record
- **WHEN** a computer record of the workspace becomes revoked
- **THEN** the app removes that computer from the peers and from the engine devices

#### Scenario: Pairing device kept
- **WHEN** the config step runs while a pairing device is in the engine and not in the peers
- **THEN** the config step keeps that device

## ADDED Requirements

### Requirement: Engine for a pairing
The controller SHALL start the engine for a pairing when the phone has no workspace, SHALL add a pairing device with no workspace folder (its addresses or `dynamic`), SHALL share a pairing folder `aw-pair-<nonce>` with that device only (send and receive, rescan 10 s, the ignore `*.aw-tmp`), SHALL scan it on request, and SHALL remove the folder and the device at the end (the device stays when it is a peer). It SHALL remove a workspace: its 2 engine folders, its index registration and its folder.

#### Scenario: Pairing with no workspace
- **WHEN** a pairing starts on a phone with no workspace
- **THEN** the engine starts, and the pairing device and folder are in the engine config

#### Scenario: Pairing ends
- **WHEN** the pairing ends and the showing device is not a peer
- **THEN** the pairing folder and the pairing device are not in the engine config
