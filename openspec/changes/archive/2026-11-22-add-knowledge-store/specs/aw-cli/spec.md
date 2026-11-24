## ADDED Requirements

### Requirement: Knowledge commands
The `aw` CLI SHALL have the commands `aw kb list [--shared | --project <slug>]`, `aw kb show <path> [--version <hash>]`, `aw kb write <path> (--file <path|-> ) [--base <hash>]`, `aw kb history <path>`, `aw kb undo <change>`, `aw kb search <terms…>`, `aw kb suggestions [--all]`, `aw kb accept <suggestion> [--force] [--comment]`, `aw kb reject <suggestion> [--comment]`, `aw kb digest [--date <YYYY-MM-DD>]`, `aw kb context <task> [--path <file>…]`, and `aw learn <task> --file <path|-> --title <title> [--shared] [--author <agent@device>]`. Each command SHALL call the knowledge routes of the local API and SHALL follow the output modes and exit codes of the CLI. A change that became a suggestion SHALL print "Waits for approval" with the reasons and exit 0.

#### Scenario: Undo from the CLI
- **WHEN** a person runs `aw kb undo <change id>`
- **THEN** the file has the base content of the change, and `aw` prints the new change id

#### Scenario: Learned item of an agent in shared knowledge
- **WHEN** a person runs `aw learn AW-7 --file item.md --title "Reset the DB" --shared --author claude@macbook-pro`
- **THEN** `aw` prints "Waits for approval" with the reason `shared`, and no knowledge file is written
