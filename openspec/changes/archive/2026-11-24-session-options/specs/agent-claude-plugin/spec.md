## ADDED Requirements

### Requirement: Session settings of the adapter
The Claude adapter SHALL build the session settings file: `permissions.allow` with the agent commands, `permissions.deny` with `Bash(aw <c>)` and `Bash(aw <c> *)` for each person command, the AW status line, and for the options the skip key and the team settings. It SHALL map the AW modes to `--permission-mode` `default`, `acceptEdits` and `bypassPermissions`.

#### Scenario: Settings of a skip team session
- **WHEN** the adapter builds the settings for `skip` with agent teams
- **THEN** the file has `skipDangerousModePermissionPrompt: true`, `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"`, `teammateMode: "in-process"` and the deny rule `Bash(aw gate answer *)`
