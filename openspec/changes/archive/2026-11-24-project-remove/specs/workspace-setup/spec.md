## MODIFIED Requirements

### Requirement: Desktop setup screens
The desktop app SHALL show a "Create the Personal workspace" button and a "Join with a pairing code" button when no workspace exists. "Join with a pairing code" SHALL send the code to `POST /v1/pairing/join` (as `aw pair`), show the check code and the name of the showing device, follow the pairing until it ends, and open the Inbox of the joined workspace when it is done. It SHALL make no master key. The workspace switcher at the top of the navigation SHALL list each workspace of this device with its folder, switch to the selected workspace, and SHALL add a project, add a workspace, rename the current workspace and remove it from this device. The folder field of "Add a workspace" and the checkout folder of Project settings SHALL have "Choose…", which opens the native folder picker. Each project SHALL have a Settings page in titled sections: General (the name, the default agent, the main repository and the links), Devices (the device order and the subtask switch), Test servers, one Save for these synced settings; "This device" (the checkout path, its session host, the test slots and "Use Orca on this device"); Archive; and Remove ("Remove the project", openspec project-remove). Under the session host, a help line SHALL say where a session works: its own git worktree on the branch `aw/<key>`, in `~/.aw/worktrees/<task id>` with tmux and in the folder of Orca with Orca. The Settings page SHALL show the disclosure text of PRD SYN-06 with the community switch.

#### Scenario: Empty state
- **WHEN** the app starts and awd has no workspace
- **THEN** the Home screen shows "Create the Personal workspace", and a click creates it and opens its Inbox

#### Scenario: Join with a pairing code
- **WHEN** the app starts with no workspace, and the person selects "Join with a pairing code" and pastes the code of `mac-mini-lab`
- **THEN** the dialog shows the check code and "On mac-mini-lab, type this check code", and after the approval it opens the Inbox of the joined workspace

#### Scenario: Community switch
- **WHEN** a person turns off the switch in Settings
- **THEN** the app sends `PUT /v1/sync/settings` with `community: false` and shows "LAN and Tailscale only"

#### Scenario: Session host help
- **WHEN** the person opens the Settings page of `billing-api`
- **THEN** the "This device" section shows, under the session host, that each session works in its own git worktree on the branch `aw/<key>`, and where tmux and Orca keep it

#### Scenario: Choose the checkout in Project settings
- **WHEN** the person selects "Choose…" next to the checkout folder of `billing-api` and picks a folder
- **THEN** the field shows the picked path, and "Save checkout" sends it in `editBindings`

#### Scenario: Switch workspace
- **WHEN** this device has the workspaces Personal and Side projects, and the person selects "Side projects" in the switcher
- **THEN** the app opens the Inbox of Side projects, and the navigation shows only its projects

#### Scenario: Remove section
- **WHEN** the person opens the Settings page of `billing-api`
- **THEN** the last section is "Remove" with the button "Remove the project…"
