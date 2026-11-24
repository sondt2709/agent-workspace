## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Knowledge rules of the skill
The AW skill (`plugin/skills/aw/SKILL.md`) SHALL tell the agent to search the knowledge first (the "Read now" files of the session context, the resource `aw://knowledge` and `aw kb search <terms>`) before it plans, and to record `learn` for each learned item, or `learn` with `nothing_new: true`, before `done`. It SHALL list `aw learn <TASK> --nothing-new` with the commands. It SHALL stay below 6,000 characters.

#### Scenario: Skill rules
- **WHEN** the tests read `SKILL.md`
- **THEN** it names `aw://knowledge`, `nothing_new` and `aw learn <TASK> --nothing-new`, and it has fewer than 6,000 characters
