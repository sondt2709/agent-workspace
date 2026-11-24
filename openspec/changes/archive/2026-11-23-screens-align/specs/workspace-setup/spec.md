## MODIFIED Requirements

### Requirement: Desktop setup screens
The desktop app SHALL show a "Create the Personal workspace" button and a "Join with a pairing code" button when no workspace exists. "Join with a pairing code" SHALL send the code to `POST /v1/pairing/join` (as `aw pair`), show the check code and the name of the showing device, follow the pairing until it ends, and open the Inbox of the joined workspace when it is done. It SHALL make no master key. The navigation SHALL add, rename and remove a workspace, and add a project to a workspace. Each project SHALL have a Settings page in titled sections: General (the name, the default agent, the main repository and the links), Devices (the device order and the subtask switch), Test servers, one Save for these synced settings; "This device" (the checkout path, its session host, the test slots and "Use Orca on this device"); and Archive. Under the session host, a help line SHALL say where a session works: its own git worktree on the branch `aw/<key>`, in `~/.aw/worktrees/<task id>` with tmux and in the folder of Orca with Orca. The Settings page SHALL show the disclosure text of PRD SYN-06 with the community switch.

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
