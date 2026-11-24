## MODIFIED Requirements

### Requirement: Join with a code
`aw pair <code>` (`aw pair -` reads the code from stdin, so it stays out of the shell history) (and `POST /v1/pairing/join {code, path?, parent?, slug?, name?}`) SHALL refuse an expired or invalid code, a code of a workspace that is registered already, a code whose pairing runs on this device already (409 `conflict`), a device with a master key, a path or parent that is not absolute (the CLI makes `--path` and `--in` absolute against its working folder), and a folder that the rules of the `workspace-folder` capability refuse (409 `conflict`, before any change). `--path` SHALL be the workspace folder itself; `--in` (`parent`) SHALL be the location that holds it; with neither, the location SHALL be `~/AW`. The folder of a location SHALL follow the folder rule (`<name>`, then `<name>-aw1` ..). It SHALL add the showing device to its engine, share the pairing folder `aw-pair-<nonce>` with `request.json` (slug, name, role `remote`, keys, sync device id, addresses, an Ed25519 signature with its device key, HMAC-SHA256 with the secret) and show the check code. The pairing view SHALL have `folder` and `folder_note`, and `aw pair` SHALL print the folder. When the engine does not add the pairing device or folder, the pairing SHALL end as `failed` (503 `not_ready`), so the same code works again. `aw pair` SHALL wait until the pairing is done, failed or expired, and exit with 0 only when it is done.

#### Scenario: Expired code
- **WHEN** a device runs `aw pair` with a code whose expiry is past
- **THEN** it exits with 2, names the expiry, and the engine gets no new device

#### Scenario: Folder of another workspace
- **WHEN** a device runs `aw pair <code> --path <folder>` and the folder has `tasks/workspace.yaml` of another workspace
- **THEN** it exits with 1, names the other workspace, and the engine gets no new folder

#### Scenario: Location with a taken name
- **WHEN** ubuntu-01 runs `aw pair <code> --in /srv/work` for the workspace "demo", and `/srv/work/demo` holds other files
- **THEN** the pairing view has `folder: /srv/work/demo-aw1`, `aw pair` prints that folder and the note, and after the approval awd registers `/srv/work/demo-aw1`
