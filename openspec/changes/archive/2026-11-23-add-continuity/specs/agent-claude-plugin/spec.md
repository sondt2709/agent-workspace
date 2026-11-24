## MODIFIED Requirements

### Requirement: aw-launch
`aw-launch <session>` SHALL read `launch.json` and the message file of the session, wait for `/readyz` on the awd socket for at most 10 s (else exit 3), export `AW_SESSION`, `AW_TASK`, `AW_WORKSPACE`, `AW_HOME` and `CLAUDE_CODE_NONBLOCKING_STDOUT=1`, export `CLAUDE_CONFIG_DIR` when awd has it in its environment (so awd and the agent use the same transcript folder; with no value awd sets none, because the variable also moves the state file of Claude Code), export `AW_MCP_TOKEN` from `mcp-token` of the session and `AW_MCP_URL=http://127.0.0.1:<port>/mcp` from `~/.aw/run/mcp.port`, and replace itself with the agent process (`execve`), with no shell. It SHALL export `AW_MCP_TOKEN` whenever the token file exists, also with no port file (MCP off or not started), because the token is the agent identity of the aw CLI and the hooks; `AW_MCP_URL` SHALL depend only on the port file. The token SHALL never be in a command line or in `launch.json`.

#### Scenario: awd down
- **WHEN** `aw-launch` runs and no awd answers on the socket for 10 s
- **THEN** it exits with code 3 and starts no agent

#### Scenario: MCP variables
- **WHEN** `aw-launch` starts a session while awd listens for MCP on port 7433
- **THEN** the agent has `AW_MCP_URL=http://127.0.0.1:7433/mcp` and `AW_MCP_TOKEN` equal to the content of `mcp-token`, and no process argument holds the token

#### Scenario: MCP off
- **WHEN** awd runs with `AW_MCP_PORT=off` and `aw-launch` starts a session
- **THEN** the agent has `AW_MCP_TOKEN` and no `AW_MCP_URL`, `aw ask` opens a gate, and a PermissionRequest hook opens an approval gate (no deny)

#### Scenario: Config folder
- **WHEN** awd runs with `CLAUDE_CONFIG_DIR=/x/claude`
- **THEN** `launch.json` has `CLAUDE_CONFIG_DIR=/x/claude` in its environment

### Requirement: Fake agent
The tests SHALL use a fake `claude` that accepts the launch flags, shows the trust screen for an untrusted folder, runs the hook commands of the plugin with payloads copied from captured Claude Code payloads (with the source and the capture date), keeps a transcript, refuses `--resume` of an unknown session, refuses `--session-id` of a session that has a transcript ("already in use"), and joins a bracketed paste into one input.

#### Scenario: Resume of an unknown session
- **WHEN** the fake agent starts with `--resume` and a session id that has no transcript
- **THEN** it prints "No conversation found with session ID" and exits with code 1

#### Scenario: Session id in use
- **WHEN** the fake agent starts with `--session-id` and a session id that has a transcript
- **THEN** it prints "is already in use" and exits with code 1

## ADDED Requirements

### Requirement: Statusline command
The plugin SHALL have `bin/aw-statusline`, and the session settings file SHALL name it as the `statusLine` command. It SHALL write the `rate_limits` of its input to `usage.json` of the session (0600) when they changed, then run the statusline command of the user (`AW_USER_STATUSLINE`, from the user settings of Claude Code) with the same input and print its output. With no session it SHALL only run the user command.

#### Scenario: Usage windows
- **WHEN** Claude Code runs the statusline with `rate_limits.five_hour.used_percentage` 42
- **THEN** `usage.json` of the session has 42 for the 5-hour window, and the output is the output of the user command
