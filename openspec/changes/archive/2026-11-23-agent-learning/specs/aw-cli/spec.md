## MODIFIED Requirements

### Requirement: Knowledge commands
The `aw` CLI SHALL have the commands `aw kb list [--shared | --project <slug>]`, `aw kb show <path> [--version <hash>]`, `aw kb write <path> (--file <path|-> ) [--base <hash>]`, `aw kb history <path>`, `aw kb undo <change>`, `aw kb search <terms…>`, `aw kb suggestions [--all]`, `aw kb accept <suggestion> [--force] [--comment]`, `aw kb reject <suggestion> [--comment]`, `aw kb digest [--date <YYYY-MM-DD>]`, `aw kb context <task> [--path <file>…]`, `aw learn <task> --file <path|-> --title <title> [--shared] [--author <agent@device>]` and `aw learn <task> --nothing-new [--author <agent@device>]`. `--nothing-new` with `--file`, `--title` or `--shared`, or `aw learn` with neither `--nothing-new` nor both `--file` and `--title`, SHALL exit 2 before a call. Each command SHALL call the knowledge routes of the local API and SHALL follow the output modes and exit codes of the CLI. A change that became a suggestion SHALL print "Waits for approval" with the reasons and exit 0. A `task.learned` that the merge did not apply SHALL print the reason and exit 1. When `AW_MCP_TOKEN` is set, each request SHALL have the header `Authorization: Bearer <token>`, so awd acts as the agent of the session; a refusal SHALL exit 1.

#### Scenario: Undo from the CLI
- **WHEN** a person runs `aw kb undo <change id>`
- **THEN** the file has the base content of the change, and `aw` prints the new change id

#### Scenario: Learned item of an agent in shared knowledge
- **WHEN** a person runs `aw learn AW-7 --file item.md --title "Reset the DB" --shared --author claude@macbook-pro`
- **THEN** `aw` prints "Waits for approval" with the reason `shared`, and no knowledge file is written

#### Scenario: Agent session accepts its own suggestion
- **WHEN** the session of AW-7 runs `aw kb accept <suggestion>`, or `aw kb write shared/team.md --file f.md`
- **THEN** `aw` exits with 1, the suggestion is still pending, and `shared/team.md` is not written

#### Scenario: Nothing new
- **WHEN** the session of AW-7 runs `aw learn AW-7 --nothing-new`
- **THEN** `aw` prints "Recorded: nothing new learned on AW-7" and exits 0, and AW-7 has `task.learned` `{nothing_new: true}`

#### Scenario: Nothing new with a file
- **WHEN** a person runs `aw learn AW-7 --nothing-new --file item.md`
- **THEN** `aw` exits with 2 and calls no route

## ADDED Requirements

### Requirement: Thread text of the learning step
`aw thread` SHALL print the text "Nothing new learned" for `task.learned` with `nothing_new: true`, "Learned: <path>" for a learned item, and "Learned: <path> (waits for approval)" for an item with a suggestion.

#### Scenario: Thread of a task with nothing new
- **WHEN** AW-7 has `task.learned` `{nothing_new: true}` by `claude@macbook-pro`
- **THEN** `aw thread AW-7` has the line `claude@macbook-pro task.learned` and the text "Nothing new learned"
