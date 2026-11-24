## MODIFIED Requirements

### Requirement: Plugin directory
`plugins/agent-claude/plugin/` SHALL have `.claude-plugin/plugin.json` with `"name": "aw"`, `.mcp.json` with the `mcpServers` entry `aw` (`"type": "http"`, `"url": "${AW_MCP_URL:-http://aw-mcp-url-not-set.invalid/mcp}"`, the header `"Authorization": "Bearer ${AW_MCP_TOKEN:-none}"`), `skills/aw/SKILL.md` with fewer than 6,000 characters, `hooks/hooks.json` with a command hook for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Notification, Stop, StopFailure and SessionEnd, and `bin/aw` and `bin/aw-hook`. The PermissionRequest hook timeout SHALL be above 120 s. The allow rule `mcp__plugin_<name>_<server>__*` of `aw-launch` SHALL match the manifest name and the server key.

#### Scenario: Contract test
- **WHEN** the tests read `plugin.json`, `.mcp.json`, `SKILL.md` and the launch arguments
- **THEN** the name is `aw`, the server key is `aw`, the URL and the header use `AW_MCP_URL` and `AW_MCP_TOKEN`, the skill has fewer than 6,000 characters, and the allow rule is `mcp__plugin_aw_aw__*`

### Requirement: aw-launch
`aw-launch <session>` SHALL read `launch.json` and the message file of the session, wait for `/readyz` on the awd socket for at most 10 s (else exit 3), export `AW_SESSION`, `AW_TASK`, `AW_WORKSPACE`, `AW_HOME` and `CLAUDE_CODE_NONBLOCKING_STDOUT=1`, export `AW_MCP_TOKEN` from `mcp-token` of the session and `AW_MCP_URL=http://127.0.0.1:<port>/mcp` from `~/.aw/run/mcp.port`, and replace itself with the agent process (`execve`), with no shell. It SHALL export `AW_MCP_TOKEN` whenever the token file exists, also with no port file (MCP off or not started), because the token is the agent identity of the aw CLI and the hooks; `AW_MCP_URL` SHALL depend only on the port file. The token SHALL never be in a command line or in `launch.json`.

#### Scenario: awd down
- **WHEN** `aw-launch` runs and no awd answers on the socket for 10 s
- **THEN** it exits with code 3 and starts no agent

#### Scenario: MCP variables
- **WHEN** `aw-launch` starts a session while awd listens for MCP on port 7433
- **THEN** the agent has `AW_MCP_URL=http://127.0.0.1:7433/mcp` and `AW_MCP_TOKEN` equal to the content of `mcp-token`, and no process argument holds the token

#### Scenario: MCP off
- **WHEN** awd runs with `AW_MCP_PORT=off` and `aw-launch` starts a session
- **THEN** the agent has `AW_MCP_TOKEN` and no `AW_MCP_URL`, `aw ask` opens a gate, and a PermissionRequest hook opens an approval gate (no deny)
