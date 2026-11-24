## ADDED Requirements

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
The `files` layer SHALL append one event as one line, after the schema check and the redaction. A line SHALL be at most 64 KiB. The writer SHALL never rewrite a line. When the file does not end with a newline, the writer SHALL first add a newline. The reader SHALL skip a half-written last line and report it, report each other bad line with its line number, and reject an event whose `dev` is not the device of the file name. The writer SHALL refuse, and the reader SHALL report, an event whose `task` is not the task of the folder, and a known event type that does not belong in that log: a heartbeat file holds `device.heartbeat` only, the knowledge log `knowledge.*` only, the workspace log `slot.*`, `queue.*` and `credential.*` only, and a task log the other types.

#### Scenario: Half-written last line
- **WHEN** a log ends with a part of a line and no newline
- **THEN** the reader returns the complete events, skips the part and reports it as the partial tail

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
The `files` layer SHALL refuse a write to a file that this device does not own, by the ownership table of `docs/architecture.md` 4.3.1 and the folder layout of `docs/phase-1.md` 3.1. It SHALL also refuse a path outside the layout, a path with `..`, a `*.aw-tmp` or `*.sync-conflict-*` name in any part of the path, the `secure` folder on a mobile device, a device record without the master key, and a second write of an approach version.

#### Scenario: Log of another device
- **WHEN** `macbook-pro` writes `tasks/<task-id>/log/ubuntu-01.jsonl`
- **THEN** the guard refuses the write with a write-refused error that names the path and the rule

#### Scenario: Snapshot of a task that another device owns
- **WHEN** `macbook-pro` writes `task.yaml` of a task whose owner device is `ubuntu-01`
- **THEN** the guard refuses the write

#### Scenario: Shared file
- **WHEN** any device writes `tasks/projects/billing-api/project.yaml`
- **THEN** the guard allows the write

### Requirement: Redaction
Before the `files` layer writes an event line or a terminal snapshot (`terminal/<device>.txt`), it SHALL replace each credential value of the session with `[redacted:<name>]`. It SHALL find the plain, the base64 (standard and URL-safe, also inside a longer base64 text from 6 characters) and the URL-encoded forms of the value (`encodeURIComponent`, RFC 3986, Python `quote`, the form encoding of `URLSearchParams`; upper- and lower-case hex; `%20` or `+`). In an event, it SHALL redact the free text only: each string with no strict format and each key and value that the schema does not know. It SHALL never change the envelope or a field with a strict format (ids, HLC, slugs, hashes, enums), so a short secret cannot break an event.

#### Scenario: Plain value
- **WHEN** an agent reply has the value of the credential `stripe-test`
- **THEN** the log line has `[redacted:stripe-test]` and not the value

#### Scenario: Base64 value
- **WHEN** a hook payload has the base64 form of the value, also inside a longer base64 text
- **THEN** the log line does not have the base64 form of the value

#### Scenario: URL-encoded value
- **WHEN** a URL in a terminal snapshot has the URL-encoded form of the value, also the RFC 3986 or the `URLSearchParams` form that encodes `!'()*`
- **THEN** the log line and the snapshot have `[redacted:stripe-test]` and not the encoded form

#### Scenario: Short secret in a formatted field
- **WHEN** the session has the secret `2026` and writes a gate answer in 2026
- **THEN** the event is written with its HLC and ids unchanged, and the answer text has `[redacted:<name>]`

### Requirement: Round trip of the fixture folder
Writing each document and each event of the fixture folder through the `files` layer into an empty folder, and reading it back, SHALL give the same values.

#### Scenario: Round trip
- **WHEN** the test writes the fixture folder through the API as each owner device, and reads it back
- **THEN** each document and each event is equal to the fixture value
