## ADDED Requirements

### Requirement: Presence route
`GET /v1/workspaces/{ws}/presence` SHALL return the presence view of the merge: for each device `online`, `last_heartbeat_hlc`, `received_at` and `offline_since`, and the offline tasks. A workspace that is not open SHALL give 503 `not_ready`.

#### Scenario: Device offline
- **WHEN** no heartbeat of `ubuntu-01` arrived for 90 s
- **THEN** the reply has `ubuntu-01` with `online: false` and an `offline_since` time

### Requirement: Task folder routes
`GET /v1/workspaces/{ws}/tasks/{task}/files` SHALL list the entries of `tasks/<task id>/` (path from the workspace root, `kind` `dir` or `file`, `size`, `modified`), sorted by path, without temporary files, at most 5,000 entries with `truncated: true` when more exist. `GET .../files/content?path=` SHALL return the text of one file of that folder, or `text: null` with a reason for a file over 1 MiB or with bytes that are not UTF-8. A path outside the task folder, with `..`, or through a symbolic link that leaves the folder SHALL give 400 `invalid_input`; an unknown task SHALL give 404 `not_found`.

#### Scenario: Task folder
- **WHEN** a client lists the files of a task with `task.yaml`, `log/macbook-pro.jsonl` and `approach/v1.md`
- **THEN** the reply has the 3 files and the 2 folders `log` and `approach`

#### Scenario: Path outside the folder
- **WHEN** a client reads `tasks/<task id>/../workspace.yaml`
- **THEN** the reply is 400 `invalid_input` and no file is read

### Requirement: Restore a document
`POST /v1/workspaces/{ws}/documents/restore {path}` SHALL write the last valid value that the merge kept for a document with a `bad_document` issue, through the files layer, and merge. A path with no such issue SHALL give 409 `conflict`; a document with no valid version on this device SHALL give 404 `not_found`; a write that the ownership rules refuse SHALL give 403 `refused`. It SHALL be a person route.

#### Scenario: Restore after a bad edit
- **WHEN** a person broke `projects/billing-api/project.yaml` by hand and the merge kept its last valid value
- **THEN** the route writes that value, and the issue goes away after the merge
