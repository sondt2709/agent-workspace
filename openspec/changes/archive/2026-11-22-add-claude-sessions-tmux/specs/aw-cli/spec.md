## MODIFIED Requirements

### Requirement: Commands
The `aw` CLI SHALL have the commands `status`, `workspace init|list`, `project add|list`, `task create|list|show|edit|assign|archive`, `thread <task> [--ancestors] [--from <n>]`, `gate list|answer`, `session list|stop`, `service install|uninstall|status`, and the agent commands `ask`, `message`, `stage`, `artifact add` and `handoff`. It SHALL export `run(argv, io)` that returns the exit code and writes only to the `io` object. The command tree SHALL accept new top-level commands of later tasks without a change to the existing commands.

#### Scenario: Create from a file
- **WHEN** a person runs `aw task create --project billing-api --title "Fix the flaky test" --first-message-file m.md`
- **THEN** the task has the text of `m.md` as is as its first message, and `aw` prints the key

## ADDED Requirements

### Requirement: Agent commands
The agent commands SHALL take the session from `AW_SESSION` and SHALL exit with 2 and "Run this command inside an AW session" when it is not set. `aw ask <task> <text> [--options "a|b"]` SHALL open a gate `question` and return at once with exit code 0 and a text that tells the agent to end its turn. `aw message <task> <text>` SHALL write `message.agent`, `aw stage <task> <text>` SHALL write `task.progress`, `aw artifact add <task> <file>` SHALL copy the file into `artifacts/<device>/` and write `artifact.added` with its size and sha256, and `aw handoff <task> --file <path>` SHALL write the handoff file and `handoff.written`. The file of `aw artifact add` and `aw handoff` SHALL be in the working folder of the session after each symlink and at most 50 MB; else awd SHALL refuse it (exit 1) and copy nothing. awd SHALL refuse (exit 1) a task that is not the task of the session. When `AW_SESSION` is set, the CLI SHALL refuse (exit 1) each command of a person: `aw gate answer`, `aw task assign|edit|archive`, `aw session stop`, `aw service install|uninstall`, `aw workspace init` and `aw project add`.

#### Scenario: Ask returns at once
- **WHEN** the agent runs `aw ask AW-7 "Which limit?" --options "100/min|1000/min"` in its session
- **THEN** `aw` exits with 0 in less than 2 s, prints the gate id and "End your turn now", and the gate is open with the 2 options

#### Scenario: Agent answers its own gate
- **WHEN** the session of AW-7 runs `aw gate answer <its gate> "1000/min"`
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
