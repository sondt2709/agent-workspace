## MODIFIED Requirements

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

### Requirement: Task loop fields
The schemas SHALL have: `vapid_public_key` (an uncompressed P-256 point, base64url with no padding, or null) in `bindings.v1`; the document `push.v1` (`kind: push`, `device`, `subscriptions` of `{computer, endpoint, p256dh, auth, vapid_public_key, distributor, updated}`); `gates` (gate ids, default empty) in `task.ready`; `decisions` (each `{question, options, recommended}`, default empty) in `gate.opened`, only to read events from before openspec proposal-and-discussion: a writer SHALL write an empty list; and the source `notice` in `message.human`. The generated JSON Schemas, samples and Kotlin classes SHALL include them.

#### Scenario: Push file
- **WHEN** a reader validates a `push.yaml` that the phone wrote
- **THEN** it passes `push.v1`, and a subscription with no `endpoint` fails
