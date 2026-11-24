## MODIFIED Requirements

### Requirement: Settings module
awd and `aw` SHALL read the environment only in `daemon/src/settings.ts`. `AW_HOME` SHALL select the state folder (default `~/.aw`), and `AW_LOG_LEVEL` the log level (default `info`). `AW_TMUX` SHALL select the tmux binary, `AW_TMUX_SOCKET` the tmux socket name (default `aw`), `AW_CLAUDE` the agent binary (default `claude` in `PATH`) and `AW_CLAUDE_MODEL` an optional `--model` value. `AW_SESSION`, `AW_TASK` and `AW_WORKSPACE` SHALL give the session of the agent commands, and `AW_MCP_TOKEN` its token. `AW_MCP_PORT` SHALL select the MCP port: unset for 7433 to 7442, a number for one port, `0` for any free port, `off` for no MCP server; another value SHALL stop the start of awd with an error, and SHALL NOT stop `aw`, `aw-hook` or `aw-launch`.

#### Scenario: State folder for tests
- **WHEN** awd starts with `AW_HOME=/tmp/x`
- **THEN** it uses `/tmp/x/run/awd.sock`, `/tmp/x/config.yaml` and `/tmp/x/index/`, and it does not create `~/.aw`

#### Scenario: Fake agent
- **WHEN** awd starts with `AW_CLAUDE=<path of the fake agent>`
- **THEN** each session runs that binary

#### Scenario: Bad MCP port
- **WHEN** awd starts with `AW_MCP_PORT=abc`
- **THEN** the start fails with "AW_MCP_PORT must be a port number, 0 or off, not abc"

## ADDED Requirements

### Requirement: MCP listener at start
After the local API listens and before the workspaces and their session managers start, awd SHALL start the MCP listener (the mcp-server spec) and log its port, so each window that the start opens finds the port file. When no port of the range is free, awd SHALL log an error and keep running with no MCP server; `aw-launch` then exports `AW_MCP_TOKEN` and no `AW_MCP_URL`. On stop, awd SHALL close the MCP listener first and remove `~/.aw/run/mcp.port`.

#### Scenario: No free port
- **WHEN** each port from 7433 to 7442 is in use and awd starts
- **THEN** awd runs, the local API answers, the log has one error that names the range, and `~/.aw/run/mcp.port` does not exist
