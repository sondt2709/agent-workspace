# local-api Specification

## Purpose
The local API of awd: HTTP and WebSocket on `~/.aw/run/awd.sock`, the routes, the headers, the error envelope, the event stream and the generated `contracts/openapi.yaml`.
## Requirements
### Requirement: Probes and headers
The local API SHALL serve `GET /healthz`, `GET /readyz` and `GET /version`. `/readyz` SHALL answer 503 until awd opened each workspace (its first index write) or recorded why it did not open. It SHALL report the sync engine state (`not_installed`, `starting`, `running`, `restarting`, `stopped` or `failed`), the session host as `ok` when awd found a tmux binary, else `failed`, and the session agent as `ok` when the agent binary answers `--version`, else `failed`. The sync engine state, the session host and the session agent SHALL NOT change the readiness. Each reply SHALL have the headers `X-AW-Version` and `X-Trace-Id`. A request `X-Trace-Id` that matches `[A-Za-z0-9_-]{1,128}` SHALL be the trace id of the reply; else awd SHALL make a new one.

#### Scenario: Trace id
- **WHEN** a client sends `X-Trace-Id: cli-test-1` to `/healthz`
- **THEN** the reply has `X-Trace-Id: cli-test-1` and an `X-AW-Version` header

#### Scenario: Bad trace id
- **WHEN** a client sends `X-Trace-Id: a b`
- **THEN** the reply has another trace id of the allowed pattern

#### Scenario: Engine state
- **WHEN** the engine runs and each workspace is open
- **THEN** `/readyz` answers 200 with `sync_engine: "running"`

#### Scenario: Session host
- **WHEN** awd found a tmux binary
- **THEN** `/readyz` reports `session_host: ok`

#### Scenario: Agent missing
- **WHEN** awd found tmux and `claude --version` fails
- **THEN** `/readyz` reports `session_host: ok` and `session_agent: failed`

### Requirement: Error envelope
Each error reply SHALL have the body `{error: {code, message, details?}, trace_id}`. Validation errors SHALL use 400 `invalid_input` with the field paths in `details`; a missing, unknown or revoked session token 401 `unauthorized`; unknown items 404 `not_found`; conflicts 409; refused writes 403 `refused`; a write that is in the log but whose merge failed 500 `written_not_merged`; other errors 500 `internal` with no stack trace.

#### Scenario: Missing title
- **WHEN** a client creates a task with no `title`
- **THEN** the reply is 400 with `error.code` `invalid_input`, a `details` entry for `title`, and the `trace_id` of the header

#### Scenario: Unknown route
- **WHEN** a client calls `GET /v1/nothing`
- **THEN** the reply is 404 with `error.code` `not_found`

#### Scenario: Revoked token
- **WHEN** a client sends the token of a stopped session
- **THEN** the reply is 401 with `error.code` `unauthorized`

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
`GET .../tasks/{task}/thread` SHALL return the events of the task in merge order with `applied` and `reason`, `limit` rows (default 200, maximum 1000) after the cursor `after` or from the offset `from`, and the cursor of the next page or null. `newest=true` SHALL return the newest `limit` events, and `before=<cursor>` the `limit` events just before the cursor; each page SHALL stay in merge order. `types=<type>,<type>` SHALL keep only the events of these types. The reply SHALL have `prev`: the cursor of the first event of the page when older events exist, else null. `ancestors=true` SHALL add the threads of the parent tasks first, read with the same values.

#### Scenario: Pages
- **WHEN** a task has 5 events and a client reads pages with `limit=2`
- **THEN** 3 pages return the 5 events once each, in merge order, and the last page has `next: null`

#### Scenario: Newest page
- **WHEN** a task has 1,100 events and a client reads `newest=true&limit=500`
- **THEN** the reply has events 601 to 1,100 in merge order, `next: null`, and `prev` is the cursor of event 601

#### Scenario: Older page
- **WHEN** the client then reads `before=<prev>&limit=500`
- **THEN** the reply has events 101 to 600, and `prev` is the cursor of event 101

#### Scenario: Types
- **WHEN** a client reads `types=gate.opened,result.posted`
- **THEN** the reply has only `gate.opened` and `result.posted` events

