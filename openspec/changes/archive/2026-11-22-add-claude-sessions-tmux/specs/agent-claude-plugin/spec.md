## ADDED Requirements

### Requirement: Plugin directory
`plugins/agent-claude/plugin/` SHALL have `.claude-plugin/plugin.json` with `"name": "aw"`, `skills/aw/SKILL.md` with fewer than 6,000 characters, `hooks/hooks.json` with a command hook for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Notification, Stop, StopFailure and SessionEnd, and `bin/aw` and `bin/aw-hook`. The PermissionRequest hook timeout SHALL be above 120 s. The allow rule `mcp__plugin_<name>_aw__*` of `aw-launch` SHALL match the manifest name.

#### Scenario: Contract test
- **WHEN** the tests read `plugin.json`, `SKILL.md` and the launch arguments
- **THEN** the name is `aw`, the skill has fewer than 6,000 characters, and the allow rule is `mcp__plugin_aw_aw__*`

### Requirement: Claude adapter
The adapter SHALL detect the Claude Code version from `claude --version` and the auth method from `claude auth status --json`, and SHALL never read a credential file, the keychain or a token. It SHALL build the launch arguments with `--session-id` for a new session and `--resume` for a resume, the same other flags, `--allowedTools` with one rule per agent command (`Bash(aw ask *)`, `Bash(aw message *)`, `Bash(aw stage *)`, `Bash(aw artifact add *)`, `Bash(aw handoff *)`, `Bash(aw thread *)`) and `mcp__plugin_aw_aw__*`, never a rule for the whole `aw` CLI, and the message as the last argument after `--`. It SHALL parse each hook payload into an AW hook event and keep unknown fields.

#### Scenario: No rule for the commands of a person
- **WHEN** the adapter builds the launch arguments
- **THEN** `--allowedTools` has `Bash(aw ask *)` and `Bash(aw thread *)`, and no rule `Bash(aw *)`, `Bash(aw gate ...)`, `Bash(aw task ...)`, `Bash(aw session ...)` or `Bash(aw service ...)`

#### Scenario: Resume order
- **WHEN** the adapter builds the resume arguments with the continue message
- **THEN** `--resume <uuid>` replaces `--session-id <uuid>`, the other flags are equal, and the last 2 arguments are `--` and the message

### Requirement: aw-launch
`aw-launch <session>` SHALL read `launch.json` and the message file of the session, wait for `/readyz` on the awd socket for at most 10 s (else exit 3), export `AW_SESSION`, `AW_TASK`, `AW_WORKSPACE`, `AW_HOME` and `CLAUDE_CODE_NONBLOCKING_STDOUT=1`, and replace itself with the agent process (`execve`), with no shell.

#### Scenario: awd down
- **WHEN** `aw-launch` runs and no awd answers on the socket for 10 s
- **THEN** it exits with code 3 and starts no agent

### Requirement: Worktree trust entry
On a covered Claude Code version (2.1.319 or later in 2.1), `aw-launch` SHALL copy the Claude Code state file to `~/.aw/backups/` and set only `projects["<worktree>"].hasTrustDialogAccepted` to true. On another version it SHALL not change the file.

#### Scenario: Only the entry changes
- **WHEN** `aw-launch` trusts a worktree in a state file with other entries
- **THEN** only that entry changes, and the backup has the old bytes

### Requirement: Fake agent
The tests SHALL use a fake `claude` that accepts the launch flags, shows the trust screen for an untrusted folder, runs the hook commands of the plugin with payloads copied from captured Claude Code payloads (with the source and the capture date), keeps a transcript, refuses `--resume` of an unknown session, and joins a bracketed paste into one input.

#### Scenario: Resume of an unknown session
- **WHEN** the fake agent starts with `--resume` and a session id that has no transcript
- **THEN** it prints "No conversation found with session ID" and exits with code 1
