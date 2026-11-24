## ADDED Requirements

### Requirement: Task loop agent commands
Inside a session (AW_SESSION set), the CLI SHALL have `aw approach <task> --file <path> [--decisions <json file>]`, `aw ready <task> [--missing <item>]...`, `aw result <task> --file <path> [--artifact <path>]...`, `aw done <task>`, `aw gate open <task> --file <path> [--decisions <json file>] [--options <a|b>]` and `aw task create --title ... (--first-message <text> | --first-message-file <path>) [--parent <task>] [--from-parent] [--depends-on <task>]... [--test-server] [--credential]... [--link]...`, which call the session routes. Each of these SHALL be in the allow rules of the session (`Bash(aw <command> *)`). Outside a session, `aw task create` SHALL keep the person route.

#### Scenario: Approach from the CLI
- **WHEN** the agent runs `aw approach AW-7 --file approach.md`
- **THEN** the CLI prints the gate id and "End your turn now", with exit code 0
