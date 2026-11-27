# workspace-schemas Specification

## Purpose
The zod schemas of the AW files in `shared/schema`: documents, events, versions, the generated JSON Schemas, the ids, the HLC and the shared fixture folder.
## Requirements
### Requirement: Document schemas
`@aw/schema` SHALL have a zod schema for each document of the AW folder: `workspace.yaml` (`workspace.v1`), `projects/<project>/project.yaml` (`project.v1`), `<task-id>/task.yaml` (`task.v1`), `devices/<device>/device.yaml` (`device.v1`), `devices/<device>/health.yaml` (`health.v1`), `devices/<device>/bindings.yaml` (`bindings.v1`) and `secure/test-servers.yaml` (`test-servers.v1`). Each document SHALL have the fields `kind` and `schema` (the major version). The task schema SHALL have the fields id, key, project, title, first message, stage, open gates, pause, assignee, claim, proposal versions, ready state, test server, credential names, parent, subtasks, dependencies, links, branch, included log lines and archived. All field names SHALL be snake_case. The reader SHALL read the field `approach` of a snapshot from before the rename as `proposal` when `proposal` is missing; a writer SHALL write only `proposal`.

#### Scenario: Valid task snapshot
- **WHEN** the schema `task.v1` parses the task snapshot of the fixture folder
- **THEN** the parse succeeds and gives the typed fields

#### Scenario: Invalid field
- **WHEN** a task snapshot has the stage `testing` or a key `aw-7`
- **THEN** the parse fails with an issue that names the field `stage` or `key`

#### Scenario: Unknown field of a newer minor version
- **WHEN** a task snapshot has a field that the schema does not know
- **THEN** the parse succeeds and keeps the field

#### Scenario: Snapshot from before the rename
- **WHEN** a task snapshot has `approach: {latest: 5, confirmed: 3}` and no `proposal`
- **THEN** the parse gives `proposal: {latest: 5, confirmed: 3}`

### Requirement: Event envelope and event types
`@aw/schema` SHALL have the event envelope `{v, id, hlc, dev, type, task?, by?, data}` and a data schema for each event type of the docs: `task.created`, `task.assigned`, `task.claimed`, `task.released`, `task.rekeyed`, `task.edited`, `task.stage_changed`, `task.paused`, `task.resumed`, `task.ready`, `task.progress`, `task.done`, `task.learned`, `task.archived`, `message.human`, `message.agent`, `message.sent`, `comment.added`, `gate.opened`, `gate.answered`, `gate.resolved`, `proposal.proposed`, `artifact.added`, `result.posted`, `handoff.written`, `session.started`, `session.resumed`, `session.ended`, `slot.acquired`, `slot.renewed`, `slot.released`, `slot.revoked`, `queue.reordered`, `credential.added`, `credential.imported`, `credential.removed`, `knowledge.changed`, `knowledge.undo_requested`, `knowledge.suggested`, `knowledge.suggestion_resolved` and `device.heartbeat`. `knowledge.changed` SHALL have an optional `suggestion` id (default `null`): the accepted suggestion that it applies. A move to another device SHALL be a human `task.assigned`; there SHALL be no `task.moved` type. The gate kinds SHALL be the gates of `docs/workflow.md` 3: `question`, `reply`, `approve_proposal`, `assign`, `approve_command`, `approve_result`, `approve_knowledge`, `approve_device`, `continue_after_limit`, `take_over_terminal`, `fix_file` and `custom`; there SHALL be no kind for an automatic move. The reader SHALL read the type `approach.proposed` as `proposal.proposed` and the gate kind `confirm_approach` as `approve_proposal` (logs from before the rename); a writer SHALL write only the new names. The map SHALL be in one module in each language, and both ports SHALL test it with the same fixture. `v` SHALL be the major version of the event type. The id SHALL be a UUIDv7, `dev` a device slug, and `hlc` an HLC text.

#### Scenario: Gate answer from the docs
- **WHEN** the schema `event.v1` parses the `gate.answered` line of `docs/workflow.md` 9 with full ids
- **THEN** the parse succeeds and the data has the gate id, the version and the answer

#### Scenario: Wrong data for a type
- **WHEN** a `gate.opened` event has no gate id in `data`
- **THEN** the parse fails with an issue at the path `data.gate`

