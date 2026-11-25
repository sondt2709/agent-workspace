# aw-cli Specification

## Purpose
The `aw` CLI in `daemon/` and the `@aw/client` package: the commands, the output modes and the exit codes. The CLI calls the local API on the awd socket.
## Requirements
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

### Requirement: Commands
The `aw` CLI SHALL have the commands `status`, `workspace init|list`, `project add|list`, `task create|list|show|edit|assign|archive`, `thread <task> [--ancestors] [--from <n>]`, `gate list|answer`, `session list|stop`, `service install|uninstall|status`, `sync now|status|pause|resume`, `sync peer add <device-id> <address...> [--name] [--role]|remove <device>`, and the agent commands `ask`, `message`, `stage`, `artifact add` and `handoff`. It SHALL export `run(argv, io)` that returns the exit code and writes only to the `io` object. The command tree SHALL accept new top-level commands of later tasks without a change to the existing commands.

#### Scenario: Create from a file
- **WHEN** a person runs `aw task create --project billing-api --title "Fix the flaky test" --first-message-file m.md`
- **THEN** the task has the text of `m.md` as is as its first message, and `aw` prints the key

#### Scenario: Sync now with an offline peer
- **WHEN** a person runs `aw sync now` and the peer ubuntu-01 is offline with 3 changes not synced
- **THEN** `aw` prints "3 changes not synced to ubuntu-01 (offline)" and exits with 1

#### Scenario: Sync now synced
- **WHEN** a person runs `aw sync now` and each peer is synced
- **THEN** `aw` prints "Synced" with the time for each peer and exits with 0

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

### Requirement: Knowledge commands
The `aw` CLI SHALL have the commands `aw kb list [--shared | --project <slug>]`, `aw kb show <path> [--version <hash>]`, `aw kb write <path> (--file <path|-> ) [--base <hash>]`, `aw kb history <path>`, `aw kb undo <change>`, `aw kb search <terms…>`, `aw kb suggestions [--all]`, `aw kb accept <suggestion> [--force] [--comment]`, `aw kb reject <suggestion> [--comment]`, `aw kb digest [--date <YYYY-MM-DD>]`, `aw kb context <task> [--path <file>…]`, `aw learn <task> --file <path|-> --title <title> [--shared] [--author <agent@device>]` and `aw learn <task> --nothing-new [--author <agent@device>]`. `--nothing-new` with `--file`, `--title` or `--shared`, or `aw learn` with neither `--nothing-new` nor both `--file` and `--title`, SHALL exit 2 before a call. Each command SHALL call the knowledge routes of the local API and SHALL follow the output modes and exit codes of the CLI. A change that became a suggestion SHALL print "Waits for approval" with the reasons and exit 0. A `task.learned` that the merge did not apply SHALL print the reason and exit 1. When `AW_MCP_TOKEN` is set, each request SHALL have the header `Authorization: Bearer <token>`, so awd acts as the agent of the session; a refusal SHALL exit 1.

#### Scenario: Undo from the CLI
- **WHEN** a person runs `aw kb undo <change id>`
- **THEN** the file has the base content of the change, and `aw` prints the new change id

#### Scenario: Learned item of an agent in shared knowledge
- **WHEN** a person runs `aw learn AW-7 --file item.md --title "Reset the DB" --shared --author claude@macbook-pro`
- **THEN** `aw` prints "Waits for approval" with the reason `shared`, and no knowledge file is written

#### Scenario: Agent session accepts its own suggestion
- **WHEN** the session of AW-7 runs `aw kb accept <suggestion>`, or `aw kb write shared/team.md --file f.md`
- **THEN** `aw` exits with 1, the suggestion is still pending, and `shared/team.md` is not written

#### Scenario: Agent session writes a rule in another case, or another project
- **WHEN** the session of AW-7 (project `billing-api`) runs `aw kb write projects/billing-api/Rules/x.md --file f.md` or `aw kb write projects/other-app/notes.md --file f.md`
- **THEN** `aw` exits with 1, and no file is written

#### Scenario: Nothing new
- **WHEN** the session of AW-7 runs `aw learn AW-7 --nothing-new`
- **THEN** `aw` prints "Recorded: nothing new learned on AW-7" and exits 0, and AW-7 has `task.learned` `{nothing_new: true}`

#### Scenario: Nothing new with a file
- **WHEN** a person runs `aw learn AW-7 --nothing-new --file item.md`
- **THEN** `aw` exits with 2 and calls no route

