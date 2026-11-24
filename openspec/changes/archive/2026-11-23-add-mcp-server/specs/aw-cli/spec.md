## MODIFIED Requirements

### Requirement: Client package
`@aw/client` SHALL call the local API with axios on the Unix socket, send a trace id, check the `X-AW-Version` header, map the error envelope to one typed error with the HTTP status, the code and the trace id, and give the event stream on `ws+unix:`. It SHALL parse each reply body and each stream message with the zod schema of the API (`@aw/client/schemas`, the same schemas that awd uses) and throw `AwProtocolError` when a reply does not match. `ready()` SHALL return the `/readyz` body on 200 and on 503. With the option `token`, each request SHALL have the header `Authorization: Bearer <token>`. The client SHALL never send the header `X-AW-Session`.

#### Scenario: Error envelope
- **WHEN** the API answers 404 with the envelope
- **THEN** the client throws `AwApiError` with `status` 404, `code` `not_found` and the trace id

#### Scenario: No awd
- **WHEN** the socket file does not exist
- **THEN** the client throws `AwUnreachableError` with the socket path

#### Scenario: Session token
- **WHEN** the client has the option `token` and calls `ask`
- **THEN** the request has `Authorization: Bearer <token>`

### Requirement: Agent commands
The agent commands SHALL take the session from `AW_SESSION` and SHALL exit with 2 and "Run this command inside an AW session" when it is not set. Inside a session the CLI SHALL send the session token of `AW_MCP_TOKEN` with each request; awd SHALL take the identity of the agent only from that token. `aw ask <task> <text> [--options "a|b"]` SHALL open a gate `question` and return at once with exit code 0 and a text that tells the agent to end its turn. `aw message <task> <text>` SHALL write `message.agent`, `aw stage <task> <text>` SHALL write `task.progress`, `aw artifact add <task> <file>` SHALL copy the file into `artifacts/<device>/` and write `artifact.added` with its size and sha256, and `aw handoff <task> --file <path>` SHALL write the handoff file and `handoff.written`. The file of `aw artifact add` and `aw handoff` SHALL be in the working folder of the session after each symlink and at most 50 MB; else awd SHALL refuse it (exit 1) and copy nothing. awd SHALL refuse (exit 1) a task that is not the task of the session, and an agent command with no token or with the token of another session. When `AW_SESSION` is set, the CLI SHALL refuse (exit 1) each command of a person: `aw gate answer`, `aw task assign|edit|archive`, `aw kb accept|reject`, `aw session stop`, `aw service install|uninstall`, `aw workspace init` and `aw project add`. awd SHALL also refuse each person route for a session caller (the caller rule of the local API), so a command of a person exits with 1 also when the agent removes `AW_SESSION` from the environment.

#### Scenario: Ask returns at once
- **WHEN** the agent runs `aw ask AW-7 "Which limit?" --options "100/min|1000/min"` in its session
- **THEN** `aw` exits with 0 in less than 2 s, prints the gate id and "End your turn now", and the gate is open with the 2 options

#### Scenario: Agent answers its own gate
- **WHEN** the session of AW-7 runs `aw gate answer <its gate> "1000/min"`
- **THEN** `aw` exits with 1, and the gate has no answer

#### Scenario: Agent removes AW_SESSION
- **WHEN** the session of AW-7 runs `env -u AW_SESSION aw gate answer <its gate> "1000/min"`
- **THEN** `aw` exits with 1, and the gate has no answer

#### Scenario: Other task
- **WHEN** the session of AW-7 runs `aw message AW-8 "hi"`
- **THEN** `aw` exits with 1 and nothing is written

#### Scenario: File outside the working folder
- **WHEN** the session of AW-7 runs `aw artifact add AW-7 ~/.ssh/id_ed25519`, or names a symlink in its worktree that points to that file
- **THEN** `aw` exits with 1, and no file is copied into the task folder

### Requirement: Knowledge commands
The `aw` CLI SHALL have the commands `aw kb list [--shared | --project <slug>]`, `aw kb show <path> [--version <hash>]`, `aw kb write <path> (--file <path|-> ) [--base <hash>]`, `aw kb history <path>`, `aw kb undo <change>`, `aw kb search <terms…>`, `aw kb suggestions [--all]`, `aw kb accept <suggestion> [--force] [--comment]`, `aw kb reject <suggestion> [--comment]`, `aw kb digest [--date <YYYY-MM-DD>]`, `aw kb context <task> [--path <file>…]`, and `aw learn <task> --file <path|-> --title <title> [--shared] [--author <agent@device>]`. Each command SHALL call the knowledge routes of the local API and SHALL follow the output modes and exit codes of the CLI. A change that became a suggestion SHALL print "Waits for approval" with the reasons and exit 0. When `AW_MCP_TOKEN` is set, each request SHALL have the header `Authorization: Bearer <token>`, so awd acts as the agent of the session; a refusal SHALL exit 1.

#### Scenario: Undo from the CLI
- **WHEN** a person runs `aw kb undo <change id>`
- **THEN** the file has the base content of the change, and `aw` prints the new change id

#### Scenario: Learned item of an agent in shared knowledge
- **WHEN** a person runs `aw learn AW-7 --file item.md --title "Reset the DB" --shared --author claude@macbook-pro`
- **THEN** `aw` prints "Waits for approval" with the reason `shared`, and no knowledge file is written

#### Scenario: Agent session accepts its own suggestion
- **WHEN** the session of AW-7 runs `aw kb accept <suggestion>`, or `aw kb write shared/team.md --file f.md`
- **THEN** `aw` exits with 1, the suggestion is still pending, and `shared/team.md` is not written
