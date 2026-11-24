# agent-claude-plugin Specification

## Purpose
The AW plugin for Claude Code and the Claude adapter in `plugins/agent-claude`, the fixed launcher `aw-launch`, the worktree trust entry and the fake agent of the tests.
## Requirements
### Requirement: Plugin directory
`plugins/agent-claude/plugin/` SHALL have `.claude-plugin/plugin.json` with `"name": "aw"`, `.mcp.json` with the `mcpServers` entry `aw` (`"type": "http"`, `"url": "${AW_MCP_URL:-http://aw-mcp-url-not-set.invalid/mcp}"`, the header `"Authorization": "Bearer ${AW_MCP_TOKEN:-none}"`), `skills/aw/SKILL.md` with fewer than 6,000 characters, `hooks/hooks.json` with a command hook for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Notification, Stop, StopFailure and SessionEnd, and `bin/aw` and `bin/aw-hook`. The PermissionRequest hook timeout SHALL be above 120 s. The allow rule `mcp__plugin_<name>_<server>__*` of `aw-launch` SHALL match the manifest name and the server key.

#### Scenario: Contract test
- **WHEN** the tests read `plugin.json`, `.mcp.json`, `SKILL.md` and the launch arguments
- **THEN** the name is `aw`, the server key is `aw`, the URL and the header use `AW_MCP_URL` and `AW_MCP_TOKEN`, the skill has fewer than 6,000 characters, and the allow rule is `mcp__plugin_aw_aw__*`

### Requirement: Claude adapter
The adapter SHALL detect the Claude Code version from `claude --version` and the auth method from `claude auth status --json`, and SHALL never read a credential file, the keychain or a token. It SHALL build the launch arguments with `--session-id` for a new session and `--resume` for a resume, the same other flags, `--allowedTools` with one rule per agent command (`Bash(aw ask *)`, `Bash(aw message *)`, `Bash(aw stage *)`, `Bash(aw artifact add *)`, `Bash(aw handoff *)`, `Bash(aw thread *)`, the work loop and slot commands, and the knowledge commands `Bash(aw learn *)`, `Bash(aw kb write *)`, `Bash(aw kb search *)`, `Bash(aw kb show *)`, `Bash(aw kb list *)`, `Bash(aw kb context *)`) and `mcp__plugin_aw_aw__*`, never a rule for the whole `aw` CLI or for `aw kb accept`, `aw kb reject` or `aw kb undo`, and the message as the last argument after `--`. It SHALL parse each hook payload into an AW hook event and keep unknown fields.

#### Scenario: No rule for the commands of a person
- **WHEN** the adapter builds the launch arguments
- **THEN** `--allowedTools` has `Bash(aw ask *)` and `Bash(aw thread *)`, and no rule `Bash(aw *)`, `Bash(aw gate ...)`, `Bash(aw task ...)`, `Bash(aw session ...)` or `Bash(aw service ...)`

#### Scenario: Knowledge commands of the agent
- **WHEN** the adapter builds the launch arguments
- **THEN** `--allowedTools` has `Bash(aw learn *)` and `Bash(aw kb write *)`, and no rule `Bash(aw kb *)`, `Bash(aw kb accept *)` or `Bash(aw kb reject *)`

#### Scenario: Resume order
- **WHEN** the adapter builds the resume arguments with the continue message
- **THEN** `--resume <uuid>` replaces `--session-id <uuid>`, the other flags are equal, and the last 2 arguments are `--` and the message

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

### Requirement: Worktree trust entry
On a covered Claude Code version (2.1.319 or later in 2.1), `aw-launch` SHALL copy the Claude Code state file to `~/.aw/backups/` and set only `projects["<worktree>"].hasTrustDialogAccepted` to true. On another version it SHALL not change the file. The writes of one state file in one process SHALL run one at a time, each with a new temp file name, so 2 session starts at once keep both entries (ssc-1).

#### Scenario: Only the entry changes
- **WHEN** `aw-launch` trusts a worktree in a state file with other entries
- **THEN** only that entry changes, and the backup has the old bytes

