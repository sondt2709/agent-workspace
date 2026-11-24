# workspace-setup Specification

## Purpose
The setup of a workspace without a hand edit of a YAML file: the default workspace, rename and remove, project edit and archive, the bindings of this device, the community switch, and their desktop screens.
## Requirements
### Requirement: Personal workspace by default
awd SHALL create the workspace "Personal" in the location `<user home>/AW` when `POST /v1/workspaces` has no `path` and no `parent`. A `name` with no `path` SHALL give the folder `<location>/<name>`. The folder SHALL follow the folder rule of the `workspace-folder` capability: a taken name gives `<name>-aw1`, then `-aw2`. `aw workspace init` with no path SHALL send no path; `--in <folder>` SHALL send `parent`. awd SHALL NOT create a workspace by itself at its start, so that a new device can still join with `aw pair`.

#### Scenario: First setup with no path
- **WHEN** a person runs `aw workspace init` on a device with no workspace
- **THEN** awd creates `~/AW/Personal` with the name "Personal", registers it and answers 201

#### Scenario: Default folder with another workspace
- **WHEN** a person creates the workspace "Acme" with the key prefix `ACM` and no path, and `~/AW/Acme` has a removed workspace with another name or key prefix
- **THEN** awd creates the workspace in `~/AW/Acme-aw1`, answers 201 with a `folder_note` that names `~/AW/Acme`, and leaves the old workspace as it is

#### Scenario: Default folder with files of the person
- **WHEN** a person runs `aw workspace init` and `~/AW/Personal` holds `notes.txt` and no workspace
- **THEN** awd creates the workspace in `~/AW/Personal-aw1`, and `notes.txt` stays out of the workspace

#### Scenario: awd start with no workspace
- **WHEN** awd starts with an empty `config.yaml` workspace list
- **THEN** awd registers no workspace and creates no master key

### Requirement: Rename and remove a workspace
`PATCH /v1/workspaces/:ws` with `name` SHALL write the new name to `tasks/workspace.yaml` and return the workspace summary. `DELETE /v1/workspaces/:ws` SHALL unregister the workspace on this device: it removes the entry from `config.yaml`, closes the workspace, stops its session manager and removes its engine folders. When the engine does not run at the remove, the engine start SHALL remove each workspace folder that no registered workspace has. The files SHALL stay, and the reply SHALL name the folder. The reply SHALL list the keys of the open tasks (not done, not archived) that stay assigned to an agent of this device (`tasks`), and its message SHALL ask the person to assign them to another device; the desktop Remove dialog SHALL name them before the remove. awd SHALL refuse the remove with 409 `conflict` while a session of the workspace runs on this device. awd SHALL stop the session manager of the workspace before this check, so a session start in progress counts, and SHALL count the sessions of a workspace that waits for the host or the agent by their tmux panes; after a refusal the manager SHALL start again. An open attempt that runs SHALL end before the remove. Both are person routes. `aw workspace rename <name>` and `aw workspace remove` SHALL call them.

#### Scenario: Rename
- **WHEN** a person runs `aw workspace rename Acme`
- **THEN** `tasks/workspace.yaml` has `name: Acme` and `aw workspace list` shows Acme

#### Scenario: Remove keeps the files
- **WHEN** a person removes a workspace with no running session
- **THEN** `aw workspace list` does not show it, its folder still has `tasks/workspace.yaml`, and the reply says that the files stay

#### Scenario: Remove with open tasks of this device
- **WHEN** the person removes a workspace where AW-3 is assigned to `claude@macbook-pro`, on `macbook-pro`
- **THEN** the reply has `tasks: ["AW-3"]`, and the message says "These tasks stay assigned to macbook-pro, which runs no session for them now: AW-3. Assign them to another device."

#### Scenario: Remove during a session start
- **WHEN** the person removes a workspace while its manager starts a session
- **THEN** awd answers 409 with the session id and keeps the workspace and its manager, or the session does not start

#### Scenario: Remove while the engine is down
- **WHEN** the person removes a workspace while the engine restarts
- **THEN** after the engine start, `/rest/config/folders` has no folder of that workspace, and a pairing folder stays

#### Scenario: Remove with a running session
- **WHEN** a session of the workspace runs on this device
- **THEN** awd answers 409 `conflict` and the workspace stays registered

### Requirement: Edit and archive a project
`PATCH /v1/workspaces/:ws/projects/:project` SHALL change the given fields of `project.yaml`: `name`, `devices`, `default_agent`, `links`, `main_repo`, `test_servers`, `switches.assign_new_subtasks_to_default_device` and `archived`. A `main_repo` that is not in `links` SHALL go to the front of `links`. An unknown project SHALL give 404. A body with no field SHALL give 400. A new task in an archived project SHALL give 400 `invalid_input`. The New task screens of the desktop app and the phone SHALL NOT list an archived project, and the phone SHALL refuse a new task in it with "<project> is archived: it gets no new tasks.". The merge does not refuse such a task: the archive state is a document with no order against the events, so 2 devices could decide differently. `aw project edit`, `aw project archive` and `aw project unarchive` SHALL call the route. It is a person route.

#### Scenario: Device order
- **WHEN** a person runs `aw project edit billing-api --device ubuntu-01 --device macbook-pro`
- **THEN** `project.yaml` has `devices: [ubuntu-01, macbook-pro]`

#### Scenario: Archived project refuses new tasks
- **WHEN** a person archives a project and then creates a task in it
- **THEN** awd answers 400 and names the project as archived

#### Scenario: Archived project on the phone
- **WHEN** `billing-api` is archived on the Mac, and the person opens New task on the phone
- **THEN** the phone does not list `billing-api`, and a create in it is refused with no write

