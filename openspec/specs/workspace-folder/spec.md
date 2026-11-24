# workspace-folder Specification

## Purpose
The folder of each workspace on a device: the location that the person chooses, the `-aw1` suffix rule, the safety checks, and the folder in the replies (docs/decisions/2026-11-24-workspace-folder.md).
## Requirements
### Requirement: Folder rule for a new or joined workspace
awd SHALL choose the folder of a new workspace (`POST /v1/workspaces`) and of a joined workspace (`POST /v1/pairing/join`) with one rule. With `parent` (the location, an absolute path) or with no `path` and no `parent` (the location `<user home>/AW`), awd SHALL try `<location>/<folder name>`, then `<folder name>-aw1`, `-aw2`, up to `-aw99`, and SHALL use the first free candidate. The folder name SHALL be the workspace name with no path separator, no control character and no leading dot (else the workspace id, or "Personal" for init). A candidate SHALL be free when it does not exist, when it is a folder with only `tasks`, `knowledge`, `secure` and `.DS_Store`, or when its `tasks/workspace.yaml` is of this workspace (join: the same id; init: the same name and key prefix). A file, a symbolic link, a folder with other files, a folder that awd cannot read, a folder of another workspace, a registered folder of another workspace and the folder of an open join SHALL be taken. awd SHALL compare a candidate with the registered folders and the folders of open joins by their real paths (symbolic links resolved). A registered folder that is a symbolic link SHALL be free for its own workspace. When the location itself is the folder of this workspace (join: the same id), awd SHALL use the location. When each candidate is taken, awd SHALL answer 409 `conflict`. The location MAY hold other files, and awd SHALL create a missing location. `path` and `parent` together SHALL give 400.

#### Scenario: Location with other files
- **WHEN** ubuntu-01 joins the workspace "demo" with `parent: /srv/work`, and `/srv/work` holds `notes.txt` and no `demo`
- **THEN** awd uses `/srv/work/demo`, and `notes.txt` stays where it is

#### Scenario: Name taken by other files
- **WHEN** a person runs `aw workspace init --in /srv/work --name demo`, and `/srv/work/demo` holds `report.pdf`
- **THEN** awd creates the workspace in `/srv/work/demo-aw1` and says that `/srv/work/demo` is in use

#### Scenario: Suffix taken too
- **WHEN** `/srv/work/demo` has another workspace and `/srv/work/demo-aw1` holds other files
- **THEN** awd uses `/srv/work/demo-aw2`

#### Scenario: Same workspace again
- **WHEN** ubuntu-01 joins the workspace "demo" again after `aw workspace remove`, and `/srv/work/demo-aw1` has its `tasks/workspace.yaml`
- **THEN** awd uses `/srv/work/demo-aw1` again, also when `/srv/work/demo` is taken

#### Scenario: Symbolic link candidate
- **WHEN** `/srv/work/demo` is a symbolic link to an empty folder
- **THEN** awd skips it and uses `/srv/work/demo-aw1`

#### Scenario: Registered folder behind a linked location
- **WHEN** `/srv/link` is a symbolic link to `/srv/work`, `/srv/work/demo` is the registered folder of another workspace whose files did not arrive yet, and ubuntu-01 joins "demo" with `parent: /srv/link`
- **THEN** awd skips `/srv/link/demo` and uses `/srv/link/demo-aw1`

#### Scenario: Folder that awd cannot read
- **WHEN** `/srv/work/demo` is a folder that this user cannot read
- **THEN** awd skips it with the reason "AW cannot read it" and uses `/srv/work/demo-aw1`

### Requirement: Safety checks of a workspace folder
awd SHALL refuse a workspace folder (from `path`, or the candidate of a location) that is in the state folder (AW_HOME) or holds it, that is a registered folder of another workspace, is in one or holds one, that is the folder of an open join of another workspace or holds one, that is in a folder with `tasks/workspace.yaml` (registered or not), or that is in a checkout of this device (the bindings of each workspace) or holds one (409 `conflict`, before any change). It SHALL refuse a folder whose nearest existing folder is not writable (403 `refused`). Each check SHALL use the paths with their symbolic links resolved. awd SHALL store the normalized path as given in `config.yaml`.

