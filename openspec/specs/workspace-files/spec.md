# workspace-files Specification

## Purpose
The `files` layer of `shared/core`: the only way to write workspace files. It writes atomically, checks the owner of each file, redacts credential values and reports typed file errors.
## Requirements
### Requirement: Clock module
`@aw/core` SHALL have one clock module with `now()` and `sleep(ms)`. A fake clock SHALL let tests set and move the time, and SHALL resolve each sleep whose time has passed.

#### Scenario: Fake sleep
- **WHEN** a test calls `sleep(30000)` on the fake clock and then `advance(30000)`
- **THEN** the sleep resolves with no real wait

### Requirement: Atomic writes
The `files` layer SHALL write each whole file to a temp file whose name ends with `.aw-tmp` in the same folder, then rename it over the target. A failure or a crash before the rename SHALL leave the old file unchanged.

#### Scenario: Crash in the middle of a write
- **WHEN** a process is killed with SIGKILL after it wrote the temp file and before the rename
- **THEN** the target file has its old content, and the only extra file has a name that ends with `.aw-tmp`

#### Scenario: Error before the rename
- **WHEN** the write fails before the rename
- **THEN** the target file has its old content and no temp file stays

### Requirement: YAML documents
The `files` layer SHALL read a YAML document, check its syntax, its `kind`, its major version and its schema, and return the typed value. It SHALL write a document atomically, and keep the comments of the nodes that stay in the file. On read and on write, it SHALL compare the field that names the folder (`id` of `task.yaml`, `slug` of `project.yaml` and `device.yaml`, `device` of `health.yaml` and `bindings.yaml`) with the path. It SHALL refuse to write over a file of a newer major version.

#### Scenario: Comment survives an update
- **WHEN** `task.yaml` has the comment `# display alias` after the key, and the code changes the title
- **THEN** the new file has the new title and still has the comment `# display alias`

#### Scenario: Schema error
- **WHEN** a person edits `task.yaml` and sets `stage: testing`
- **THEN** the read fails with a schema error that has the file, the path `stage` and the field `stage`

#### Scenario: YAML syntax error
- **WHEN** a document has invalid YAML
- **THEN** the read fails with a parse error that has the file and the line

#### Scenario: Identity field of another folder
- **WHEN** `ubuntu-01` writes `tasks/devices/ubuntu-01/health.yaml` with `device: macbook-pro`, or a reader reads `tasks/projects/other-api/project.yaml` with `slug: billing-api`
- **THEN** the write fails with a write-refused error, and the read fails with a schema error on the field

#### Scenario: Newer document on disk
- **WHEN** `project.yaml` has `schema: 2` and this AW knows version 1
- **THEN** a write of `project.yaml` fails with a newer-version error and the file stays unchanged

### Requirement: JSON Lines logs
The `files` layer SHALL append one event as one line, after the schema check and the redaction. A line SHALL be at most 64 KiB. The writer SHALL never rewrite a line. When the file does not end with a newline, the writer SHALL first add a newline. The reader SHALL skip a half-written last line and report it, report each other bad line with its line number, and reject an event whose `dev` is not the device of the file name. A line nested deeper than 64 levels of objects and arrays SHALL be a bad line (`JSON nesting is deeper than 64 levels`), the same as in the Kotlin reader of the phone. The writer SHALL refuse, and the reader SHALL report, an event whose `task` is not the task of the folder, and a known event type that does not belong in that log: a heartbeat file holds `device.heartbeat` only, the knowledge log `knowledge.*` only, the workspace log `slot.*`, `queue.*` and `credential.*` only, and a task log the other types.

#### Scenario: Half-written last line
- **WHEN** a log ends with a part of a line and no newline
- **THEN** the reader returns the complete events, skips the part and reports it as the partial tail

#### Scenario: Deep line
- **WHEN** a valid event has an unknown key whose value is nested so that the line has 65 levels
- **THEN** the reader reports the line as a bad line with a parse error, and reads the next lines

#### Scenario: Append after a cut line
- **WHEN** the writer appends an event to a log that ends with a cut line
- **THEN** the new event is a complete valid line, and the cut line is a separate bad line

#### Scenario: Line too long
- **WHEN** the writer gets an event whose line is larger than 64 KiB
- **THEN** it refuses the event with a line-too-long error and writes nothing

