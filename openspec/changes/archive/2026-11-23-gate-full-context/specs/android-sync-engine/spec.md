## MODIFIED Requirements

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