### Requirement: Gates
The API SHALL list gates (`GET .../gates`, default the open gates; `state=all` for each gate; `task` to filter) and answer a gate (`POST .../gates/{gate}/answer`). The answer SHALL be a `gate.answered` event in the log of this device with the current version of the gate. An answer to a gate that this device knows as resolved SHALL give 409 `gate_not_open` and write nothing. Its details SHALL have the gate id, the answer and `answer_event` of the resolution (null when AW closed the gate with no answer of a person).

#### Scenario: Answer a gate of another device
- **WHEN** `ubuntu-01` opened a question gate and a client on `macbook-pro` answers it
- **THEN** `macbook-pro.jsonl` of the task has a valid `gate.answered` line, and the gate in the reply has the answer with `use: pending`

#### Scenario: Answer to a gate that AW closed
- **WHEN** the owner device closed a gate with "Session ended", and a client answers it
- **THEN** the reply is 409 `gate_not_open` with the details `answer: "Session ended"` and `answer_event: null`

### Requirement: Event stream
`GET /v1/events` SHALL upgrade to a WebSocket. awd SHALL send a `hello` message at connect, and a `changed` message with the workspace id and the changed task ids after each merge with a change.

#### Scenario: Change after a write
- **WHEN** a client listens on `/v1/events` and another client creates a task
- **THEN** the listener gets a `changed` message that has the id of the new task

### Requirement: OpenAPI file
`contracts/openapi.yaml` SHALL be OpenAPI 3.1, generated from the zod schemas of the routes by `pnpm api:generate`. A test SHALL fail when the file differs from the generated text, and when a route is not in the file or a path of the file is not a route.

#### Scenario: Drift
- **WHEN** a route schema changes and `contracts/openapi.yaml` is not generated again
- **THEN** `pnpm test` fails and names `contracts/openapi.yaml`

#### Scenario: Generator output folder
- **WHEN** a contributor runs `pnpm api:generate` on a clean tree
- **THEN** the command writes `contracts/openapi.yaml`, and `git status --porcelain` is empty

### Requirement: Knowledge routes
The local API SHALL serve the knowledge store of a workspace under `/v1/workspaces/{ws}/knowledge` with the tag `knowledge`, and each route SHALL call one method of the awd knowledge service:
- `GET` (list, with `scope` and `project`), `GET /file?path&version` (read), `PUT /file` (write: `path`, `content`, optional `base`), `GET /history?path`, `POST /changes/{change}/undo`, `GET /search?q&scope&project&limit`.
- `POST /learn` (`task`, `title`, `content`, optional `shared`, `author`, `from_person`), `GET /suggestions?state`, `POST /suggestions/{suggestion}/accept` (`force`, `comment`), `POST /suggestions/{suggestion}/reject` (`comment`).
- `GET /digest?date`, `POST /context` (`task`, `paths`, `load_limit`; a read with a body, so a list of paths has one form).

A write reply SHALL be `{change, suggestion, unchanged}`. A base that differs from the current file SHALL give 409 `conflict` with the current hash in `details`. A path outside the knowledge scopes SHALL give 403 `refused`. A version that is not in the history store SHALL give 404 `not_found`. For the person (the caller rule), the API SHALL write as `human@<this device>`, and `learn` SHALL accept an `author` only of the form `<agent>@<this device>`, else 400 `invalid_input`. For a session caller of this workspace, the API SHALL act as the agent of the session: accept, reject and a write to `shared/` or to a rule SHALL answer 403 `refused`; a project write and an Undo SHALL have the agent as author; `learn` SHALL have the agent as author and SHALL answer 403 `refused` for another author or another task. A session of another workspace SHALL give 403 `refused`. A running session whose workspace has no session manager yet SHALL give 503 `not_ready`.

#### Scenario: Write with an old base
- **WHEN** a client sends `PUT /v1/workspaces/-/knowledge/file` with a `base` that is not the hash of the current file
- **THEN** awd answers 409 `conflict` with the current hash and writes nothing

#### Scenario: Agent author of another device
- **WHEN** a client on `macbook-pro` sends `POST /knowledge/learn` with the author `claude@ubuntu-01`
- **THEN** awd answers 400 `invalid_input`

#### Scenario: Session caller accepts a suggestion
- **WHEN** a client sends `POST /knowledge/suggestions/<id>/accept` with the token of a running session
- **THEN** awd answers 403 `refused`, and the suggestion is still pending

