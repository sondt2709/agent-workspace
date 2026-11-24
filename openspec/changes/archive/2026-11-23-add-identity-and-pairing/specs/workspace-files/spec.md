## MODIFIED Requirements

### Requirement: Write guard
The `files` layer SHALL refuse a write to a file that this device does not own, by the ownership table of `docs/architecture.md` 4.3.1 and the folder layout of `docs/phase-1.md` 3.1. It SHALL also refuse a path outside the layout, a path with `..`, a `*.aw-tmp` or `*.sync-conflict-*` name in any part of the path, the `secure` folder on a mobile device, a device record without the master key, and a second write of an approach version. The layout SHALL include `secure/keys/<device>.age` (the credential key sealed to a computer; a shared file, on computers only). The deletes of the `files` layer are: `removeHeartbeatLog(path)`, which SHALL remove a file only when the path matches the `device-heartbeat` rule and names this device; `removeKnowledgeFile(path)`, which SHALL remove a file only when the path matches the `knowledge-file` rule (a shared knowledge file, never a knowledge log); `removeCredentialFile(path)`, which SHALL remove a file only when the path matches the `credential` rule; `resolveConflictCopy(copy, keep)`, which SHALL remove only a conflict copy whose original path this device may write; and `mergeLogCopy(copy)`, which SHALL remove only a conflict copy of a log of this device. Each SHALL refuse each other path.

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

#### Scenario: Remove a knowledge file
- **WHEN** a device calls `removeKnowledgeFile("knowledge/projects/billing-api/learned/2026-11-22-x.md")`
- **THEN** the file is removed

#### Scenario: Remove a knowledge log
- **WHEN** a device calls `removeKnowledgeFile` with `knowledge/log/macbook-pro.jsonl` or with `tasks/workspace.yaml`
- **THEN** the guard refuses the delete with a write-refused error and the file stays

#### Scenario: Remove a credential file
- **WHEN** a computer calls `removeCredentialFile("secure/credentials/stripe-test.age")`, then `removeCredentialFile("secure/keys/ubuntu-01.age")`
- **THEN** the first file is removed, and the guard refuses the second delete

#### Scenario: Sealed key on a phone
- **WHEN** a mobile device writes `secure/keys/pixel-9.age`
- **THEN** the guard refuses the write

#### Scenario: Conflict copy of another device's log
- **WHEN** `macbook-pro` calls `mergeLogCopy` with a conflict copy of `tasks/<task-id>/log/ubuntu-01.jsonl`
- **THEN** the guard refuses it and the copy stays
