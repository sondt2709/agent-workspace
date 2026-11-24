## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Location field of the desktop setup dialogs
"Join with a pairing code" and "Add a workspace" SHALL have a "Location" field with "Choose…" (the native folder picker, purpose `workspace`) and the placeholder `~/AW`. An empty field SHALL send no location; a path SHALL be absolute and SHALL go as `parent`. The help text SHALL say that the location can hold other files and that AW makes the folder `<name>` in it, or `<name>-aw1` when that name is in use. The Join dialog SHALL show the folder of the pairing and its note while the pairing runs. "Add a workspace" SHALL show the note before it opens the Inbox when awd used a suffix.

#### Scenario: Join into a location
- **WHEN** the person types `/Users/example/Work` in Location and joins with the code of `mac-mini-lab`
- **THEN** the app sends `joinPairing` with `parent: /Users/example/Work`, and the dialog shows "Folder: /Users/example/Work/demo"

#### Scenario: Add with a taken name
- **WHEN** the person adds the workspace "demo" with Location `/Users/example/Work`, and `/Users/example/Work/demo` holds other files
- **THEN** the dialog shows that AW uses `/Users/example/Work/demo-aw1`, and "Open the workspace" opens its Inbox
