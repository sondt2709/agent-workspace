## ADDED Requirements

### Requirement: Caller of a request
awd SHALL find the caller of each local API request:
- With `Authorization: Bearer <token>` of a running session, the caller SHALL be that session (the agent `<agent>@<this device>`). An unknown or revoked token SHALL give 401 `unauthorized`.
- With no token, the caller SHALL be the person, except when the peer process of the socket connection, or one of its parent processes, is the process of a running session of this device. Then the caller SHALL be that session. awd SHALL run this peer check only for a person route or a knowledge write, and only while a session runs. On macOS it SHALL list only the sockets of the processes of the session trees. When the check cannot run, awd SHALL log a warning and treat the caller as the person; a check that takes 1 s or more SHALL be logged as a warning.
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
Only the person SHALL call these routes; a session caller SHALL get 403 `refused` with a message that tells the agent to ask the human: `POST /v1/workspaces`, `POST /v1/workspaces/{ws}/projects`, `POST /v1/workspaces/{ws}/tasks`, `PATCH /v1/workspaces/{ws}/tasks/{task}`, `POST /v1/workspaces/{ws}/tasks/{task}/assign`, `POST /v1/workspaces/{ws}/tasks/{task}/archive`, `POST /v1/workspaces/{ws}/tasks/{task}/messages`, `POST /v1/workspaces/{ws}/gates/{gate}/answer`, `POST /v1/sessions/{session}/stop`, `POST /v1/sync/now`, `POST /v1/sync/pause`, `POST /v1/sync/resume`, `POST /v1/sync/peers`, `DELETE /v1/sync/peers/{device}`, `POST /v1/workspaces/{ws}/knowledge/suggestions/{suggestion}/accept` and `.../reject`.

#### Scenario: Agent assigns its task
- **WHEN** a session caller sends `POST /v1/workspaces/-/tasks/AW-7/assign`
- **THEN** awd answers 403 `refused` and writes no `task.assigned`

#### Scenario: Agent stops a session
- **WHEN** a session caller sends `POST /v1/sessions/<session>/stop`
- **THEN** awd answers 403 `refused`, and the session keeps running

## MODIFIED Requirements

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
