# android-shared-model Specification

## Purpose
The Kotlin shared module of the Android app (`android/shared`): the generated classes, the log and document readers, the HLC, the merge and the Room index. It gives the same view as the TypeScript core for the shared fixtures.
## Requirements
### Requirement: Kotlin shared module
The Gradle project `android` SHALL have the Kotlin Multiplatform module `shared` with the targets `jvm()` and Android, and the source sets `commonMain`, `jvmCommonMain` (a parent of the JVM and Android source sets) and `commonTest`. It SHALL use the JDK 21 toolchain, a version catalog `gradle/libs.versions.toml` with exact versions, and no `google-services.json`.

#### Scenario: JVM tests with no Android SDK
- **WHEN** a contributor runs `./gradlew :shared:jvmTest` in `android` on a computer with no Android SDK
- **THEN** Gradle compiles and runs the JVM tests

#### Scenario: Android compile
- **WHEN** a contributor runs the Android compile task of `shared` on a computer with the Android SDK
- **THEN** the task passes with `compileSdk` 37 and `minSdk` 29

### Requirement: Generated Kotlin classes
`shared` SHALL compile the Kotlin classes of `android/shared/generated/kotlin/` in `commonMain`. A decode into a generated class SHALL apply the defaults of the schema, refuse a value that breaks a type, an enum, a pattern, a limit or an `x-aw-check`, and ignore unknown keys. An enum SHALL be a `String` with a check of the allowed values, not an enum class. A field that zod makes optional and not nullable SHALL refuse a JSON null, and a Kotlin writer SHALL leave out its key when it has no value. A number with an integer value (for example `2.0` or `1e3`) SHALL be valid for an integer field, as for zod.

#### Scenario: Fixture files are valid
- **WHEN** the Kotlin reader decodes each YAML document and each log line of `contracts/fixtures/workspace/`
- **THEN** each one is valid

#### Scenario: Impossible HLC date
- **WHEN** an event has the HLC `2026-13-45T25:00:00.000Z#0000`
- **THEN** the decode fails, although the text matches the HLC pattern

### Requirement: Kotlin log and document readers
The Kotlin log reader SHALL give the same events, unknown events and bad lines as `parseLogText` with a log scope: a line that is not JSON, fails its schema, has another `dev` than the file name, has another task than its folder or has a type of another log kind is a bad line; an event of an unknown type with a valid envelope is kept as unknown. The message of a JSON syntax error SHALL be the V8 text with the column. A line nested deeper than 64 levels SHALL be a bad line with the message of the TypeScript reader, and the scan SHALL use no recursion. A line with only the white space of JavaScript `trim()` SHALL be skipped. The document reader SHALL give the value with defaults and with the unknown keys, and SHALL refuse a document whose identity field differs from its folder. Each error of a document read (also an error that is not a schema error, for example a number too large) SHALL be a `bad_document` issue, and the merge SHALL go on.

#### Scenario: Cut line
- **WHEN** a log line is cut in a string and the next line is valid
- **THEN** the cut line is a `bad_line` with the message `Unterminated string in JSON at position <n> (column <n+1>)`, and the next line merges

#### Scenario: Deep line
- **WHEN** a log line has 100,000 open `[`, or a valid event has an unknown key nested 65 levels deep
- **THEN** each line is a `bad_line` (`Unexpected end of JSON input`, `JSON nesting is deeper than 64 levels`), and the update goes on

#### Scenario: Unknown event type
- **WHEN** a log line has the type `task.future_thing` and a valid envelope
- **THEN** the event is kept as unknown, and the merge reports `unknown_type`

### Requirement: Kotlin HLC
The Kotlin HLC SHALL give the result of each vector of `contracts/test-vectors/hlc.json`: the format cases, the invalid texts, the order and each operation sequence, also the counter overflow.

#### Scenario: Vectors
- **WHEN** the JVM tests run the HLC vectors
- **THEN** each vector gives its expected value

### Requirement: Kotlin merge equals the TypeScript merge
The Kotlin `MergeEngine` SHALL give the same `{view, presence}` as the TypeScript engine for each case in `contracts/fixtures/merge/`, for each read order of the log files. It SHALL port the order, the ownership and claim rules, the gate rules, the key collisions, the priority, the workspace log, presence, the 24 h HLC bound, the last valid document and `toTaskDocument`.

#### Scenario: Merge cases
- **WHEN** the JVM tests merge each case at its `now`
- **THEN** the parsed JSON of `{view, presence}` equals the parsed `expected.json`

#### Scenario: Rule cases
- **WHEN** the JVM tests merge the cases `task-rules` and `workspace-rules`
- **THEN** each rule that the other cases do not use (rekey, first message lock, assignment switch, proposal file, unknown session, leases, credential names) gives the TypeScript result

#### Scenario: Read order
- **WHEN** the JVM tests merge each case with the reversed order and 39 seeded shuffles of the log files
- **THEN** each result equals `expected.json`

#### Scenario: Snapshot
- **WHEN** `toTaskDocument` runs on the task AW-7 of the base case
- **THEN** the result equals the fixture `task.yaml` with its defaults

### Requirement: Kotlin incremental update
`MergeEngine.update()` SHALL read only the new bytes of a log that grew, and SHALL read all files again when a log became shorter, was replaced or was removed. Calls SHALL run one at a time. A failed update SHALL forget each read, also when the failure is an `Error` and not an `Exception`, so that the next update equals a full merge. The merge sources SHALL be regular files only: a folder or a symbolic link with the name of a log or a document SHALL NOT be a source. One log or document that cannot be read (an `Exception` of its read) SHALL NOT fail the update: it SHALL keep its last read events or value and give the issue `read_error`, and the next read that works SHALL remove the issue.

