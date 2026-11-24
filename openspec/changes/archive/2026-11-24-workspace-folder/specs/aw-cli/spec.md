## ADDED Requirements

### Requirement: Workspace folder options and output
`aw workspace init` and `aw pair` SHALL have `--in <folder>`: the location that holds the workspace folder (sent as `parent`). `--path` of `aw pair` and the path argument of `aw workspace init` SHALL keep their meaning: the workspace folder itself. The CLI SHALL refuse a path and `--in` together (exit 2). The CLI SHALL print the folder that awd used and the `folder_note` of the reply. `aw status` SHALL print a line `  Folder: <path>` under each workspace. `aw workspace list` SHALL keep the PATH column.

#### Scenario: Init with a location
- **WHEN** a person runs `aw workspace init --in /srv/work --name demo`, and `/srv/work/demo` holds other files
- **THEN** `aw` prints "Created workspace demo (…) at /srv/work/demo-aw1" and the note, and exits with 0

#### Scenario: Status shows the folder
- **WHEN** a person runs `aw status` on a device with the workspace demo at `/srv/work/demo-aw1`
- **THEN** the output has the line "  Folder: /srv/work/demo-aw1" under the workspace line
