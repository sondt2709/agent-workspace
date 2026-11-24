## ADDED Requirements

### Requirement: Folder rule for a new or joined workspace
awd SHALL choose the folder of a new workspace (`POST /v1/workspaces`) and of a joined workspace (`POST /v1/pairing/join`) with one rule. With `parent` (the location, an absolute path) or with no `path` and no `parent` (the location `<user home>/AW`), awd SHALL try `<location>/<folder name>`, then `<folder name>-aw1`, `-aw2`, up to `-aw99`, and SHALL use the first free candidate. The folder name SHALL be the workspace name with no path separator, no control character and no leading dot (else the workspace id, or "Personal" for init). A candidate SHALL be free when it does not exist, when it is a folder with only `tasks`, `knowledge`, `secure` and `.DS_Store`, or when its `tasks/workspace.yaml` is of this workspace (join: the same id; init: the same name and key prefix). A file, a symbolic link, a folder with other files, a folder of another workspace, a registered folder of another workspace and the folder of an open join SHALL be taken. When each candidate is taken, awd SHALL answer 409 `conflict`. The location MAY hold other files, and awd SHALL create a missing location. `path` and `parent` together SHALL give 400.

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

### Requirement: Safety checks of a workspace folder
awd SHALL refuse a workspace folder (from `path`, or the candidate of a location) that is in the state folder (AW_HOME) or holds it, that is in a registered workspace folder or holds one, or that is in a checkout of this device (the bindings of each workspace) or holds one (409 `conflict`, before any change). It SHALL refuse a folder whose nearest existing folder is not writable (403 `refused`). Each check SHALL use the paths with their symbolic links resolved. awd SHALL store the normalized path as given in `config.yaml`.

#### Scenario: Location inside another workspace
- **WHEN** a person runs `aw workspace init --in ~/AW/Personal/sub --name demo`, and `~/AW/Personal` is a registered workspace folder
- **THEN** awd answers 409, names `~/AW/Personal`, and creates nothing

#### Scenario: Location through a symbolic link into the state folder
- **WHEN** `/srv/link` is a symbolic link to AW_HOME, and a person runs `aw workspace init --in /srv/link --name demo`
- **THEN** awd answers 409 and creates nothing

#### Scenario: Location that is not writable
- **WHEN** the location is a folder that this user cannot write
- **THEN** awd answers 403 `refused` and names the folder

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
