## MODIFIED Requirements

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

### Requirement: Task loop agent commands
Inside a session (AW_SESSION set), the CLI SHALL have `aw proposal <task> --file <path>` (with `aw approach` as an alias), `aw ready <task> [--missing <item>]...`, `aw result <task> --file <path> [--artifact <path>]...`, `aw done <task>`, `aw gate open <task> --file <path> [--options <a|b>]` and `aw task create --title ... (--first-message <text> | --first-message-file <path>) [--parent <task>] [--from-parent] [--depends-on <task>]... [--test-server] [--credential]... [--link]...`, which call the session routes. Each of these SHALL be in the allow rules of the session (`Bash(aw <command> *)`). Outside a session, `aw task create` SHALL keep the person route.

#### Scenario: Proposal from the CLI
- **WHEN** the agent runs `aw proposal AW-7 --file proposal.md`
- **THEN** the CLI prints the gate id and "End your turn now", with exit code 0

#### Scenario: Old command name
- **WHEN** the agent runs `aw approach AW-7 --file proposal.md`
- **THEN** the result is the same as with `aw proposal`