### Requirement: Agent commands
The agent commands SHALL take the session from `AW_SESSION` and SHALL exit with 2 and "Run this command inside an AW session" when it is not set. Inside a session the CLI SHALL send the session token of `AW_MCP_TOKEN` with each request; awd SHALL take the identity of the agent only from that token. `aw ask <task> <text> [--options "a|b"]` SHALL open a gate `question` and return at once with exit code 0 and a text that tells the agent to end its turn. `aw message <task> <text>` SHALL write `message.agent`, `aw stage <task> <text>` SHALL write `task.progress`, `aw artifact add <task> <file>` SHALL copy the file into `artifacts/<device>/` and write `artifact.added` with its size and sha256, and `aw handoff <task> --file <path>` SHALL write the handoff file and `handoff.written`. The file of `aw artifact add` and `aw handoff` SHALL be in the working folder of the session after each symlink and at most 50 MB; else awd SHALL refuse it (exit 1) and copy nothing. When `AW_SESSION` is set, the CLI SHALL read a `--file` or `--first-message-file` path (of `aw proposal`, `aw gate open`, `aw kb write`, `aw learn` and `aw task create`) only when it is in the working folder of the session after each symlink; else it SHALL exit 1, read nothing and call no write route. `-` (stdin) stays allowed. awd SHALL refuse (exit 1) a task that is not the task of the session, and an agent command with no token or with the token of another session. When `AW_SESSION` is set, the CLI SHALL refuse (exit 1) each command of a person: `aw gate answer`, `aw task assign|edit|archive`, `aw kb accept|reject`, `aw session stop`, `aw service install|uninstall`, `aw workspace init`, `aw project add`, `aw identity show|phrase`, `aw device list|add|approve|cancel|revoke`, `aw pair` and `aw credential add|list|remove|get`. awd SHALL also refuse each person route for a session caller (the caller rule of the local API), so a command of a person exits with 1 also when the agent removes `AW_SESSION` from the environment.

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

### Requirement: Thread from an offset
`aw thread <task> --from <n>` SHALL print the events of the thread from the event number `n` (0 is the first), so the agent can read a long thread in pages.

#### Scenario: Offset
- **WHEN** a thread has 5 events and the agent runs `aw thread AW-7 --from 3 --limit 10`
- **THEN** `aw` prints the events 4 and 5 only

### Requirement: Identity, device, pair and credential commands
`aw` SHALL have `identity show|phrase`, `device list|add [--qr]|approve <pairing> <check-code...>|revoke <device>`, `pair <code|-> [--path] [--slug] [--name]` and `credential add <name> [--file <path|->]|list|remove <name>|get <name>`. Each SHALL call the local API and use the exit codes of the CLI. No command SHALL take a credential value or a key as an argument. `aw device add` SHALL print the code, the expiry, the hint `aw pair -` (the code from stdin) and, after a request, the check code and the approve command. `aw device approve` SHALL accept the check code as printed (`482 913`, 2 arguments) or as one argument.

#### Scenario: Value from stdin
- **WHEN** `printf 'sk_test_1\n' | aw credential add stripe-test` runs
- **THEN** it exits with 0, `aw credential get stripe-test` prints `sk_test_1`, and the process arguments never had the value

### Requirement: Task loop agent commands
Inside a session (AW_SESSION set), the CLI SHALL have `aw proposal <task> --file <path>` (with `aw approach` as an alias), `aw ready <task> [--missing <item>]...`, `aw result <task> --file <path> [--artifact <path>]...`, `aw done <task>`, `aw gate open <task> --file <path> [--options <a|b>]` and `aw task create --title ... (--first-message <text> | --first-message-file <path>) [--parent <task>] [--from-parent] [--depends-on <task>]... [--test-server] [--credential]... [--link]...`, which call the session routes. Each of these SHALL be in the allow rules of the session (`Bash(aw <command> *)`). Outside a session, `aw task create` SHALL keep the person route.

#### Scenario: Proposal from the CLI
- **WHEN** the agent runs `aw proposal AW-7 --file proposal.md`
- **THEN** the CLI prints the gate id and "End your turn now", with exit code 0

#### Scenario: Old command name
- **WHEN** the agent runs `aw approach AW-7 --file proposal.md`
- **THEN** the result is the same as with `aw proposal`

### Requirement: Session host option
`aw task create` and `aw task assign` SHALL accept `--host tmux|orca` and send it as `session_host`. An other value SHALL give exit code 2. Inside a session (AW_SESSION set), `aw task create --host` SHALL exit with code 1 and send nothing: an agent does not choose the session host of a subtask.

#### Scenario: Create in Orca
- **WHEN** a person runs `aw task create --project billing-api --title T --first-message x --assignee claude@macbook-pro --host orca`
- **THEN** the `task.created` event has `session_host: orca`

#### Scenario: Host of a subtask
- **WHEN** an agent runs `aw task create --title Sub --first-message x --host orca` in its session
- **THEN** the CLI exits with code 1, the error says "Leave out --host", and no task is created

### Requirement: Slot commands
Inside a session, the CLI SHALL have `aw slot acquire <resource>` (prints the slot, the fencing token and the expiry, or the queue position with exit code 1) and `aw slot release <resource>`, which call the session routes. Both SHALL be in the allow rules of the session (`Bash(aw slot acquire *)`, `Bash(aw slot release *)`).

#### Scenario: Acquire from the CLI
- **WHEN** the agent runs `aw slot acquire k3d` on the device that has a free `k3d` slot
- **THEN** the CLI prints the slot and the fencing token, with exit code 0

### Requirement: Thread text of the learning step
`aw thread` SHALL print the text "Nothing new learned" for `task.learned` with `nothing_new: true`, "Learned: <path>" for a learned item, and "Learned: <path> (waits for approval)" for an item with a suggestion.