#### Scenario: Event of another device
- **WHEN** `log/ubuntu-01.jsonl` has an event with `dev: pixel-9`
- **THEN** the reader reports a device-mismatch error ("Sync problem") for that line and does not return the event

#### Scenario: Event in the wrong log
- **WHEN** the code appends `task.done` of another task to `tasks/<task-id>/log/macbook-pro.jsonl`, or `slot.acquired` to `knowledge/log/macbook-pro.jsonl`
- **THEN** the writer refuses the event with a write-refused error and writes nothing

### Requirement: Write guard
The `files` layer SHALL refuse a write to a file that this device does not own, by the ownership table of `docs/architecture.md` 4.3.1 and the folder layout of `docs/phase-1.md` 3.1. It SHALL also refuse a path outside the layout, a path with `..`, a `*.aw-tmp` or `*.sync-conflict-*` name in any part of the path, the `secure` folder on a mobile device, a device record without the master key, and a second write of a proposal version. The layout SHALL include `tasks/<task-id>/proposal/v<n>.md` (written by the owner device), and SHALL keep `tasks/<task-id>/approach/v<n>.md` readable for the versions from before the rename; a new write to `approach/` SHALL be refused. The layout SHALL include `secure/keys/<device>.age` (the credential key sealed to a computer; a shared file, on computers only). The deletes of the `files` layer are: `removeHeartbeatLog(path)`, which SHALL remove a file only when the path matches the `device-heartbeat` rule and names this device; `removeKnowledgeFile(path)`, which SHALL remove a file only when the path matches the `knowledge-file` rule (a shared knowledge file, never a knowledge log); `removeCredentialFile(path)`, which SHALL remove a file only when the path matches the `credential` rule; `resolveConflictCopy(copy, keep)`, which SHALL remove only a conflict copy whose original path this device may write; and `mergeLogCopy(copy)`, which SHALL remove only a conflict copy of a log of this device. Each SHALL refuse each other path.

#### Scenario: Proposal file
- **WHEN** the owner device writes `tasks/<task-id>/proposal/v6.md`, then writes it again, then writes `tasks/<task-id>/approach/v7.md`
- **THEN** the first write passes, the second is refused as a second write of a version, and the third is refused because `approach/` is read-only

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

### Requirement: Redaction
Before the `files` layer writes an event line or a text file of a task, it SHALL replace each credential value of the session with `[redacted:<name>]`. The text files of a task SHALL be the terminal snapshot (`terminal/<device>.txt`), the approach versions (`approach/v<n>.md`) and the artifacts (`artifacts/<device>/…`) whose content is text. A string SHALL be text. A terminal snapshot SHALL always be text: the `files` layer SHALL decode its bytes as UTF-8 with replacement characters and SHALL always redact and write the decoded text. For the other text files, a byte array SHALL be text when it is strict UTF-8 and has no NUL byte. A byte array that is not strict UTF-8 SHALL still be redacted in its bytes, with each other byte as it is: with no NUL byte, the UTF-8 forms of the value; with a UTF-16 byte order mark, or NUL bytes only at the odd (or only at the even) offsets of the first 4 KiB, the UTF-16 forms. The `files` layer SHALL write each other byte array (a binary file) as it is. When the redaction changes nothing, the `files` layer SHALL write the input as it is. `writeFile` SHALL return the written content, so a caller hashes the file that syncs, and `redactText(text)` SHALL give the same redaction for a compare. The other files (sealed files, credential files, schema files, the push file) SHALL be written as they are. It SHALL find the plain, the base64 (standard and URL-safe, also inside a longer base64 text from 6 characters) and the URL-encoded forms of the value (`encodeURIComponent`, RFC 3986, Python `quote`, the form encoding of `URLSearchParams`; upper- and lower-case hex; `%20` or `+`). In an event, it SHALL redact the free text only: each string with no strict format and each key and value that the schema does not know. It SHALL never change the envelope or a field with a strict format (ids, HLC, slugs, hashes, enums), so a short secret cannot break an event.

#### Scenario: Plain value
- **WHEN** an agent reply has the value of the credential `stripe-test`
- **THEN** the log line has `[redacted:stripe-test]` and not the value

