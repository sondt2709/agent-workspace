## MODIFIED Requirements

### Requirement: MCP tools
awd SHALL register the tools `thread`, `ask`, `message`, `stage`, `artifact_add`, `handoff`, `learn`, `approach`, `ready`, `task_create`, `gate`, `slot_acquire`, `slot_release`, `result` and `done`. Each implemented tool SHALL call the same service method as its `aw` command and SHALL write the same event with the agent actor of the session:
- `thread` {task?, from?, limit?, ancestors?}: at most `limit` events per page (default 50, at most 200) in merge order, each with its number `n`, and `next_from` for the next page. The events of one result SHALL have at most about 60,000 JSON characters; a page SHALL end early with `next_from` and SHALL always hold its first event. With `ancestors`, each parent thread SHALL be a page of at most `limit` events in the characters left, with its own `next_from`. Only the session task and its ancestors (the same rule as the thread route of the local API for a session caller); `readOnlyHint`.
- `ask` {task?, text, options?}: the gate `question`; `idempotentHint`.
- `message` {task?, text}: `message.agent`. `stage` {task?, text}: `task.progress`.
- `artifact_add` {task?, path}: `artifact.added` (`idempotentHint`). `handoff` {task?, path}: `handoff.written`. Both take only a file in the working folder of the session, at most 50 MB.
- `learn` {task?, title?, content?, shared?, nothing_new?}: the learning step of the task (task-learning): a learned knowledge entry with the agent as author and `task.learned`, or with `nothing_new: true` only `task.learned` `{nothing_new: true}`.
- `approach` {task?, content, decisions?}: `approach.proposed` and the gate `confirm_approach`.
- `ready` {task?, missing?}: `task.ready` and a question gate per missing item; `idempotentHint`.
- `task_create` {title, first_message, depends_on?, from_parent?, test_server?, credentials?, links?, project?}: a subtask of the session task.
- `gate` {task?, content, decisions?, options?}: the gate `custom`.
- `result` {task?, path, artifacts?}: `result.posted`, the gate `approve_result` and the stage Review.
- `done` {task?}: `task.done` after an approved result.
- `slot_acquire` {resource}: a lease `{slot, fencing_token, ttl_ms, expires_at}` or `{queued: position}` (test-slots); `idempotentHint`. `slot_release` {resource}: `slot.released`.
`task` SHALL default to the session task; another task SHALL give the tool error `refused` and write nothing. The server instructions SHALL have fewer than 4,096 characters and SHALL tell the agent to search the knowledge first and to call `learn` (or `learn` with `nothing_new: true`) before `done`.

#### Scenario: Ask through MCP
- **WHEN** the agent of AW-7 calls `ask` with `{"text": "Which limit?", "options": ["100/min", "1000/min"]}`
- **THEN** the task has an open gate `question` by `claude@<device>` with the 2 options, and the result has the gate id

#### Scenario: Token of another task
- **WHEN** the agent of AW-7 calls `message` with `{"task": "AW-8", "text": "hi"}`
- **THEN** the result is a tool error with the code `refused`, and AW-8 has no new event

#### Scenario: Slot through MCP
- **WHEN** the agent calls `slot_acquire` with `{"resource": "k3d"}` on the device that has `k3d: 1`
- **THEN** the result has `slot` 0 and a fencing token

#### Scenario: Approach through MCP
- **WHEN** the agent calls `approach` with Markdown content
- **THEN** `approach/v1.md` exists and the gate `confirm_approach` is open

#### Scenario: Nothing new through MCP
- **WHEN** the agent of AW-7 calls `learn` with `{"nothing_new": true}`
- **THEN** AW-7 has `task.learned` `{nothing_new: true}` by `claude@<device>`, and the result has `task_event`