### Requirement: Bindings of this device
`GET /v1/workspaces/:ws/bindings` SHALL return the bindings of this device. `PATCH /v1/workspaces/:ws/bindings` SHALL change `use_orca`, `resources` (the full map of test slot capacities) and `checkouts` (one entry per project: a `path` sets or replaces the checkout with its optional `session_host`; with no `session_host` the entry keeps the host of the old entry, and `session_host: null` sets the default host; `path: null` removes it). `aw binding set --host default` SHALL send `null`. A checkout path SHALL be absolute and an existing folder, and SHALL not be the workspace folder or a folder in it (after awd resolves symbolic links), else 400 (the devices sync the workspace folder). A mobile device SHALL get 403 `refused`. It is a person route. `aw binding show|set|remove|slot|orca` SHALL call these routes. The session manager messages SHALL name `aw binding set` and `aw binding orca on` instead of a hand edit of `bindings.yaml`.

#### Scenario: Bind a checkout
- **WHEN** a person runs `aw binding set billing-api /work/billing-api --host tmux`
- **THEN** `tasks/devices/<this device>/bindings.yaml` has the checkout with `session_host: tmux`, and the other fields stay

#### Scenario: Relative path
- **WHEN** the checkout path is `work/billing-api`
- **THEN** awd answers 400 and writes nothing

#### Scenario: Checkout in the workspace folder
- **WHEN** the checkout path is `<workspace folder>/code/billing-api`, or a symbolic link to it, from the route or `aw binding set`
- **THEN** awd answers 400 with "inside the workspace folder" and writes nothing

### Requirement: Community switch setting
awd SHALL keep the switch "Use community discovery and relay servers" in `config.yaml` as `sync.community`, default on. `AW_SYNC_COMMUNITY`, when set, SHALL win. `GET /v1/sync/settings` SHALL return `community`, its `source` (`env`, `config` or `default`) and the disclosure text of PRD SYN-06. `PUT /v1/sync/settings` with `community` SHALL save the value and apply it to the engine; with `AW_SYNC_COMMUNITY` set it SHALL answer 409 `conflict`. `aw sync community` SHALL show the value, also in an agent session, and `aw sync community on|off` SHALL set it; the CLI SHALL refuse the set in an agent session (exit code 1). The PUT is a person route.

#### Scenario: Turn off
- **WHEN** a person runs `aw sync community off`
- **THEN** `config.yaml` has `sync.community: false`, and the engine options have global discovery and relays off

#### Scenario: Variable set
- **WHEN** awd runs with `AW_SYNC_COMMUNITY=off` and a person sends `PUT /v1/sync/settings` with `community: true`
- **THEN** awd answers 409 and names `AW_SYNC_COMMUNITY`

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

#### Scenario: Move to the settings of another project
- **WHEN** the person is on the Settings page of `billing-api` and opens the Settings page of `web`, which has no checkout on this device
- **THEN** the "This device" section shows an empty checkout folder, not the folder of `billing-api`

#### Scenario: Switch workspace
- **WHEN** this device has the workspaces Personal and Side projects, and the person selects "Side projects" in the switcher
- **THEN** the app opens the Inbox of Side projects, and the navigation shows only its projects

#### Scenario: Remove section
- **WHEN** the person opens the Settings page of `billing-api`
- **THEN** the last section is "Remove" with the button "Remove the project…"

### Requirement: Add a project with its checkout
The desktop app SHALL add a project in one dialog: the checkout folder of this device from the native folder picker, the name (from the folder name by default) and the slug (from the name). "Add project" SHALL call `addProject` and then `editBindings` with the checkout of this device. When the binding fails, the dialog SHALL keep the project and SHALL offer to save the folder again, with no second `addProject`; "Close" SHALL then open the next screen of the added project. The dialog SHALL stay open while a call runs. The dialog SHALL refuse a folder inside the workspace folder, and SHALL warn when the folder is not a git repository. On a device that runs no agent, the dialog SHALL ask for no folder. The dialog SHALL open from the "+" of the Projects section in the navigation, the workspace switcher menu, the empty Inbox, and New task with no project, and a resize of the window SHALL not close it. After the add, the app SHALL open the Board of the project, or New task when the person came from New task.

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

### Requirement: Location field of the desktop setup dialogs
"Join with a pairing code" and "Add a workspace" SHALL have a "Location" field with "Choose…" (the native folder picker, purpose `workspace`) and the placeholder `~/AW`. An empty field SHALL send no location; a path SHALL be absolute and SHALL go as `parent`. The help text SHALL say that the location can hold other files and that AW makes the folder `<name>` in it, or `<name>-aw1` when that name is in use. The help text of "Add a workspace" SHALL also say that a workspace folder that another device synced adds that workspace. The Join dialog SHALL show the folder of the pairing and its note while the pairing runs. "Add a workspace" SHALL show the note before it opens the Inbox when awd used a suffix.

#### Scenario: Join into a location
- **WHEN** the person types `/Users/example/Work` in Location and joins with the code of `mac-mini-lab`
- **THEN** the app sends `joinPairing` with `parent: /Users/example/Work`, and the dialog shows "Folder: /Users/example/Work/demo"

#### Scenario: Add a synced workspace folder
- **WHEN** the person adds a workspace with Location `/Users/example/Sync/Acme`, and that folder has the workspace "Acme"
- **THEN** the dialog shows the note that AW registers it, and "Open the workspace" opens its Inbox

#### Scenario: Add with a taken name
- **WHEN** the person adds the workspace "demo" with Location `/Users/example/Work`, and `/Users/example/Work/demo` holds other files
- **THEN** the dialog shows that AW uses `/Users/example/Work/demo-aw1`, and "Open the workspace" opens its Inbox

