## ADDED Requirements

### Requirement: Probes and headers
The local API SHALL serve `GET /healthz`, `GET /readyz` and `GET /version`. `/readyz` SHALL answer 503 until awd opened each workspace (its first index write) or recorded why it did not open, and SHALL report the sync engine and the session host as `not_configured` in this phase. Each reply SHALL have the headers `X-AW-Version` and `X-Trace-Id`. A request `X-Trace-Id` that matches `[A-Za-z0-9_-]{1,128}` SHALL be the trace id of the reply; else awd SHALL make a new one.

#### Scenario: Trace id
- **WHEN** a client sends `X-Trace-Id: cli-test-1` to `/healthz`
- **THEN** the reply has `X-Trace-Id: cli-test-1` and an `X-AW-Version` header

#### Scenario: Bad trace id
- **WHEN** a client sends `X-Trace-Id: a b`
- **THEN** the reply has another trace id of the allowed pattern

### Requirement: Error envelope
Each error reply SHALL have the body `{error: {code, message, details?}, trace_id}`. Validation errors SHALL use 400 `invalid_input` with the field paths in `details`; unknown items 404 `not_found`; conflicts 409; refused writes 403 `refused`; a write that is in the log but whose merge failed 500 `written_not_merged`; other errors 500 `internal` with no stack trace.

#### Scenario: Missing title
- **WHEN** a client creates a task with no `title`
- **THEN** the reply is 400 with `error.code` `invalid_input`, a `details` entry for `title`, and the `trace_id` of the header

#### Scenario: Unknown route
- **WHEN** a client calls `GET /v1/nothing`
- **THEN** the reply is 404 with `error.code` `not_found`

### Requirement: Workspaces and projects
The API SHALL list and initialize workspaces (`GET/POST /v1/workspaces`) and list and add projects (`GET/POST /v1/workspaces/{ws}/projects`). `{ws}` SHALL accept the workspace id or name; a name that 2 workspaces have SHALL give 409 `ambiguous` with the ids. Workspace init SHALL run one at a time, so 2 inits of one new folder register one workspace. An init of a registered folder that did not open SHALL try the open again and give 503 `not_ready` with the error while it fails. Adding an existing project SHALL give 409.

#### Scenario: Init a new folder
- **WHEN** a client posts `{path, name: "acme"}` for an empty folder
- **THEN** the folder has a valid `tasks/workspace.yaml`, the workspace is in `config.yaml`, and `GET /v1/workspaces` lists it

#### Scenario: Register a synced folder
- **WHEN** a client posts the path of a folder that has `tasks/workspace.yaml`
- **THEN** awd registers it with the id of that file and does not change the file

### Requirement: Tasks
The API SHALL create a task with its first message (`POST .../tasks`), list tasks with filters (`project`, `stage`, `needs_you`, `archived`), show one task, edit `title`, `first_message` and `priority` (`PATCH`), assign it (`POST .../assign`) and archive it (`POST .../archive`). A task selector SHALL accept the id, the key (any letter case) or a unique id prefix of 8 or more characters. Each write reply SHALL have the written event and the merge decision (`applied`, `reason`).

#### Scenario: Create with assignee
- **WHEN** a client creates a task with `assignee: claude@macbook-pro`
- **THEN** the reply has the key `AW-1`, the stage `backlog` and the assignee, and the task is not in the "Needs you" lane

#### Scenario: Edit refused by the merge
- **WHEN** a client edits `first_message` of a task after its first session
- **THEN** the event is written, and the reply has `applied: false` and the reason `first_message_locked`

#### Scenario: Ambiguous key
- **WHEN** 2 tasks have the key `AW-3` and a client shows `AW-3`
- **THEN** the reply is 409 `ambiguous` with both ids in `details`

### Requirement: Thread
`GET .../tasks/{task}/thread` SHALL return the events of the task in merge order with `applied` and `reason`, `limit` rows (default 200, maximum 1000) after the cursor `after`, and the cursor of the next page or null. `ancestors=true` SHALL add the threads of the parent tasks first.

#### Scenario: Pages
- **WHEN** a task has 5 events and a client reads pages with `limit=2`
- **THEN** 3 pages return the 5 events once each, in merge order, and the last page has `next: null`

### Requirement: Gates
The API SHALL list gates (`GET .../gates`, default the open gates; `state=all` for each gate; `task` to filter) and answer a gate (`POST .../gates/{gate}/answer`). The answer SHALL be a `gate.answered` event in the log of this device with the current version of the gate. An answer to a gate that this device knows as resolved SHALL give 409 `gate_not_open` and write nothing.

#### Scenario: Answer a gate of another device
- **WHEN** `ubuntu-01` opened a question gate and a client on `macbook-pro` answers it
- **THEN** `macbook-pro.jsonl` of the task has a valid `gate.answered` line, and the gate in the reply has the answer with `use: pending`

### Requirement: Event stream
`GET /v1/events` SHALL upgrade to a WebSocket. awd SHALL send a `hello` message at connect, and a `changed` message with the workspace id and the changed task ids after each merge with a change.

#### Scenario: Change after a write
- **WHEN** a client listens on `/v1/events` and another client creates a task
- **THEN** the listener gets a `changed` message that has the id of the new task

### Requirement: OpenAPI file
`docs/api.yaml` SHALL be OpenAPI 3.1, generated from the zod schemas of the routes by `pnpm api:generate`. A test SHALL fail when the file differs from the generated text, and when a route is not in the file or a path of the file is not a route.

#### Scenario: Drift
- **WHEN** a route schema changes and `docs/api.yaml` is not generated again
- **THEN** `pnpm test` fails and names `docs/api.yaml`