#### Scenario: Thread of a task with nothing new
- **WHEN** AW-7 has `task.learned` `{nothing_new: true}` by `claude@macbook-pro`
- **THEN** `aw thread AW-7` has the line `claude@macbook-pro task.learned` and the text "Nothing new learned"

### Requirement: Offline pause in the task commands
`aw task list` and `aw task show` SHALL read the presence and the devices and show the pause of each task, also the pause of the presence: the list adds "paused: <device name> offline" or "paused: <device name> was revoked" to the stage, and the show prints a `Paused:` line with the next step. `--json` SHALL print the tasks with the merged `paused` field and, for a revoked device, the "Needs you" reason `paused`.

#### Scenario: Task of an offline device
- **WHEN** the presence lists AW-21 with the device `macbook-pro` named "MacBook Pro"
- **THEN** `aw task show AW-21` prints the line `Paused:    MacBook Pro offline.` with the next step, and `aw task list` shows `(paused: MacBook Pro offline)` after the stage

#### Scenario: Task of a revoked device
- **WHEN** the presence lists AW-1 with the cause `device_revoked` and the device `ubuntu-01`
- **THEN** `aw task show AW-1` prints `Paused:    ubuntu-01 was revoked. Change the assignee to continue on another device.`

### Requirement: Queue command
`aw queue` SHALL print, for each agent with queued tasks, a line with the agent and its working sessions, then one line per task with the position, the key, the title and the cause, then the tasks that need an assignee with their creator. With no queued task it SHALL print "No task waits for a session.". `--json` SHALL print the route reply. The CLI SHALL refuse `aw queue` in a session.

#### Scenario: Two queued tasks
- **WHEN** a person runs `aw queue` while AW-3 and AW-4 wait for `claude@macbook-pro`
- **THEN** the output has "1st  AW-3" and "2nd  AW-4" with "2 sessions working"

### Requirement: Terminal command
`aw terminal <task>` SHALL print the device and the capture time of the newest snapshot, then its text, or the note of the terminal route. It SHALL print the open command of the session. `--json` SHALL print the route reply. It SHALL be a person command: in a session it SHALL exit 1 with the refusal of the route.

#### Scenario: Snapshot
- **WHEN** the person runs `aw terminal AW-12` and ubuntu-01 wrote a snapshot
- **THEN** the output starts with "ubuntu-01 · captured" and the time, then shows the screen

#### Scenario: In a session
- **WHEN** an agent runs `aw terminal AW-12` in its session
- **THEN** the command exits 1 with the refusal

### Requirement: Workspace folder options and output
`aw workspace init` and `aw pair` SHALL have `--in <folder>`: the location that holds the workspace folder (sent as `parent`). `--path` of `aw pair` and the path argument of `aw workspace init` SHALL keep their meaning: the workspace folder itself. The CLI SHALL refuse a path and `--in` together (exit 2). The CLI SHALL print the folder that awd used and the `folder_note` of the reply. `aw status` SHALL print a line `  Folder: <path>` under each workspace. `aw workspace list` SHALL keep the PATH column.

#### Scenario: Init with a location
- **WHEN** a person runs `aw workspace init --in /srv/work --name demo`, and `/srv/work/demo` holds other files
- **THEN** `aw` prints "Created workspace demo (…) at /srv/work/demo-aw1" and the note, and exits with 0

#### Scenario: Status shows the folder
- **WHEN** a person runs `aw status` on a device with the workspace demo at `/srv/work/demo-aw1`
- **THEN** the output has the line "  Folder: /srv/work/demo-aw1" under the workspace line

### Requirement: Question details and option descriptions
`aw ask <task> <question>` SHALL accept `--details <text>`, `--details-file <path>` (Markdown; `-` reads stdin) and `--option "<label>::<description>"` (repeat; the first `::` splits the label and the description). Inside a session, the CLI SHALL read the `--details-file` path only when it is in the working folder of the session after each symlink; else it SHALL exit 1 and call no route. `--details` with `--details-file`, or `--options` with `--option`, SHALL exit 2 before a call. Empty details SHALL exit 2.

#### Scenario: Details from a file
- **WHEN** the agent runs `aw ask AW-7 "Which queue library?" --details-file analysis.md --option "Library A::Same process" --option "Library B::A separate service"` in its session folder
- **THEN** the gate has the title "Which queue library?", the text of `analysis.md`, the options "Library A" and "Library B" with their descriptions, and `aw` exits 0

#### Scenario: File outside the session folder
- **WHEN** the agent runs `aw ask AW-7 "Which?" --details-file /etc/hosts`
- **THEN** `aw` exits 1 and no gate opens

#### Scenario: Two option forms
- **WHEN** the agent runs `aw ask AW-7 "Which?" --options "a|b" --option "c::d"`
- **THEN** `aw` exits 2 and no gate opens

### Requirement: Source of a CLI agent message
`aw message <task> <text>` SHALL write `message.agent` with the source `tool`.

#### Scenario: Message through the CLI
- **WHEN** the session of AW-7 runs `aw message AW-7 "Tests pass"`
- **THEN** AW-7 has `message.agent` with the source `tool`