#### Scenario: Base64 value
- **WHEN** a hook payload has the base64 form of the value, also inside a longer base64 text
- **THEN** the log line does not have the base64 form of the value

#### Scenario: URL-encoded value
- **WHEN** a URL in a terminal snapshot has the URL-encoded form of the value, also the RFC 3986 or the `URLSearchParams` form that encodes `!'()*`
- **THEN** the log line and the snapshot have `[redacted:stripe-test]` and not the encoded form

#### Scenario: Text that is not strict UTF-8
- **WHEN** the agent adds `build.log` with the value and one Latin-1 byte, or `ps.txt` in UTF-16 with a byte order mark
- **THEN** the written file has the marker in the same encoding, no form of the value, and each other byte as it is

#### Scenario: Short secret in a formatted field
- **WHEN** the session has the secret `2026` and writes a gate answer in 2026
- **THEN** the event is written with its HLC and ids unchanged, and the answer text has `[redacted:<name>]`

#### Scenario: Proposal version and text artifact
- **WHEN** `writeFile` writes `proposal/v1.md` as a string and `artifacts/ubuntu-01/notes.txt` as UTF-8 bytes, each with the value
- **THEN** both files have `[redacted:stripe-test]` and not the value, and `writeFile` returns the redacted content

#### Scenario: Binary artifact
- **WHEN** `writeFile` writes `artifacts/ubuntu-01/image.bin` with bytes that are not UTF-8, or with a NUL byte, and the value inside
- **THEN** the file has the same bytes as the input

#### Scenario: Terminal bytes that are not UTF-8
- **WHEN** `writeFile` writes `terminal/ubuntu-01.txt` as bytes with the byte `0xE9` and the value
- **THEN** the file has a replacement character and `[redacted:stripe-test]`, and not the value

#### Scenario: Sealed file
- **WHEN** the phone outbox file or a credential file has bytes that look like the value
- **THEN** the `files` layer writes them as they are

### Requirement: Round trip of the fixture folder
Writing each document and each event of the fixture folder through the `files` layer into an empty folder, and reading it back, SHALL give the same values.

#### Scenario: Round trip
- **WHEN** the test writes the fixture folder through the API as each owner device, and reads it back
- **THEN** each document and each event is equal to the fixture value

### Requirement: Write hook
`openWorkspace` SHALL accept an `onWrite(path, content)` hook. The files layer SHALL call it after each successful document write, event append, file write, heartbeat removal, knowledge file removal and conflict operation, with the workspace-relative path and the written bytes (null for a removal).

#### Scenario: Append
- **WHEN** a device appends an event with a hook set
- **THEN** the hook gets the log path and the appended line once

#### Scenario: Knowledge file removal
- **WHEN** the knowledge store removes a knowledge file (the Undo of a learned file) with a hook set
- **THEN** the hook gets the file path and null once

### Requirement: Conflict copy names
`parseConflictCopy(path)` SHALL return the original path, the date and time and the 7-character short device id of a Syncthing conflict copy name `<stem>.sync-conflict-<YYYYMMDD>-<HHMMSS>-<ID><ext>`, and null for any other name.

#### Scenario: Knowledge file
- **WHEN** the path is `knowledge/shared/t.sync-conflict-20261123-032921-5NRSCRM.md`
- **THEN** the original is `knowledge/shared/t.md` and the short id is `5NRSCRM`

### Requirement: No synced links
The `files` layer SHALL never read or append a workspace file through a symbolic link. A log, a document or a text file that is a link, a folder or a FIFO, and a path whose folder below the workspace root is a link, SHALL give the error `ENOTREG` and SHALL change no file. A new log SHALL be made as a regular file. A write of a document SHALL replace a link with a regular file and SHALL not read the link target. The reason: the sync engine copies the link of another device as a link (final check fc1-1, fc1-3).

#### Scenario: A link in place of the own log
- **WHEN** another device syncs `tasks/<id>/log/macbook-pro.jsonl` as a link to `~/.zshenv`, and awd on macbook-pro writes an event
- **THEN** the write fails with `ENOTREG` and `~/.zshenv` does not change

#### Scenario: A linked proposal file
- **WHEN** `tasks/<id>/proposal/v1.md` is a link to a private file and awd reads the proposal for the first message of a session
- **THEN** the read fails with `ENOTREG` and no text of the private file goes into the session

