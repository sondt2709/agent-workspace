## ADDED Requirements

### Requirement: Inbox and source commands
The `aw` CLI SHALL have `aw inbox list [--unread] [--all]`, `aw inbox show <card>`, `aw inbox read|unread|done|undone <card>`, `aw inbox reply <card> <text>`, `aw inbox ask <card> <text>`, `aw inbox run`, `aw source show`, `aw source set mattermost --url <url> --credential <name> --collector <device> [--channels selected|all]`, `aw source conversations` and `aw source read <conversation> all|tagged|off [--project <slug>...]`. Each command SHALL call the same service as the local API route.

#### Scenario: List unread cards
- **WHEN** the person runs `aw inbox list --unread`
- **THEN** the CLI prints one line per unread open card: the short id, the category, the urgency, the project and the title
