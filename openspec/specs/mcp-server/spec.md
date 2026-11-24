# mcp-server Specification

## Purpose
The MCP server of awd for the agents of AW sessions: MCP Streamable HTTP on 127.0.0.1, the session token, the Host and Origin guards, the tools and resources, and the error mapping (add-mcp-server).
## Requirements
### Requirement: MCP endpoint
awd SHALL serve MCP Streamable HTTP (stateless, `@modelcontextprotocol/server` 2.x) at `http://127.0.0.1:<port>/mcp` on a second fastify instance with a 4 MiB body limit. It SHALL bind to `127.0.0.1` only. It SHALL try the port 7433, then each next port up to 7442, and SHALL write the port it listens on to `~/.aw/run/mcp.port` with mode 0600. It SHALL listen and write the port file before the workspaces and the session managers start (they open windows whose `aw-launch` reads the port file), and SHALL remove the port file when it stops. A tool call before the session manager of its workspace is attached SHALL get `not_ready`. awd SHALL keep the last port in `~/.aw/run/mcp.port.last` and SHALL try it first at the next start when it is in the range. A failed write of the port file SHALL close the listener. `AW_MCP_PORT` SHALL select one port, `0` for any free port, or `off` for no MCP server.

#### Scenario: Port in use
- **WHEN** another process listens on `127.0.0.1:7433` and awd starts
- **THEN** awd listens on `127.0.0.1:7434` and `~/.aw/run/mcp.port` holds `7434`

#### Scenario: A session resumes during the awd start
- **WHEN** an agent died while awd was down, and awd resumes its session during the start
- **THEN** `aw-launch` of the resumed window finds `~/.aw/run/mcp.port`, and the agent gets `AW_MCP_URL` and `AW_MCP_TOKEN`

#### Scenario: Loopback only
- **WHEN** awd listens for MCP
- **THEN** the listen address is `127.0.0.1`, never `0.0.0.0`

### Requirement: Host and Origin guards
The MCP endpoint SHALL answer 403 to a request whose `Host` header is not `127.0.0.1`, `localhost` or `[::1]` (with any port), and to a request with an `Origin` header whose host name is not one of these. These checks SHALL run before the token check.

#### Scenario: DNS rebinding
- **WHEN** a request comes with `Host: attacker.example.com:7433`
- **THEN** awd answers 403 and runs no tool

### Requirement: Session token
awd SHALL mint one token for each session before its first window opens: 32 random bytes in base64url with the prefix `awt_`, in `~/.aw/sessions/<session>/mcp-token` with mode 0600. A resume SHALL keep the token. The token SHALL name the session, its task and this device. awd SHALL compare the hash of a presented token in constant time. awd SHALL revoke the token (remove the file and forget it) when the session record gets a state other than `running`. At start, awd SHALL load the tokens of the running sessions. awd SHALL never log the `Authorization` header. Each live token SHALL be a secret of the event redaction (`[redacted:mcp-token]`).

#### Scenario: Revoked after a stop
- **WHEN** the person stops a session, and the agent then calls a tool with its old token
- **THEN** the reply is HTTP 401, and `mcp-token` is gone from the session folder

#### Scenario: Token over an awd restart
- **WHEN** awd restarts while a session runs, and the agent calls `thread` with its token
- **THEN** the call works with no new token

### Requirement: Bad token without OAuth
A request with no `Authorization: Bearer` header, the token `none`, an unknown token or a revoked token SHALL get HTTP 401 with a JSON-RPC error body and no `WWW-Authenticate` header. awd SHALL serve no OAuth metadata (`/.well-known/*` gives 404).

#### Scenario: Bad token
- **WHEN** an MCP client connects with `Authorization: Bearer awt_wrong`
- **THEN** the reply is 401 with no `WWW-Authenticate` header

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

### Requirement: MCP resources
awd SHALL serve the read-only resources `aw://task` (the fields of the session task), `aw://knowledge` (the knowledge list of the workspace, at most 200 entries, with the full count) and `aw://knowledge/{+path}` (one knowledge file).

#### Scenario: Task fields
- **WHEN** the agent reads `aw://task`
- **THEN** the content is the JSON of the session task with its key, title, stage and assignee

### Requirement: Tool errors
A tool SHALL answer a service error as a result with `isError: true` and one text block with the error envelope `{error: {code, message, details?}, trace_id}`. A running session whose workspace has no session manager yet SHALL give the code `not_ready`. Another error SHALL be logged and SHALL give the code `internal` with no stack trace.

#### Scenario: Workspace not attached
- **WHEN** awd restarted and the workspace of a running session has no session manager yet, and the agent calls `message`
- **THEN** the result is a tool error with the code `not_ready`, not `refused`

### Requirement: Retry of a call
The MCP server SHALL keep the result of each `ask` and `artifact_add` for 60 s by the session and the arguments. A repeat while the first call runs SHALL share its result. A repeat of `ask` after it SHALL get the same gate only while that gate is open; after an answer it SHALL open a new gate. The key of `artifact_add` SHALL hold the size and the modification time of the file, so a new version of the file SHALL be a new artifact.

#### Scenario: Repeated ask
- **WHEN** the agent calls `ask` with the same text and options 2 times in 10 s
- **THEN** the task has 1 new gate, and both results have its id

#### Scenario: The same question after an answer
- **WHEN** the human answers the gate, and the agent calls `ask` with the same text and options within 60 s
- **THEN** a new gate opens, and the result has its id

#### Scenario: A new version of an artifact
- **WHEN** a test rerun rewrites `report.html`, and the agent calls `artifact_add` with the same path within 60 s
- **THEN** awd copies the new file and writes a second `artifact.added`

### Requirement: Ask with details
The MCP tool `ask` SHALL accept `details` (Markdown, at most 262,144 characters) and `options` items as a string or as `{label, description}`. The server instructions SHALL tell the agent to put the full context of a decision in `details` and never to point at an earlier message.

#### Scenario: Details and descriptions
- **WHEN** the agent calls `ask` with `text: "Which queue library?"`, `details: "## Options\n…"` and `options: [{label: "Library A", description: "Same process"}, "Library B"]`
- **THEN** the gate has the title "Which queue library?", the details as its text, the options "Library A" and "Library B", and `questions` with the description of "Library A"