#### Scenario: Context of a task
- **WHEN** a client sends `POST /v1/workspaces/-/knowledge/context` with the task `AW-7`
- **THEN** the reply has the context text of at most 9,000 characters, the selected files with their mode, the budget and the warnings

### Requirement: Sync routes
The local API SHALL serve `GET /v1/sync` (the engine state, this device's sync id and the status of each peer with its text), `POST /v1/sync/now` with an optional `timeout_ms` (the Sync now result and the status), `POST /v1/sync/pause`, `POST /v1/sync/resume`, `POST /v1/sync/peers` (`{device_id, addresses, name?, role?}`) and `DELETE /v1/sync/peers/{device}`. Without a running engine, each route except `GET /v1/sync` SHALL answer 503 `not_ready` with the engine state. `POST /v1/sync/peers` shares each folder, `secure` too, with a device id that has no signed device record: it is a test path only (pairing adds the peers from the signed records), the peer stays in memory until the next awd start, and awd SHALL answer it with 403 `refused` unless `AW_SYNC_TEST_PEERS` is `on`.

#### Scenario: Sync now
- **WHEN** a client sends `POST /v1/sync/now` and each peer is synced
- **THEN** the reply has `pending: []` and the time of the result

#### Scenario: Test peers off
- **WHEN** a client sends `POST /v1/sync/peers` and `AW_SYNC_TEST_PEERS` is not `on`
- **THEN** the reply is 403 `refused`, it names the setting, and the engine gets no new device

#### Scenario: No engine
- **WHEN** a client sends `POST /v1/sync/now` and the engine is not installed
- **THEN** the reply is 503 `not_ready` and names the state `not_installed`

### Requirement: Session routes
The local API SHALL serve `GET /v1/sessions`, `POST /v1/sessions/{session}/stop` (a person route), the agent routes `POST /v1/sessions/{session}/ask|message|stage|artifacts|handoff`, and `POST /v1/sessions/{session}/permission` for the PermissionRequest hook. Each route SHALL call the session manager. An agent route and the permission route SHALL need the token of the session in the path: no token or the token of another session SHALL answer 403 `refused`. A route of an unknown or stopped session SHALL answer 403 `refused`. A route of a running session whose workspace has no session manager yet (awd starts) SHALL answer 503 `not_ready`.

#### Scenario: Unknown session
- **WHEN** a client posts to `/v1/sessions/<unknown uuid>/ask`
- **THEN** the reply is 403 with code `refused`

#### Scenario: No token
- **WHEN** a client posts to `/v1/sessions/<running session>/ask` with no token
- **THEN** the reply is 403 with code `refused`, and no gate opens

#### Scenario: Session of a workspace that is not attached yet
- **WHEN** awd starts and the hook of a running session posts to `/v1/sessions/<session>/permission` before the session manager of its workspace runs
- **THEN** the reply is 503 with code `not_ready`, and the hook tries again

### Requirement: Message to a session
`POST /v1/workspaces/{ws}/tasks/{task}/messages {text}` SHALL write `message.sent {id, text, to_session}` to the log of this device, with `to_session` = the running session of the task, as `human@<device>`. The reply SHALL have the event and the merge decision. A task with no running session SHALL give 409 `conflict` and write nothing. An empty text, or a text of only white space, SHALL give 400 `invalid_input`. It is a person route: a session caller SHALL get 403 `refused` (see "Person routes"); an agent sends its messages with `POST /v1/sessions/{session}/message`.

#### Scenario: Message to the running session
- **WHEN** the task `AW-3` has a running session `s1` and a client sends the text "Use the staging database"
- **THEN** the log of this device has a `message.sent` line with that text and `to_session: s1`, and the session device delivers it as `[AW message <id> from <device>] Use the staging database`

#### Scenario: No session
- **WHEN** the task has no running session
- **THEN** the reply is 409 `conflict` and the log has no new line

#### Scenario: Session caller
- **WHEN** a request to `POST /v1/workspaces/-/tasks/AW-3/messages` has the token of a running session, or comes from a process of its tree with no token
- **THEN** awd answers 403 `refused` and the log has no new line

### Requirement: Caller of a request
awd SHALL find the caller of each local API request:
- With `Authorization: Bearer <token>` of a running session, the caller SHALL be that session (the agent `<agent>@<this device>`). An unknown or revoked token SHALL give 401 `unauthorized`.
- With no token, the caller SHALL be the person, except when the peer process of the socket connection, or one of its parent processes, is the process of a running session of this device. Then the caller SHALL be that session. When the peer process, or one of its parent processes, is a git command that awd runs (a push, a commit, a worktree add, a checkout or a switch, whose hooks run as its children), awd SHALL refuse a person route or a knowledge write with 403 `refused`: the agent can write such a hook (final check fc1-6). awd SHALL run this peer check only for a person route or a knowledge write, and only while a session or a git command of awd runs. On macOS it SHALL list only the sockets of the processes of the session trees and the git trees. When the check cannot run, awd SHALL log a warning and treat the caller as the person; a check that takes 1 s or more SHALL be logged as a warning.
- A route SHALL declare its access: `person`, `agent` (the session in the path, with its token), `caller` (any caller; the route acts as it) or `read` (any caller; the route changes nothing). A route with no access SHALL be `read` for GET and HEAD and `person` for each other method (fail-closed). `POST .../knowledge/context` is `read`.
- A session caller of `GET .../tasks/{task}/thread` SHALL read only its task and its parent tasks; another task SHALL give 403 `refused`.

#### Scenario: Session token
- **WHEN** a request to `POST /v1/workspaces/-/gates/<gate>/answer` has the token of a running session
- **THEN** awd answers 403 `refused`, and the gate has no answer

#### Scenario: Session process without a token
- **WHEN** a child process of a running session calls `POST /v1/workspaces/-/gates/<gate>/answer` with no token
- **THEN** awd answers 403 `refused`, and the gate has no answer

#### Scenario: A write route with no access
- **WHEN** a new write route declares no access, and a session caller calls it
- **THEN** awd answers 403 `refused`

#### Scenario: Thread of another task
- **WHEN** the session of AW-7 calls `GET /v1/workspaces/-/tasks/AW-8/thread` with its token
- **THEN** awd answers 403 `refused`

#### Scenario: The person
- **WHEN** a process that is not in the process tree of a session calls `POST /v1/workspaces/-/gates/<gate>/answer` with no token
- **THEN** awd writes `gate.answered` by `human@<this device>`

### Requirement: Person routes
Only the person SHALL call these routes; a session caller SHALL get 403 `refused` with a message that tells the agent to ask the human: `POST /v1/workspaces`, `POST /v1/workspaces/{ws}/projects`, `POST /v1/workspaces/{ws}/tasks`, `PATCH /v1/workspaces/{ws}/tasks/{task}`, `POST /v1/workspaces/{ws}/tasks/{task}/assign`, `POST /v1/workspaces/{ws}/tasks/{task}/archive`, `POST /v1/workspaces/{ws}/tasks/{task}/messages`, `POST /v1/workspaces/{ws}/gates/{gate}/answer`, `POST /v1/sessions/{session}/stop`, `POST /v1/sync/now`, `POST /v1/sync/pause`, `POST /v1/sync/resume`, `POST /v1/sync/peers`, `DELETE /v1/sync/peers/{device}`, `POST /v1/workspaces/{ws}/knowledge/suggestions/{suggestion}/accept`, `.../reject`, and each route of "Identity, device, pairing and credential routes" (also the reads).

#### Scenario: Agent assigns its task
- **WHEN** a session caller sends `POST /v1/workspaces/-/tasks/AW-7/assign`
- **THEN** awd answers 403 `refused` and writes no `task.assigned`

#### Scenario: Agent stops a session
- **WHEN** a session caller sends `POST /v1/sessions/<session>/stop`
- **THEN** awd answers 403 `refused`, and the session keeps running

### Requirement: Identity, device, pairing and credential routes
The local API SHALL serve `GET /v1/identity`, `GET /v1/identity/phrase`, `GET /v1/workspaces/{ws}/devices`, `POST /v1/workspaces/{ws}/devices/{device}/revoke`, `POST /v1/workspaces/{ws}/pairing`, `GET /v1/pairing/{id}`, `POST /v1/pairing/{id}/approve {check_code}`, `DELETE /v1/pairing/{id}`, `POST /v1/pairing/join {code, path?, slug?, name?}`, `GET|POST /v1/workspaces/{ws}/credentials`, `DELETE /v1/workspaces/{ws}/credentials/{name}` and `GET /v1/workspaces/{ws}/credentials/{name}/value`. A credential value SHALL be in a request body or in the reply of the value route only, never in a path, a query or a log line. `@aw/client/identity` SHALL have the zod schemas and a typed client. Each of these routes SHALL be a person route, also the reads: a session caller SHALL get 403 `refused`. An agent gets a credential only through the session start, never through the value route.

#### Scenario: Session caller reads a credential
- **WHEN** a request to `GET /v1/workspaces/-/credentials/stripe-test/value` or `GET /v1/identity/phrase` has the token of a running session, or comes from a process of its tree with no token
- **THEN** awd answers 403 `refused`, and the reply has no value and no phrase

#### Scenario: No master key
- **WHEN** a device without the master key sends `POST /v1/workspaces/-/pairing`
- **THEN** the reply is 403 `refused`

#### Scenario: Credential value in the log
- **WHEN** a client adds a credential and reads its value
- **THEN** no awd log line has the value

### Requirement: Task loop session routes
The local API SHALL have the agent routes `POST /v1/sessions/{session}/proposal` (with `/approach` as an alias that calls the same handler), `/ready`, `/tasks`, `/gate`, `/result` and `/done` (access `agent`). Each SHALL act only on the session task (`/tasks` creates a subtask of it) and SHALL call the same method as the MCP tool.

#### Scenario: Another task
- **WHEN** the session of AW-7 posts `/v1/sessions/<session>/done` with the task AW-8
- **THEN** the reply is 403 `refused` and nothing is written

### Requirement: Session host of a new session
`POST .../tasks` and `POST .../tasks/{task}/assign` SHALL accept an optional `session_host` (`tmux` or `orca`) and write it in `task.created` or `task.assigned`. An other value SHALL give 400 `invalid`.

#### Scenario: Assign with Orca
- **WHEN** a client assigns a task to `claude@macbook-pro` with `session_host: orca`
- **THEN** the `task.assigned` event has `session_host: orca`

### Requirement: Presence route
`GET /v1/workspaces/{ws}/presence` SHALL return the presence view of the merge: for each device `online`, `last_heartbeat_hlc`, `received_at` and `offline_since`, and the offline tasks. A workspace that is not open SHALL give 503 `not_ready`. It SHALL be a person route.

#### Scenario: Device offline
- **WHEN** no heartbeat of `ubuntu-01` arrived for 90 s
- **THEN** the reply has `ubuntu-01` with `online: false` and an `offline_since` time

### Requirement: Task folder routes
`GET /v1/workspaces/{ws}/tasks/{task}/files` SHALL list the entries of `tasks/<task id>/` (path from the workspace root, `kind` `dir` or `file`, `size`, `modified`), sorted by path, without temporary files (`*.aw-tmp`, `.syncthing.*.tmp`, `~syncthing~*.tmp`) and without an entry that goes away during the listing, at most 5,000 entries with `truncated: true` when more exist. `GET .../files/content?path=` SHALL return the text of one file of that folder, or `text: null` with a reason for a file over 1 MiB or with bytes that are not UTF-8. A path outside the task folder, with `..`, or through a symbolic link that leaves the folder, and a task folder (or `tasks`) that is a symbolic link, SHALL give 400 `invalid_input`; an unknown task SHALL give 404 `not_found`. Both SHALL be person routes.

#### Scenario: Task folder
- **WHEN** a client lists the files of a task with `task.yaml`, `log/macbook-pro.jsonl` and `proposal/v1.md`
- **THEN** the reply has the 3 files and the 2 folders `log` and `proposal`

#### Scenario: Path outside the folder
- **WHEN** a client reads `tasks/<task id>/../workspace.yaml`
- **THEN** the reply is 400 `invalid_input` and no file is read

### Requirement: Session hosts route
`GET /v1/workspaces/{ws}/session-hosts` SHALL return this device and, for each computer with bindings (no phone, no revoked device), `may_run`, `use_orca`, the `session_host` of each checkout by project (no checkout path), and `orca`. `orca` SHALL be the Orca state of this device (`available`, `version`, `reason`; `available` false when the Orca host is missing, the sessions are off or not ready, or AW does not cover the agent version) and null for another device. It SHALL be a person route.

#### Scenario: Another computer
- **WHEN** the bindings of `ubuntu-01` have `use_orca: true` and a checkout of `billing-api` with `session_host: orca`
- **THEN** the entry of `ubuntu-01` has `use_orca: true`, the checkout `billing-api` with `orca`, no path, and `orca: null`

#### Scenario: Session caller
- **WHEN** the agent of a session calls `GET /v1/workspaces/{ws}/session-hosts`
- **THEN** the reply is 403 `refused`

### Requirement: Restore a document
`POST /v1/workspaces/{ws}/documents/restore {path}` SHALL write the last valid value that the merge kept for a document with a `bad_document` issue, through the files layer, and merge. A path with no such issue SHALL give 409 `conflict`; a document with no valid version on this device SHALL give 404 `not_found`; a write that the ownership rules refuse SHALL give 403 `refused`. It SHALL be a person route.

#### Scenario: Restore after a bad edit
- **WHEN** a person broke `projects/billing-api/project.yaml` by hand and the merge kept its last valid value
- **THEN** the route writes that value, and the issue goes away after the merge

### Requirement: Slot session routes
The local API SHALL have the agent routes `POST /v1/sessions/{session}/slots/acquire` and `POST /v1/sessions/{session}/slots/release` with the body `{resource}` (access `agent`). They SHALL call the slot service of the session workspace for the session task.

#### Scenario: Release with no lease
- **WHEN** a session posts `/slots/release` for a resource that it does not hold
- **THEN** the reply is 404 `not_found` and nothing is written

### Requirement: Queues route
`GET /v1/workspaces/{ws}/queues` SHALL be a person route. It SHALL answer `{device, agents, unassigned}`: for each agent with a queued task, `{agent, device, max_working, working, tasks: [{task, key, title, position, text, cause: {code, text}}]}` by the queue rule, and for each active task with no assignee `{task, key, title, created_by, by_agent}`. `by_agent` SHALL be true when the `by` of `task.created` is set and does not start with `human@`.

#### Scenario: Queued tasks
- **WHEN** 2 sessions of `claude@macbook-pro` work and AW-3 and AW-4 wait
- **THEN** the reply lists AW-3 with position 1, the text "Queued · 1st for claude@macbook-pro" and the cause `max_working` "2 sessions working"

#### Scenario: Session caller
- **WHEN** a session caller sends `GET /v1/workspaces/-/queues`
- **THEN** awd answers 403 `refused`

#### Scenario: Agent subtask
- **WHEN** an agent created AW-5 with no assignee
- **THEN** `unassigned` lists AW-5 with `created_by: claude@macbook-pro` and `by_agent: true`

### Requirement: Terminal route
`GET /v1/workspaces/{ws}/tasks/{task}/terminal` SHALL be a person route. It SHALL answer `{task, session, snapshot, note, open, sign_in}`. `session` SHALL be the session of the merged task view (`{session, device, host, state, local}`) or null. `snapshot` SHALL be the newest snapshot file of the task by `captured_at` (`{device, session, host, captured_at, text}`) or null. `note` SHALL say "AW does not read the screen of an Orca session. Open the Orca worktree aw-<task> on <device>." for an Orca session, "No terminal snapshot yet." with no snapshot, else null. `open` (the terminal of the session) and `sign_in` (`claude auth login` on the session device) SHALL each be null with no session, else a target: `{kind: "terminal", device, local: true, argv, command}` on this device, `{kind: "orca", device, local: true, orca, worktree, command}` for a local Orca session, and `{kind: "copy", device, local: false, command}` for another device. The tmux target SHALL be `-L <socket> attach -t aw:aw-<task>`; the command for another device SHALL start with `ssh -t <device>`, and its socket SHALL come from the newest snapshot of that device (default `aw`).

#### Scenario: Snapshot of another device
- **WHEN** the person asks for the terminal of AW-12 on macbook-pro, and the session runs on ubuntu-01
- **THEN** the reply has the snapshot of ubuntu-01 with its time, and `open.command` is `ssh -t ubuntu-01 tmux -L aw attach -t aw:aw-<task>`

#### Scenario: Local tmux session
- **WHEN** the session runs on this device in tmux
- **THEN** `open` has `local: true` and the argv `<tmux> -L <socket> attach -t aw:aw-<task>`, and `sign_in` has the argv `<claude> auth login`

#### Scenario: Orca session
- **WHEN** the session runs in Orca
- **THEN** `snapshot` is the newest older snapshot or null, and `note` says that AW does not read the screen of an Orca session

#### Scenario: Session caller
- **WHEN** a session caller sends `GET /v1/workspaces/-/tasks/AW-12/terminal`
- **THEN** awd answers 403 `refused`