#### Scenario: Location inside another workspace
- **WHEN** a person runs `aw workspace init --in ~/AW/Personal/sub --name demo`, and `~/AW/Personal` is a registered workspace folder
- **THEN** awd answers 409, names `~/AW/Personal`, and creates nothing

#### Scenario: Location through a symbolic link into the state folder
- **WHEN** `/srv/link` is a symbolic link to AW_HOME, and a person runs `aw workspace init --in /srv/link --name demo`
- **THEN** awd answers 409 and creates nothing

#### Scenario: Location in a workspace folder that is not registered
- **WHEN** `/srv/acme` has `tasks/workspace.yaml` and is not registered on this device, and a person runs `aw pair <code> --in /srv/acme/sub`
- **THEN** awd answers 409, names `/srv/acme`, and creates nothing

#### Scenario: Exact folder of another workspace before its files arrive
- **WHEN** `/srv/aw/demo` is the registered folder of another workspace and holds only an empty `tasks` folder, and ubuntu-01 runs `aw pair <code> --path /srv/aw/demo`
- **THEN** awd answers 409 and joins nothing

#### Scenario: Location that is not writable
- **WHEN** the location is a folder that this user cannot write
- **THEN** awd answers 403 `refused` and names the folder

### Requirement: Location that is a workspace folder
For init (`POST /v1/workspaces` with `parent`, or no `path` and no `parent`), when the location itself has `tasks/workspace.yaml`, awd SHALL register the location as the path form does, and SHALL NOT make a new workspace in it. The reply SHALL have `created: false` and a `folder_note` that names the folder and the workspace. This keeps the desktop "Add a workspace" able to register a folder that another device synced (wf-2).

#### Scenario: Add a synced folder
- **WHEN** `/Users/example/Sync/Acme` has the workspace "Acme" and is not registered, and the person adds a workspace with Location `/Users/example/Sync/Acme`
- **THEN** awd registers the workspace "Acme" at `/Users/example/Sync/Acme`, makes no folder in it, and the note is "/Users/example/Sync/Acme is the folder of the workspace Acme, so AW registers it."

### Requirement: Exact workspace folder
`path` SHALL stay the workspace folder itself. For a join, the folder SHALL be missing, empty (only `tasks`, `knowledge`, `secure`, `.DS_Store`) or the folder of this workspace; else awd SHALL answer 409 and name `--in`. For init, a folder with `tasks/workspace.yaml` SHALL be registered as today.

#### Scenario: Old form of aw pair
- **WHEN** ubuntu-01 runs `aw pair <code> --path /srv/aw/demo`, and `/srv/aw/demo` does not exist
- **THEN** awd joins the workspace into `/srv/aw/demo` with no suffix

#### Scenario: Old form with other files
- **WHEN** ubuntu-01 runs `aw pair <code> --path /srv/work`, and `/srv/work` holds `notes.txt`
- **THEN** `aw` exits with 1, and the error names `--in /srv/work`

### Requirement: Folder in the replies
The init reply SHALL have `folder_note`: null, or one sentence that names each skipped candidate with its reason and the folder that awd used. The pairing view SHALL have `folder` (the workspace folder of the join side, null on the show side) and `folder_note`. awd SHALL NOT write the folder into a synced file.

#### Scenario: Note after a suffix
- **WHEN** awd uses `/srv/work/demo-aw1` because `/srv/work/demo` holds other files
- **THEN** the reply has `folder_note` "/srv/work/demo is in use (other files), so AW uses /srv/work/demo-aw1."

### Requirement: One folder choice at a time
awd SHALL choose and reserve the folder of a join in the same queue as each workspace init, so that a join and an init, or 2 joins, never choose the same folder. When the person approves the join, awd SHALL check again that the folder has no `tasks/workspace.yaml` of another workspace before it adds the sync folders; else the join fails and syncs nothing.

#### Scenario: Join and init at the same time
- **WHEN** ubuntu-01 joins the workspace "acme" with `parent: /srv/work`, and at the same time a person runs `aw workspace init --in /srv/work --name acme`
- **THEN** one of them uses `/srv/work/acme` and the other uses `/srv/work/acme-aw1`

#### Scenario: Folder taken while the person approves
- **WHEN** a join waits for the approval, and its folder gets a `tasks/workspace.yaml` of another workspace
- **THEN** the join fails after the approval, names the folder, and adds no sync folder
