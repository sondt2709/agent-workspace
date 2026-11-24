## MODIFIED Requirements

### Requirement: Write guard
The `files` layer SHALL refuse a write to a file that this device does not own, by the ownership table of `docs/architecture.md` 4.3.1 and the folder layout of `docs/phase-1.md` 3.1. It SHALL also refuse a path outside the layout, a path with `..`, a `*.aw-tmp` or `*.sync-conflict-*` name in any part of the path, the `secure` folder on a mobile device, a device record without the master key, and a second write of an approach version. The deletes of the `files` layer are: `removeHeartbeatLog(path)`, which SHALL remove a file only when the path matches the `device-heartbeat` rule and names this device; `resolveConflictCopy(copy, keep)`, which SHALL remove only a conflict copy whose original path this device may write; and `mergeLogCopy(copy)`, which SHALL remove only a conflict copy of a log of this device. Each SHALL refuse each other path.

#### Scenario: Log of another device
- **WHEN** `macbook-pro` writes `tasks/<task-id>/log/ubuntu-01.jsonl`
- **THEN** the guard refuses the write with a write-refused error that names the path and the rule

#### Scenario: Snapshot of a task that another device owns
- **WHEN** `macbook-pro` writes `task.yaml` of a task whose owner device is `ubuntu-01`
- **THEN** the guard refuses the write

#### Scenario: Shared file
- **WHEN** any device writes `tasks/projects/billing-api/project.yaml`
- **THEN** the guard allows the write

#### Scenario: Remove an own heartbeat log
- **WHEN** `macbook-pro` calls `removeHeartbeatLog("tasks/devices/macbook-pro/heartbeat/2026-11-01.jsonl")`
- **THEN** the file is removed

#### Scenario: Remove another log
- **WHEN** `macbook-pro` calls `removeHeartbeatLog` with `tasks/devices/ubuntu-01/heartbeat/2026-11-01.jsonl` or with a task log of `macbook-pro`
- **THEN** the guard refuses the delete with a write-refused error and the file stays

#### Scenario: Conflict copy of another device's log
- **WHEN** `macbook-pro` calls `mergeLogCopy` with a conflict copy of `tasks/<task-id>/log/ubuntu-01.jsonl`
- **THEN** the guard refuses it and the copy stays

## ADDED Requirements

### Requirement: Write hook
`openWorkspace` SHALL accept an `onWrite(path, content)` hook. The files layer SHALL call it after each successful document write, event append, file write, heartbeat removal and conflict operation, with the workspace-relative path and the written bytes (null for a removal).

#### Scenario: Append
- **WHEN** a device appends an event with a hook set
- **THEN** the hook gets the log path and the appended line once

### Requirement: Conflict copy names
`parseConflictCopy(path)` SHALL return the original path, the date and time and the 7-character short device id of a Syncthing conflict copy name `<stem>.sync-conflict-<YYYYMMDD>-<HHMMSS>-<ID><ext>`, and null for any other name.

#### Scenario: Knowledge file
- **WHEN** the path is `knowledge/shared/t.sync-conflict-20261123-032921-5NRSCRM.md`
- **THEN** the original is `knowledge/shared/t.md` and the short id is `5NRSCRM`
