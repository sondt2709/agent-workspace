# desktop-devices Specification

## Purpose
The desktop screens of devices and sync: Devices & sync, the Sync dialog, revoke, pairing, the recovery phrase, credentials, and the move of a paused task to another device.
## Requirements
### Requirement: Devices and sync page
The Devices & sync page SHALL show the sync engine state and a card for each device of the workspace. Each card SHALL show the name, the role, "This device", the record state (valid, revoked, bad signature) and property rows: the presence ("Last heartbeat 12 s ago", or "Offline since 10:42"); for this device the workspace folder of the current workspace ("Workspace folder"); for each other device the sync text of awd ("Synced 12 s ago", "3 changes not synced to ubuntu-01 (offline)"), the route and the state of each folder; for a computer the agent, the sessions ("1 working of 2 · queue 0"), the session hosts, "Use Orca" and the checkouts of its bindings with their host; for this device its test slots. Other device cards SHALL NOT show a workspace folder: awd does not sync it. The page SHALL use only the devices, presence, sync, queues, session-hosts, bindings and workspaces routes.

#### Scenario: Offline peer
- **WHEN** `ubuntu-01` is offline and 3 items are not synced to it
- **THEN** its card shows "Offline since …" and "3 changes not synced to ubuntu-01 (offline)"

#### Scenario: Sessions of a computer
- **WHEN** the queues route gives `claude@mac-mini-lab` with `working: 1`, `max_working: 2` and 1 queued task
- **THEN** the card of `mac-mini-lab` shows the agent `claude@mac-mini-lab` and "1 working of 2 · queue 1"

#### Scenario: Folder on the card of this device
- **WHEN** the current workspace demo is at `/Users/example/Work/demo-aw1` on this device
- **THEN** the card of this device shows "Workspace folder" with `/Users/example/Work/demo-aw1`, and the other cards show no folder

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
On a device with the master key, the app SHALL show the recovery phrase screen by itself only one time for each user: the 24 words, then a check of 3 words at random positions. The app SHALL record the first show in `<userData>/aw-desktop.json` (`phrase_shown`). After a correct check the app SHALL record the confirmation (`phrase_confirmed`). "Later" SHALL close the screen with no confirmation. While the phrase is shown but not confirmed, Settings and the Inbox SHALL show a reminder line with "Show recovery phrase", which opens the screen again. The reminder line SHALL not show while a phrase screen is open. On a device with the master key, Settings SHALL also show a "Recovery phrase" card with "Show recovery phrase" after the confirmation; the screen then SHALL show "Close" in place of "Later" and no check step.

#### Scenario: Confirm the phrase
- **WHEN** the person types the 3 asked words correctly
- **THEN** the app records the user id as confirmed, and neither the screen nor the reminder shows at the next start

#### Scenario: Later
- **WHEN** the person selects "Later" on the first screen and starts the app again
- **THEN** the screen does not show by itself, and Settings and the Inbox show "Your recovery phrase is not confirmed" with "Show recovery phrase"

#### Scenario: Show the phrase after the confirmation
- **WHEN** the phrase is confirmed and the person selects "Show recovery phrase" in the Settings card
- **THEN** the screen shows the 24 words with "Copy", "Save to a file…" and "Close"

#### Scenario: No reminder under the screen
- **WHEN** the phrase screen shows on the first run
- **THEN** the Inbox shows no reminder line until the screen closes

### Requirement: Assign to another device
A paused task SHALL offer "Assign to another device…". The dialog SHALL list the `agent@device` choices of the project except the current device, with none selected, and SHALL write one human `task.assigned` for the chosen one. After a choice, it SHALL show the session host choice of the New session dialog and SHALL send the chosen `session_host`, with the same rule while the host list loads or fails.

#### Scenario: Move a paused task
- **WHEN** `AW-7` is paused with `device offline` on `macbook-pro` and the person selects `claude@ubuntu-01`
- **THEN** the app sends `assignTask` with `claude@ubuntu-01` and `session_host: tmux`, and the dialog had no choice selected before

### Requirement: Credentials page
The Credentials page SHALL list the credential names of the workspace with who added them and where they were imported. "Add" SHALL take a name and a value from a password field, send it once and clear the field; the app SHALL never read or show a value. "Remove" SHALL ask for a confirmation. With no credential, the page SHALL show "No credentials yet" and an "Add a credential" button.

#### Scenario: Add a credential
- **WHEN** the person adds `stripe-test` with a value
- **THEN** the app sends `addCredential`, the list shows `stripe-test`, and no screen shows the value

#### Scenario: Empty list
- **WHEN** the workspace has no credential
- **THEN** the page shows "No credentials yet" and "Add a credential", which opens the Add dialog

### Requirement: Copy and save the recovery phrase
The phrase screen SHALL show "Copy" and "Save to a file…" with the 24 words, and a warning line. The main process SHALL read the phrase from awd for each action; the renderer SHALL not send the phrase. "Copy" SHALL write the 24 words, separated by single spaces, to the clipboard. 60 s after the last copy, the main process SHALL clear the clipboard if it still holds the copied text. When the app quits less than 60 s after a copy, the main process SHALL clear the clipboard at once and with no check of the text, so the quit never waits (a stopped quit can cancel a macOS logout). "Save to a file…" SHALL open the native save dialog with the default path `~/agent-workspace-recovery-phrase.txt` (the home folder: iCloud Drive can sync Documents and Desktop) and SHALL write a file with mode 0600 that holds the user id, the device name and slug, the date (UTC) and the 24 numbered words. A replaced file SHALL get mode 0600. Cancel SHALL write nothing.

#### Scenario: Copy
- **WHEN** the person selects "Copy"
- **THEN** the clipboard holds the 24 words, the screen shows "Copied. AW clears the clipboard in 60 seconds.", and 60 s later the clipboard is empty

#### Scenario: Other text copied in the 60 s
- **WHEN** the person copies other text 10 s after "Copy"
- **THEN** the app does not clear the clipboard at 60 s

#### Scenario: Quit in the 60 s
- **WHEN** the person quits the app or logs out 10 s after "Copy"
- **THEN** the clipboard is empty and the quit or the logout continues with no stop

#### Scenario: Save
- **WHEN** the person selects "Save to a file…" and saves to `~/agent-workspace-recovery-phrase.txt`
- **THEN** the file has mode 0600, the user id, the device, the date and the 24 numbered words, and the screen shows "Saved to" with the path

#### Scenario: Cancel the save
- **WHEN** the person cancels the save dialog
- **THEN** no file is written and the screen shows no result line

#### Scenario: Device with no master key
- **WHEN** awd refuses the phrase (403)
- **THEN** the app writes nothing to the clipboard or a file and shows the error
