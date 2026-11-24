## MODIFIED Requirements

### Requirement: Event envelope and event types
`@aw/schema` SHALL have the event envelope `{v, id, hlc, dev, type, task?, by?, data}` and a data schema for each event type of the docs: `task.created`, `task.assigned`, `task.claimed`, `task.released`, `task.rekeyed`, `task.edited`, `task.stage_changed`, `task.paused`, `task.resumed`, `task.ready`, `task.progress`, `task.done`, `task.learned`, `task.archived`, `message.human`, `message.agent`, `message.sent`, `comment.added`, `gate.opened`, `gate.answered`, `gate.resolved`, `approach.proposed`, `artifact.added`, `result.posted`, `handoff.written`, `session.started`, `session.resumed`, `session.ended`, `slot.acquired`, `slot.renewed`, `slot.released`, `slot.revoked`, `queue.reordered`, `credential.added`, `credential.imported`, `credential.removed`, `knowledge.changed`, `knowledge.undo_requested`, `knowledge.suggested`, `knowledge.suggestion_resolved` and `device.heartbeat`. `knowledge.changed` SHALL have an optional `suggestion` id (default `null`): the accepted suggestion that it applies. A move to another device SHALL be a human `task.assigned`; there SHALL be no `task.moved` type. The gate kinds SHALL be the gates of `docs/workflow.md` 3: `question`, `reply`, `confirm_approach`, `assign`, `approve_command`, `approve_result`, `approve_knowledge`, `approve_device`, `continue_after_limit`, `take_over_terminal`, `fix_file` and `custom`; there SHALL be no kind for an automatic move. `v` SHALL be the major version of the event type. The id SHALL be a UUIDv7, `dev` a device slug, and `hlc` an HLC text.

#### Scenario: Gate answer from the docs
- **WHEN** the schema `event.v1` parses the `gate.answered` line of `docs/workflow.md` 9 with full ids
- **THEN** the parse succeeds and the data has the gate id, the version and the answer

#### Scenario: Wrong data for a type
- **WHEN** a `gate.opened` event has no gate id in `data`
- **THEN** the parse fails with an issue at the path `data.gate`

#### Scenario: Unknown event type
- **WHEN** the reader reads an event whose type is not in the registry and whose envelope is valid
- **THEN** the reader keeps the event as an unknown event and reports no error

#### Scenario: No automatic move gate
- **WHEN** a `gate.opened` event has the kind `continue_on_device`
- **THEN** the parse fails with an issue at the path `data.kind`

#### Scenario: No move event type
- **WHEN** a log line has the type `task.moved`
- **THEN** the reader keeps it as an unknown type and does not apply it

#### Scenario: Knowledge suggestion
- **WHEN** the schema `event.v1` parses a `knowledge.suggested` event with a suggestion id, a path, the content, the hash, the base, the author, the kind and the reason `shared`
- **THEN** the parse succeeds, and a `knowledge.suggested` event with the reason `maybe` fails at `data.reasons.0`
