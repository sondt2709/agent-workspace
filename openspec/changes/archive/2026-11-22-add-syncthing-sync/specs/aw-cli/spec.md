## MODIFIED Requirements

### Requirement: Commands
The `aw` CLI SHALL have the commands `status`, `workspace init|list`, `project add|list`, `task create|list|show|edit|assign|archive`, `thread <task>`, `gate list|answer`, `service install|uninstall|status` and `sync now|status|pause|resume`, `sync peer add <device-id> <address...> [--name] [--role]|remove <device>`. It SHALL export `run(argv, io)` that returns the exit code and writes only to the `io` object. The command tree SHALL accept new top-level commands of later tasks without a change to the existing commands.

#### Scenario: Create from a file
- **WHEN** a person runs `aw task create --project billing-api --title "Fix the flaky test" --first-message-file m.md`
- **THEN** the task has the text of `m.md` as is as its first message, and `aw` prints the key

#### Scenario: Sync now with an offline peer
- **WHEN** a person runs `aw sync now` and the peer ubuntu-01 is offline with 3 changes not synced
- **THEN** `aw` prints "3 changes not synced to ubuntu-01 (offline)" and exits with 1

#### Scenario: Sync now synced
- **WHEN** a person runs `aw sync now` and each peer is synced
- **THEN** `aw` prints "Synced" with the time for each peer and exits with 0