#### Scenario: Unknown event type
- **WHEN** the reader reads an event whose type is not in the registry and whose envelope is valid
- **THEN** the reader keeps the event as an unknown event and reports no error

#### Scenario: Event from before the rename
- **WHEN** the reader reads `approach.proposed {version: 3, file: approach/v3.md}` and a `gate.opened` with the kind `confirm_approach`
- **THEN** it gives `proposal.proposed {version: 3, file: approach/v3.md}` and a gate of the kind `approve_proposal`

#### Scenario: No automatic move gate
- **WHEN** a `gate.opened` event has the kind `continue_on_device`
- **THEN** the parse fails with an issue at the path `data.kind`

#### Scenario: No move event type
- **WHEN** a log line has the type `task.moved`
- **THEN** the reader keeps it as an unknown type and does not apply it

#### Scenario: Knowledge suggestion
- **WHEN** the schema `event.v1` parses a `knowledge.suggested` event with a suggestion id, a path, the content, the hash, the base, the author, the kind and the reason `shared`
- **THEN** the parse succeeds, and a `knowledge.suggested` event with the reason `maybe` fails at `data.reasons.0`

### Requirement: Schema versions and registry
The registry SHALL map each schema name `<type>.v<major>` to its zod schema. A reader SHALL accept the current and the previous major version. It SHALL report a newer major version as a newer-version error, and an older major version as an unsupported-version error.

#### Scenario: Newer major version
- **WHEN** a reader reads a `task.yaml` with `schema: 2`
- **THEN** it reports a newer-version error with the file and the version, and does not apply the file

### Requirement: Generated JSON Schemas
`pnpm schema:generate` SHALL write one JSON Schema 2020-12 file per schema name to `contracts/schemas/<type>.v<major>.schema.json`, from `z.toJSONSchema()`, formatted with the Prettier config of the repository (`shared/config`). It SHALL also write the Kotlin data classes of each schema name to `android/shared/generated/kotlin/`, from the same JSON Schemas, and the valid and invalid schema samples of the TypeScript tests to `contracts/samples/schema-samples.json`. A check that a JSON Schema pattern cannot express (a real HLC date, a relative path with no `..`) SHALL be in the JSON Schema as the annotation `x-aw-check`, and the Kotlin classes SHALL run it. The generator SHALL have one list of targets. A test SHALL fail when a generated file is missing, extra or different from the current zod schemas.

#### Scenario: Schemas are current
- **WHEN** a contributor runs `pnpm schema:generate` on a clean tree
- **THEN** `git status --porcelain` is empty

#### Scenario: Schema change without a new generation
- **WHEN** a contributor changes a zod schema and does not run `pnpm schema:generate`
- **THEN** the drift test fails and names the stale JSON Schema and the stale Kotlin file

#### Scenario: Independent validator
- **WHEN** the fixture test validates each fixture document and each fixture log line with `@cfworker/json-schema` against the generated JSON Schema
- **THEN** each file is valid, and each invalid sample of the schema tests is invalid

#### Scenario: Refine annotation
- **WHEN** a reader opens `event.v1.schema.json`
- **THEN** each `hlc` field has `"x-aw-check": "hlc"` and each relative path field has `"x-aw-check": "relative-path"`

### Requirement: UUIDv7 ids
Each id of a task, an event, a session and a gate SHALL be a UUIDv7 (RFC 9562) that takes its time from the clock module.

#### Scenario: Id from the fake clock
- **WHEN** the fake clock is at `2026-11-22T14:20:01.123Z` and the code makes a new id
- **THEN** the id is a UUIDv7, and its first 48 bits are that time in milliseconds

### Requirement: Hybrid logical clock
The HLC SHALL be the text `<UTC time, ISO 8601 with ms>#<4-digit counter>`. The `hlc` field SHALL reject a date that does not exist, for example `2026-13-45T25:00:00.000Z#0000`. A device SHALL keep its HLC above each HLC that it made or merged. The merge SHALL not give the clock an HLC that is more than the skew bound (default 24 hours) ahead of the local time. Events SHALL sort by the HLC text, then by the device slug, then by the event id. The test vectors in `contracts/test-vectors/hlc.json` SHALL hold format, order and operation cases that the TypeScript and the Kotlin tests both run.