#### Scenario: Random appends
- **WHEN** the property test appends 60 rounds of random events with the seeds 20261122, 7 and 4242 and calls `update()` after each round
- **THEN** each incremental view equals a full merge of the same files, and no round needs a full read

#### Scenario: Truncated log
- **WHEN** a log file becomes shorter between 2 updates
- **THEN** the update has the notice `truncated` and reads all files again

#### Scenario: Folder with the name of a log
- **WHEN** a peer syncs a folder `tasks/<task>/log/pixel-9.jsonl/` or a symbolic link at the path of a log
- **THEN** the merge does not read it, and each update works

#### Scenario: Log that cannot be read
- **WHEN** the read of one log fails with an I/O error
- **THEN** the update works, the other logs merge, the view keeps the events of that log and has the issue `read_error`

### Requirement: Room index for the phone
`shared` SHALL write the merged view to a Room 3 database (`androidx.room3`) and SHALL have these queries: the tasks in the "Needs you" lane, the tasks of a project and a stage, and the events of a task in merge order after an HLC. The JVM target SHALL use the same database and DAO with the bundled SQLite driver. An incremental write SHALL give the same rows as a rebuild.

#### Scenario: Needs you
- **WHEN** the index holds the base case
- **THEN** the "Needs you" query returns each task with `needs_you_lane` true, and no other task

#### Scenario: Thread by HLC
- **WHEN** a caller asks for the events of AW-7 after an HLC with a limit
- **THEN** the query returns the next events in HLC, device and id order

#### Scenario: Incremental index
- **WHEN** random rounds update the index incrementally
- **THEN** the rows equal the rows of a rebuilt index

### Requirement: Kotlin event writer
`shared` SHALL have one event writer for the phone's own logs. It SHALL build the envelope (a new UUIDv7 id, the next HLC of the phone clock, `dev` = the phone slug, `by` = `human@<phone>`), encode it with the snake_case JSON of the generated classes, validate the line again with the log reader, and append it with a newline. It SHALL refuse, and write nothing, when the path is not a log of the phone, when the event type does not belong in the log kind of the path, when the event names another task than the folder, or when the line is longer than 64 KiB. When the file does not end with a newline (a cut line), it SHALL first write a newline. The file writer of the phone SHALL never write through a symbolic link: it SHALL refuse, and write nothing, when a folder between the workspace root and the file is a symbolic link or not a folder, or when the log is a symbolic link or not a regular file. It SHALL create a missing log as a new regular file, and open the log with no link follow.

#### Scenario: Gate answer line
- **WHEN** the phone `pixel-9` writes `gate.answered` to `tasks/<task>/log/pixel-9.jsonl`
- **THEN** the file has one more line, the log reader reads it as a valid event of `pixel-9` with `by: human@pixel-9`, and its HLC is greater than each HLC that the clock saw

#### Scenario: Log of another device
- **WHEN** the phone writes an event to `tasks/<task>/log/ubuntu-01.jsonl`
- **THEN** the writer refuses and the file does not change

#### Scenario: Cut last line
- **WHEN** the last line of the log has no newline
- **THEN** the writer writes a newline first, so the cut line stays a separate bad line and the new line is valid

#### Scenario: Log that is a symbolic link
- **WHEN** a peer replaces `tasks/<task>/log/pixel-9.jsonl` with a symbolic link to another file, and the phone writes an event
- **THEN** the writer refuses with an error and the other file does not change

### Requirement: Index queries of the phone screens
`WorkspaceIndex` SHALL also return all tasks, the projects, the devices by priority, the presence of each device, the issues and the value of one document by path.

#### Scenario: Devices by priority
- **WHEN** the index holds the base case
- **THEN** the devices query returns each device of the view in priority order, and the presence query one row per device

### Requirement: Kotlin revoke rule
The Kotlin merge SHALL apply the revoke rule of the TypeScript merge: an event of a revoked device whose HLC sorts after `revoked_at` is not applied, with the reason `device_revoked`, and a change of a device record folds each task and the workspace log again. When the phone knows the master public key, the Kotlin merge SHALL also check each device record as the TypeScript merge does with `verifyDeviceRecord`: a record whose raw YAML value has no valid signature keeps the last valid record (issue reason `bad_signature`), a valid record that drops a kept revoke or has a lower `seq` keeps the last valid record (`old_sequence`), and a kept revoke stays when its file is removed (`revoke_removed`). Without the master public key the merge SHALL NOT check signatures.

#### Scenario: Same view for device-revoked
- **WHEN** the Kotlin JVM test merges `contracts/fixtures/merge/device-revoked` in 40 read orders
- **THEN** each view equals `expected.json` of the TypeScript engine

#### Scenario: Record with a bad signature
- **WHEN** the merge has a verifier and a device record changes one field after the signature
- **THEN** the last valid record stays and the issue reason is `bad_signature`

#### Scenario: Revoke dropped
- **WHEN** the merge has a verifier, a revoked record is kept, and a validly signed record of the same device without the revoke arrives
- **THEN** the revoke stays and the issue reason is `old_sequence`

#### Scenario: Revoke file removed
- **WHEN** the merge has a verifier and the file of a kept revoke record is removed
- **THEN** the device stays revoked and the issue reason is `revoke_removed`

