## MODIFIED Requirements

### Requirement: Desktop setup screens
The desktop app SHALL show a "Create the Personal workspace" button and a "Join with a pairing code" button when no workspace exists. "Join with a pairing code" SHALL send the code to `POST /v1/pairing/join` (as `aw pair`), show the check code and the name of the showing device, follow the pairing until it ends, and open the Inbox of the joined workspace when it is done. It SHALL make no master key. The workspace switcher at the top of the navigation SHALL list each workspace of this device with its folder, switch to the selected workspace, and SHALL add a project, add a workspace, rename the current workspace and remove it from this device. The folder field of "Add a workspace" and the checkout folder of Project settings SHALL have "Choose…", which opens the native folder picker. Each project SHALL have a Settings page in titled sections: General (the name, the default agent, the main repository and the links), Devices (the device order and the subtask switch), Test servers, one Save for these synced settings; "This device" (the checkout path, its session host, the test slots and "Use Orca on this device"); and Archive. Under the session host, a help line SHALL say where a session works: its own git worktree on the branch `aw/<key>`, in `~/.aw/worktrees/<task id>` with tmux and in the folder of Orca with Orca. The Settings page SHALL show the disclosure text of PRD SYN-06 with the community switch.

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

### Requirement: Add a project with its checkout
The desktop app SHALL add a project in one dialog: the checkout folder of this device from the native folder picker, the name (from the folder name by default) and the slug (from the name). "Add project" SHALL call `addProject` and then `editBindings` with the checkout of this device. When the binding fails, the dialog SHALL keep the project and SHALL offer to save the folder again, with no second `addProject`. The dialog SHALL refuse a folder inside the workspace folder, and SHALL warn when the folder is not a git repository. On a device that runs no agent, the dialog SHALL ask for no folder. The dialog SHALL open from the "+" of the Projects section in the navigation, the workspace switcher menu, the empty Inbox, and New task with no project, and a resize of the window SHALL not close it. After the add, the app SHALL open the Board of the project, or New task when the person came from New task.

#### Scenario: A checkout in a folder of the organization
- **WHEN** the person selects "Add a project" in the empty Inbox and picks the folder `~/dev/example-org/billing-api`
- **THEN** the name is `billing-api`, and "Add project" sends `addProject` with `slug: billing-api`, then `editBindings` with the checkout `billing-api` at that folder, and the app opens the Board of `billing-api`

#### Scenario: Folder in the workspace
- **WHEN** the person picks a folder inside the folder of the workspace
- **THEN** the dialog says that the devices sync that folder, and "Add project" is off

#### Scenario: Binding fails
- **WHEN** `addProject` succeeds and `editBindings` fails
- **THEN** the dialog shows the error and "Save the folder", which sends only `editBindings`

#### Scenario: Narrow window
- **WHEN** the Add a project dialog is open and the window becomes 400 px wide
- **THEN** the dialog stays open with its values