#### Scenario: Clock skew
- **WHEN** a device with a clock 5 minutes behind reads an event with a later HLC and then writes an answer
- **THEN** the HLC of the answer is greater than the HLC of the event

#### Scenario: Same millisecond
- **WHEN** a device makes 2 HLCs in the same millisecond
- **THEN** the second HLC has the same time and a counter 1 higher

#### Scenario: Counter overflow
- **WHEN** the counter is at 9999 and the time does not change
- **THEN** the next HLC has a time 1 ms later and the counter 0

### Requirement: Shared fixture folder
`contracts/fixtures/workspace/` SHALL be an AW folder with `tasks/`, `knowledge/` and `secure/`, 3 devices (`macbook-pro` local, `ubuntu-01` remote, `pixel-9` mobile), 1 project and 1 task with a log from each device. It SHALL use synthetic data only. `contracts/fixtures/merge/<case>/` SHALL hold merge cases: `case.json` (the description and the local time), `files/` (files added to or replacing files of the base folder) and `expected.json` (the expected view). The cases SHALL cover a gate answered twice, an offline task key collision, claim epochs, a device that goes offline, a far-future HLC and a truncated log line.

#### Scenario: Each fixture file is valid
- **WHEN** the fixture test reads each YAML document and each JSON Lines line of the fixture folder
- **THEN** each one is valid against its zod schema and its generated JSON Schema

#### Scenario: Each merge case gives its expected view
- **WHEN** the merge test builds the folder of a merge case and merges it at the local time of `case.json`
- **THEN** the view equals `expected.json`

### Requirement: Identity fields
`device.v1` SHALL have the optional fields `addresses` (a list of engine addresses, default empty) and `revoked_at` (an HLC or null, default null). The event `credential.imported` SHALL have the optional field `sealed` (the id of the phone file, or null). Both are minor changes: the generated JSON Schemas, the samples and the Kotlin classes SHALL be generated again.

#### Scenario: Old record without the new fields
- **WHEN** `device.v1` parses the device record of the fixture folder
- **THEN** the parse succeeds with `addresses: []` and `revoked_at: null`

#### Scenario: Bad revoke time
- **WHEN** a device record has `revoked_at: "yesterday"`
- **THEN** the parse fails with an issue that names `revoked_at`

### Requirement: Task loop fields
The schemas SHALL have: `vapid_public_key` (an uncompressed P-256 point, base64url with no padding, or null) in `bindings.v1`; the document `push.v1` (`kind: push`, `device`, `subscriptions` of `{computer, endpoint, p256dh, auth, vapid_public_key, distributor, updated}`); `gates` (gate ids, default empty) in `task.ready`; `decisions` (each `{question, options, recommended}`, default empty) in `gate.opened`, only to read events from before openspec proposal-and-discussion: a writer SHALL write an empty list; and the source `notice` in `message.human`. The generated JSON Schemas, samples and Kotlin classes SHALL include them.

#### Scenario: Push file
- **WHEN** a reader validates a `push.yaml` that the phone wrote
- **THEN** it passes `push.v1`, and a subscription with no `endpoint` fails

### Requirement: Session host fields
`bindings.v1` SHALL have `use_orca` ("Use Orca on this device", default `false`) and an optional `session_host` (`tmux` or `orca`) on each checkout. The data of `task.created` and `task.assigned` SHALL have an optional `session_host` (`tmux` or `orca`) with no default, so an event without it parses as before.

#### Scenario: Old bindings
- **WHEN** the schema `bindings.v1` parses a bindings file with no `use_orca`
- **THEN** the parse gives `use_orca: false`

#### Scenario: Wrong host
- **WHEN** a `task.assigned` event has `session_host: screen`
- **THEN** the parse fails with an issue at the path `data.session_host`

### Requirement: Project setup fields
`project.yaml` (projectV1) SHALL have `archived` (boolean, default false) and `main_repo` (a link text or null, default null). A reader of an older file SHALL get the defaults. The generated JSON Schema and the Kotlin classes SHALL have the 2 fields.

