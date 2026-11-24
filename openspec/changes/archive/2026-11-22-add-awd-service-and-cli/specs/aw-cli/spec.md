## ADDED Requirements

### Requirement: Client package
`@aw/client` SHALL call the local API with axios on the Unix socket, send a trace id, check the `X-AW-Version` header, map the error envelope to one typed error with the HTTP status, the code and the trace id, and give the event stream on `ws+unix:`. It SHALL parse each reply body and each stream message with the zod schema of the API (`@aw/client/schemas`, the same schemas that awd uses) and throw `AwProtocolError` when a reply does not match. `ready()` SHALL return the `/readyz` body on 200 and on 503.

#### Scenario: Error envelope
- **WHEN** the API answers 404 with the envelope
- **THEN** the client throws `AwApiError` with `status` 404, `code` `not_found` and the trace id

#### Scenario: No awd
- **WHEN** the socket file does not exist
- **THEN** the client throws `AwUnreachableError` with the socket path

### Requirement: Commands
The `aw` CLI SHALL have the commands `status`, `workspace init|list`, `project add|list`, `task create|list|show|edit|assign|archive`, `thread <task>`, `gate list|answer` and `service install|uninstall|status`. It SHALL export `run(argv, io)` that returns the exit code and writes only to the `io` object. The command tree SHALL accept new top-level commands of later tasks without a change to the existing commands.

#### Scenario: Create from a file
- **WHEN** a person runs `aw task create --project billing-api --title "Fix the flaky test" --first-message-file m.md`
- **THEN** the task has the text of `m.md` as is as its first message, and `aw` prints the key

### Requirement: Output modes
Each command SHALL write its result to stdout: text by default, one JSON document with `--json`. Messages and errors SHALL go to stderr. With `--json`, stdout SHALL hold only the JSON document.

#### Scenario: JSON list
- **WHEN** a person runs `aw task list --json`
- **THEN** stdout parses as one JSON array of tasks, and stderr has no task data

### Requirement: Exit codes
`aw` SHALL exit with 0 on success, 1 when awd refused the action, a gate is open, a write is saved but not merged, or the merge made a gate answer a comment (`gate_unknown`, `old_version` or `late_answer`: the gate still waits), 2 for invalid input (also an unknown task, gate or workspace), and 3 when awd is not reachable.

#### Scenario: Unreachable
- **WHEN** no awd runs and a person runs `aw status`
- **THEN** `aw` exits with 3 and stderr names the socket path and `aw service install`

#### Scenario: Invalid input
- **WHEN** a person runs `aw task assign AW-1 nobody`
- **THEN** `aw` exits with 2

#### Scenario: Refused
- **WHEN** a person answers a resolved gate
- **THEN** `aw` exits with 1 and stderr has the reason

#### Scenario: Old gate version
- **WHEN** a person answers version 1 of a gate that is at version 2
- **THEN** `aw` exits with 1, stderr has `old_version`, and the gate is still open
