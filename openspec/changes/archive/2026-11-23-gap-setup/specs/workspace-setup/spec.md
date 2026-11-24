## ADDED Requirements

### Requirement: Personal workspace by default
awd SHALL create the workspace "Personal" at `<user home>/AW/Personal` when `POST /v1/workspaces` has no `path`. A `name` with no `path` SHALL give the folder `<user home>/AW/<name>`. `aw workspace init` with no path SHALL send no path. awd SHALL NOT create a workspace by itself at its start, so that a new device can still join with `aw pair`.

#### Scenario: First setup with no path
- **WHEN** a person runs `aw workspace init` on a device with no workspace
- **THEN** awd creates `~/AW/Personal` with the name "Personal", registers it and answers 201

#### Scenario: awd start with no workspace
- **WHEN** awd starts with an empty `config.yaml` workspace list
- **THEN** awd registers no workspace and creates no master key

### Requirement: Rename and remove a workspace
`PATCH /v1/workspaces/:ws` with `name` SHALL write the new name to `tasks/workspace.yaml` and return the workspace summary. `DELETE /v1/workspaces/:ws` SHALL unregister the workspace on this device: it removes the entry from `config.yaml`, closes the workspace, stops its session manager and removes its engine folders. The files SHALL stay, and the reply SHALL name the folder. awd SHALL refuse the remove with 409 `conflict` while a session of the workspace runs on this device. Both are person routes. `aw workspace rename <name>` and `aw workspace remove` SHALL call them.

#### Scenario: Rename
- **WHEN** a person runs `aw workspace rename Acme`
- **THEN** `tasks/workspace.yaml` has `name: Acme` and `aw workspace list` shows Acme

#### Scenario: Remove keeps the files
- **WHEN** a person removes a workspace with no running session
- **THEN** `aw workspace list` does not show it, its folder still has `tasks/workspace.yaml`, and the reply says that the files stay

#### Scenario: Remove with a running session
- **WHEN** a session of the workspace runs on this device
- **THEN** awd answers 409 `conflict` and the workspace stays registered

### Requirement: Edit and archive a project
`PATCH /v1/workspaces/:ws/projects/:project` SHALL change the given fields of `project.yaml`: `name`, `devices`, `default_agent`, `links`, `main_repo`, `test_servers`, `switches.assign_new_subtasks_to_default_device` and `archived`. A `main_repo` that is not in `links` SHALL go to the front of `links`. An unknown project SHALL give 404. A body with no field SHALL give 400. A new task in an archived project SHALL give 400 `invalid_input`. `aw project edit`, `aw project archive` and `aw project unarchive` SHALL call the route. It is a person route.

#### Scenario: Device order
- **WHEN** a person runs `aw project edit billing-api --device ubuntu-01 --device macbook-pro`
- **THEN** `project.yaml` has `devices: [ubuntu-01, macbook-pro]`

#### Scenario: Archived project refuses new tasks
- **WHEN** a person archives a project and then creates a task in it
- **THEN** awd answers 400 and names the project as archived

### Requirement: Bindings of this device
`GET /v1/workspaces/:ws/bindings` SHALL return the bindings of this device. `PATCH /v1/workspaces/:ws/bindings` SHALL change `use_orca`, `resources` (the full map of test slot capacities) and `checkouts` (one entry per project: a `path` sets or replaces the checkout with its optional `session_host`; `path: null` removes it). A checkout path SHALL be absolute and an existing folder, else 400. A mobile device SHALL get 403 `refused`. It is a person route. `aw binding show|set|remove|slot|orca` SHALL call these routes. The session manager messages SHALL name `aw binding set` and `aw binding orca on` instead of a hand edit of `bindings.yaml`.

#### Scenario: Bind a checkout
- **WHEN** a person runs `aw binding set billing-api /work/billing-api --host tmux`
- **THEN** `tasks/devices/<this device>/bindings.yaml` has the checkout with `session_host: tmux`, and the other fields stay

#### Scenario: Relative path
- **WHEN** the checkout path is `work/billing-api`
- **THEN** awd answers 400 and writes nothing

### Requirement: Community switch setting
awd SHALL keep the switch "Use community discovery and relay servers" in `config.yaml` as `sync.community`, default on. `AW_SYNC_COMMUNITY`, when set, SHALL win. `GET /v1/sync/settings` SHALL return `community`, its `source` (`env`, `config` or `default`) and the disclosure text of PRD SYN-06. `PUT /v1/sync/settings` with `community` SHALL save the value and apply it to the engine; with `AW_SYNC_COMMUNITY` set it SHALL answer 409 `conflict`. `aw sync community` SHALL show the value, and `aw sync community on|off` SHALL set it. The PUT is a person route.

#### Scenario: Turn off
- **WHEN** a person runs `aw sync community off`
- **THEN** `config.yaml` has `sync.community: false`, and the engine options have global discovery and relays off

#### Scenario: Variable set
- **WHEN** awd runs with `AW_SYNC_COMMUNITY=off` and a person sends `PUT /v1/sync/settings` with `community: true`
- **THEN** awd answers 409 and names `AW_SYNC_COMMUNITY`

### Requirement: Desktop setup screens
The desktop app SHALL show a "Create the Personal workspace" button when no workspace exists. The navigation SHALL add, rename and remove a workspace, and add a project to a workspace. Each project SHALL have a Settings page with the name, the device order, the default agent, the links and the main repository, the test servers, the subtask switch, archive, and for this device the checkout path, its session host, the test slots and "Use Orca on this device". The Settings page SHALL show the disclosure text of PRD SYN-06 with the community switch.

#### Scenario: Empty state
- **WHEN** the app starts and awd has no workspace
- **THEN** the Home screen shows "Create the Personal workspace", and a click creates it and opens its Inbox

#### Scenario: Community switch
- **WHEN** a person turns off the switch in Settings
- **THEN** the app sends `PUT /v1/sync/settings` with `community: false` and shows "LAN and Tailscale only"
