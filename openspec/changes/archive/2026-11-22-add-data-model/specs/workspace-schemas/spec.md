## ADDED Requirements

### Requirement: Document schemas
`@aw/schema` SHALL have a zod schema for each document of the AW folder: `workspace.yaml` (`workspace.v1`), `projects/<project>/project.yaml` (`project.v1`), `<task-id>/task.yaml` (`task.v1`), `devices/<device>/device.yaml` (`device.v1`), `devices/<device>/health.yaml` (`health.v1`), `devices/<device>/bindings.yaml` (`bindings.v1`) and `secure/test-servers.yaml` (`test-servers.v1`). Each document SHALL have the fields `kind` and `schema` (the major version). The task schema SHALL have the fields id, key, project, title, first message, stage, open gates, pause, assignee, claim, approach versions, ready state, test server, credential names, parent, subtasks, dependencies, links, branch, included log lines and archived. All field names SHALL be snake_case.

#### Scenario: Valid task snapshot
- **WHEN** the schema `task.v1` parses the task snapshot of the fixture folder
- **THEN** the parse succeeds and gives the typed fields

#### Scenario: Invalid field
- **WHEN** a task snapshot has the stage `testing` or a key `aw-7`
- **THEN** the parse fails with an issue that names the field `stage` or `key`

#### Scenario: Unknown field of a newer minor version
- **WHEN** a task snapshot has a field that the schema does not know
- **THEN** the parse succeeds and keeps the field

### Requirement: Event envelope and event types
`@aw/schema` SHALL have the event envelope `{v, id, hlc, dev, type, task?, by?, data}` and a data schema for each event type of the docs: `task.created`, `task.assigned`, `task.claimed`, `task.released`, `task.moved`, `task.rekeyed`, `task.edited`, `task.stage_changed`, `task.paused`, `task.resumed`, `task.ready`, `task.progress`, `task.done`, `task.learned`, `task.archived`, `message.human`, `message.agent`, `message.sent`, `comment.added`, `gate.opened`, `gate.answered`, `gate.resolved`, `approach.proposed`, `artifact.added`, `result.posted`, `handoff.written`, `session.started`, `session.resumed`, `session.ended`, `slot.acquired`, `slot.renewed`, `slot.released`, `slot.revoked`, `queue.reordered`, `credential.added`, `credential.imported`, `credential.removed`, `knowledge.changed`, `knowledge.undo_requested` and `device.heartbeat`. `v` SHALL be the major version of the event type. The id SHALL be a UUIDv7, `dev` a device slug, and `hlc` an HLC text.

#### Scenario: Gate answer from the docs
- **WHEN** the schema `event.v1` parses the `gate.answered` line of `docs/workflow.md` 9 with full ids
- **THEN** the parse succeeds and the data has the gate id, the version and the answer

#### Scenario: Wrong data for a type
- **WHEN** a `gate.opened` event has no gate id in `data`
- **THEN** the parse fails with an issue at the path `data.gate`

#### Scenario: Unknown event type
- **WHEN** the reader reads an event whose type is not in the registry and whose envelope is valid
- **THEN** the reader keeps the event as an unknown event and reports no error

### Requirement: Schema versions and registry
The registry SHALL map each schema name `<type>.v<major>` to its zod schema. A reader SHALL accept the current and the previous major version. It SHALL report a newer major version as a newer-version error, and an older major version as an unsupported-version error.

#### Scenario: Newer major version
- **WHEN** a reader reads a `task.yaml` with `schema: 2`
- **THEN** it reports a newer-version error with the file and the version, and does not apply the file

### Requirement: Generated JSON Schemas
`pnpm schema:generate` SHALL write one JSON Schema 2020-12 file per schema name to `packages/schema/generated/schemas/<type>.v<major>.schema.json`, from `z.toJSONSchema()`, formatted with the Prettier config of the repository. The generator SHALL have one list of targets, so that a later task can add the Kotlin classes. A test SHALL fail when a generated file is missing, extra or different from the current zod schemas.

#### Scenario: Schemas are current
- **WHEN** a contributor runs `pnpm schema:generate` on a clean tree
- **THEN** `git status --porcelain` is empty

#### Scenario: Schema change without a new generation
- **WHEN** a contributor changes a zod schema and does not run `pnpm schema:generate`
- **THEN** the drift test fails and names the stale file

#### Scenario: Independent validator
- **WHEN** the fixture test validates each fixture document and each fixture log line with `@cfworker/json-schema` against the generated JSON Schema
- **THEN** each file is valid, and each invalid sample of the schema tests is invalid

### Requirement: UUIDv7 ids
Each id of a task, an event, a session and a gate SHALL be a UUIDv7 (RFC 9562) that takes its time from the clock module.

#### Scenario: Id from the fake clock
- **WHEN** the fake clock is at `2026-11-22T14:20:01.123Z` and the code makes a new id
- **THEN** the id is a UUIDv7, and its first 48 bits are that time in milliseconds

### Requirement: Hybrid logical clock
The HLC SHALL be the text `<UTC time, ISO 8601 with ms>#<4-digit counter>`. The `hlc` field SHALL reject a date that does not exist, for example `2026-13-45T25:00:00.000Z#0000`. A device SHALL keep its HLC above each HLC that it made or read. Events SHALL sort by the HLC text, then by the device slug. The test vectors in `packages/schema/test-vectors/hlc.json` SHALL hold format, order and operation cases that the TypeScript and the Kotlin tests both run.

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
`packages/schema/fixtures/workspace/` SHALL be an AW folder with `tasks/`, `knowledge/` and `secure/`, 3 devices (`macbook-pro` local, `ubuntu-01` remote, `pixel-9` mobile), 1 project and 1 task with a log from each device. It SHALL use synthetic data only.

#### Scenario: Each fixture file is valid
- **WHEN** the fixture test reads each YAML document and each JSON Lines line of the fixture folder
- **THEN** each one is valid against its zod schema and its generated JSON Schema
