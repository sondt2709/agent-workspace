## MODIFIED Requirements

### Requirement: Task loop session routes
The local API SHALL have the agent routes `POST /v1/sessions/{session}/proposal` (with `/approach` as an alias that calls the same handler), `/ready`, `/tasks`, `/gate`, `/result` and `/done` (access `agent`). Each SHALL act only on the session task (`/tasks` creates a subtask of it) and SHALL call the same method as the MCP tool.

#### Scenario: Another task
- **WHEN** the session of AW-7 posts `/v1/sessions/<session>/done` with the task AW-8
- **THEN** the reply is 403 `refused` and nothing is written

### Requirement: Task folder routes
`GET /v1/workspaces/{ws}/tasks/{task}/files` SHALL list the entries of `tasks/<task id>/` (path from the workspace root, `kind` `dir` or `file`, `size`, `modified`), sorted by path, without temporary files (`*.aw-tmp`, `.syncthing.*.tmp`, `~syncthing~*.tmp`) and without an entry that goes away during the listing, at most 5,000 entries with `truncated: true` when more exist. `GET .../files/content?path=` SHALL return the text of one file of that folder, or `text: null` with a reason for a file over 1 MiB or with bytes that are not UTF-8. A path outside the task folder, with `..`, or through a symbolic link that leaves the folder, and a task folder (or `tasks`) that is a symbolic link, SHALL give 400 `invalid_input`; an unknown task SHALL give 404 `not_found`. Both SHALL be person routes.

#### Scenario: Task folder
- **WHEN** a client lists the files of a task with `task.yaml`, `log/macbook-pro.jsonl` and `proposal/v1.md`
- **THEN** the reply has the 3 files and the 2 folders `log` and `proposal`

#### Scenario: Path outside the folder
- **WHEN** a client reads `tasks/<task id>/../workspace.yaml`
- **THEN** the reply is 400 `invalid_input` and no file is read
