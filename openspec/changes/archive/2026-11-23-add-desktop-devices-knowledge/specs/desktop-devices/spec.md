## ADDED Requirements

### Requirement: Devices and sync page
The Devices & sync page SHALL show the sync engine state and each device of the workspace: its name, slug and role, "This device", its record state (valid, revoked, bad signature), its last heartbeat ("Last heartbeat 12 s ago", or "Offline since 10:42"), and for each other device the sync text of awd ("Synced 12 s ago", "3 changes not synced to ubuntu-01 (offline)"), the route and the state of each folder.

#### Scenario: Offline peer
- **WHEN** `ubuntu-01` is offline and 3 items are not synced to it
- **THEN** its row shows "Offline since …" and "3 changes not synced to ubuntu-01 (offline)"

### Requirement: Sync button
The header and the Devices page SHALL have a "Sync" button, and the app menu SHALL have "Sync now" on `CmdOrCtrl+R`. Each SHALL open the Sync dialog, which runs Sync now and shows the result for each peer, the devices that are not synced with the count and the reason, "Sync again" and "Close". The dialog SHALL suggest no move of a task.

#### Scenario: A peer is offline
- **WHEN** the person selects Sync and awd replies with `pending: [{device: "ubuntu-01", items: 3, reason: "offline"}]`
- **THEN** the dialog shows "3 changes not synced to ubuntu-01 (offline)" and the buttons "Sync again" and "Close", and no move suggestion

### Requirement: Revoke a device
"Revoke" on a device other than this one SHALL open a confirmation that names the tasks whose sessions run on that device and stop, and says that the device keeps its copy of the files. Confirm SHALL call the revoke route, and the result SHALL say how many credentials awd wrote again and name the credentials to add again.

#### Scenario: Revoke with a running session
- **WHEN** `ubuntu-01` runs the session of `AW-7` and the person selects Revoke
- **THEN** the confirmation names `AW-7` and says that `ubuntu-01` keeps its copy of the files

### Requirement: Pair a device
"Add device" SHALL start a pairing, show the QR code and the code as text with a Copy button and the time left, and poll the pairing every second. When the new device asks, the dialog SHALL show its name and role and a field for the 6-digit check code that the new device shows; "Approve device" SHALL send it. The dialog SHALL not show the check code of this device before the approval. Cancel SHALL cancel the pairing. The end states (done, failed, expired, cancelled) SHALL show their text.

#### Scenario: Approve a remote computer
- **WHEN** the pairing state becomes `check` with the new device `ubuntu-01` and the person types `482 913` and selects "Approve device"
- **THEN** the app sends the approve call with `482 913` and shows the progress until `done`

### Requirement: Recovery phrase
On a device with the master key, when the person did not confirm the phrase of this user yet, the app SHALL show the recovery phrase screen: the 24 words, then a check of 3 words at random positions. After a correct check the app SHALL record the confirmation and never show the screen again. "Later" SHALL close it without a record.

#### Scenario: Confirm the phrase
- **WHEN** the person types the 3 asked words correctly
- **THEN** the app records the user id as confirmed and the screen does not show at the next start

### Requirement: Assign to another device
A paused task SHALL offer "Assign to another device…". The dialog SHALL list the `agent@device` choices of the project except the current device, with none selected, and SHALL write one human `task.assigned` for the chosen one.

#### Scenario: Move a paused task
- **WHEN** `AW-7` is paused with `device offline` on `macbook-pro` and the person selects `claude@ubuntu-01`
- **THEN** the app sends `assignTask` with `claude@ubuntu-01`, and the dialog had no choice selected before

### Requirement: Credentials page
The Credentials page SHALL list the credential names of the workspace with who added them and where they were imported. "Add" SHALL take a name and a value from a password field, send it once and clear the field; the app SHALL never read or show a value. "Remove" SHALL ask for a confirmation.

#### Scenario: Add a credential
- **WHEN** the person adds `stripe-test` with a value
- **THEN** the app sends `addCredential`, the list shows `stripe-test`, and no screen shows the value