#### Scenario: Older file
- **WHEN** a reader parses a `project.yaml` with no `archived` and no `main_repo`
- **THEN** the value has `archived: false` and `main_repo: null`

### Requirement: Session option fields
`project.yaml` SHALL have `permission_mode` (`default` | `accept_edits` | `skip`, default `default`). `task.created` and `task.assigned` SHALL have an optional `session_options {permission_mode: <mode> | null, agent_teams: boolean, work_in: "worktree" | "checkout" | "folder", folder: <absolute path> | null, switch_branch: boolean}`; `folder` SHALL be set only with `work_in: "folder"`. `switch_branch` SHALL default to `true`, and SHALL count only with `work_in: "checkout"`. `session.started` SHALL have optional `permission_mode`, `agent_teams` and `work_in`. The event `session.stop_requested {session}` SHALL exist. `pnpm schema:generate` SHALL write the JSON Schemas, the samples and the Kotlin classes.

#### Scenario: Folder with a relative path
- **WHEN** `session_options` has `work_in: "folder"` and `folder: "work/api"`
- **THEN** the schema refuses it at `data.session_options.folder`

#### Scenario: Old event
- **WHEN** a `task.created` has no `session_options`
- **THEN** it is valid

#### Scenario: Old session options
- **WHEN** a `task.created` has `session_options` with no `switch_branch`
- **THEN** the parsed value has `switch_branch: true`

### Requirement: Questions of a gate
`gate.opened` SHALL have the optional field `questions` (default `[]`): at most 10 items `{question, header, multi_select, options}`, where `question` has 1 to 2,000 characters, `header` is null or at most 100 characters, `multi_select` is a boolean (default false), and `options` has at most 20 items `{label, description}` (`label` 1 to 500 characters, `description` at most 2,000 characters, default ""). The event writer SHALL redact each string of `questions`. The generated JSON Schema, samples and Kotlin classes SHALL have the field.

#### Scenario: Old event
- **WHEN** a reader parses a `gate.opened` of an older version with no `questions`
- **THEN** the event is valid and `questions` is `[]`

#### Scenario: Redacted description
- **WHEN** the description of an option has the value of the session credential `db-password`
- **THEN** the written line has `[redacted:db-password]` in its place

### Requirement: Agent message source and session link fields
`message.agent` SHALL have an optional `source` (`turn` | `tool`). `message.sent` SHALL have an optional `kind` (`nudge`). `session.started` SHALL have an optional `name` (a string or null) and an optional `terminal {window: string | null, pane: string | null}`. `session.resumed` SHALL have an optional `terminal` and optional `pids`. An event without these fields SHALL stay valid. `pnpm schema:generate` SHALL write the JSON Schemas, the samples and the Kotlin classes.

#### Scenario: Old agent message
- **WHEN** the schema parses `message.agent` `{text: "Done.", session: null}`
- **THEN** the event is valid and has no source

#### Scenario: Turn message
- **WHEN** the schema parses `message.agent` with the source `turn`
- **THEN** the event is valid, and the source `other` is not valid

### Requirement: Checkout state in health
`health.v1` SHALL have an optional `checkouts` list of `{project, has_commit}`: one entry for each checkout of the device in its bindings. `has_commit` SHALL be true only when the checkout is a git repository whose `HEAD` names a commit. A health file of an older awd with no `checkouts` SHALL stay valid.

#### Scenario: Checkout with no commit
- **WHEN** the checkout of `billing-api` on macbook-pro is a git repository with no commit
- **THEN** `tasks/devices/macbook-pro/health.yaml` has `checkouts: [{project: billing-api, has_commit: false}]`

### Requirement: Kind of a comment
`comment.added` SHALL have an optional `kind`. The only value SHALL be `start_failed`: the comment of awd when the session of the task did not start on its device. A comment with no `kind` SHALL stay valid, and a reader SHALL show the text of each comment as before.

#### Scenario: Start failure comment
- **WHEN** awd writes `comment.added {text: "The session did not start on macbook-pro: …", kind: "start_failed"}`
- **THEN** the event is valid

#### Scenario: Unknown kind
- **WHEN** a `comment.added` has `kind: "note"`
- **THEN** the schema refuses it at `data.kind`