### Requirement: Fake agent
The tests SHALL use a fake `claude` that accepts the launch flags, shows the trust screen for an untrusted folder, runs the hook commands of the plugin with payloads copied from captured Claude Code payloads (with the source and the capture date), keeps a transcript, refuses `--resume` of an unknown session, refuses `--session-id` of a session that has a transcript ("already in use"), and joins a bracketed paste into one input.

#### Scenario: Resume of an unknown session
- **WHEN** the fake agent starts with `--resume` and a session id that has no transcript
- **THEN** it prints "No conversation found with session ID" and exits with code 1

#### Scenario: Session id in use
- **WHEN** the fake agent starts with `--session-id` and a session id that has a transcript
- **THEN** it prints "is already in use" and exits with code 1

### Requirement: Statusline command
The plugin SHALL have `bin/aw-statusline`, and the session settings file SHALL name it as the `statusLine` command. It SHALL write the `rate_limits` of its input to `usage.json` of the session (0600) when they changed, then run the statusline command of the user (`AW_USER_STATUSLINE`, from the user settings of Claude Code) with the same input and print its output. With no session it SHALL only run the user command.

#### Scenario: Usage windows
- **WHEN** Claude Code runs the statusline with `rate_limits.five_hour.used_percentage` 42
- **THEN** `usage.json` of the session has 42 for the 5-hour window, and the output is the output of the user command

### Requirement: Knowledge rules of the skill
The AW skill (`plugin/skills/aw/SKILL.md`) SHALL tell the agent to search the knowledge first (the "Read now" files of the session context, the resource `aw://knowledge` and `aw kb search <terms>`) before it plans, and to record `learn` for each learned item, or `learn` with `nothing_new: true`, before `done`. It SHALL list `aw learn <TASK> --nothing-new` with the commands. It SHALL stay below 6,000 characters.

#### Scenario: Skill rules
- **WHEN** the tests read `SKILL.md`
- **THEN** it names `aw://knowledge`, `nothing_new` and `aw learn <TASK> --nothing-new`, and it has fewer than 6,000 characters

### Requirement: Session settings of the adapter
The Claude adapter SHALL build the session settings file: `permissions.allow` with the agent commands, `permissions.deny` with `Bash(aw <c>)` and `Bash(aw <c> *)` for each person command, the AW status line, and for the options the skip key and the team settings. It SHALL map the AW modes to `--permission-mode` `default`, `acceptEdits` and `bypassPermissions`.

#### Scenario: Settings of a skip team session
- **WHEN** the adapter builds the settings for `skip` with agent teams
- **THEN** the file has `skipDangerousModePermissionPrompt: true`, `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"`, `teammateMode: "in-process"` and the deny rule `Bash(aw gate answer *)`

### Requirement: Decision context in the question
The skill `aw` SHALL tell the agent to put the full context of a decision (the options, the trade-offs, the risks and a recommendation) in the question with `details` of the MCP tool `ask` or `aw ask --details-file`, and never to write "see the message above". The SKILL.md SHALL stay below 6,000 characters.

#### Scenario: Skill text
- **WHEN** the contract test reads `plugin/skills/aw/SKILL.md`
- **THEN** it has the words `--details-file` and `details`, and it has fewer than 6,000 characters

### Requirement: Fake AskUserQuestion with a full input
The fake agent SHALL have the step `ask-tool-json <json>`, which calls the AskUserQuestion tool with that JSON as the tool input and ends the turn.

#### Scenario: Two questions
- **WHEN** a test sends `ask-tool-json {"questions":[…2 questions…]}`
- **THEN** the PreToolUse payload has both questions, and a gate opens with both in `questions`

### Requirement: Update rules of the skill
The skill `aw` and the AW rules of `context.md` SHALL say that the text output of the agent goes only to the Session log and that the human reads only AW. They SHALL tell the agent to end each turn with one AW call: `ask`, `approach`, `ready`, `result`, `gate`, `message`, `learn` or `done`. They SHALL say that a `message` is short, for a phone screen, and does not repeat a gate or a result. They SHALL say that `[AW notice <id>] Your turn ended with no AW update` asks for that update. The fake agent SHALL be able to run `aw message` and then end the turn with a long text.

#### Scenario: Skill text
- **WHEN** a test reads `plugin/skills/aw/SKILL.md`
- **THEN** it has the turn rule and the Session log rule, and it has fewer than 6,000 characters

