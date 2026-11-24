## ADDED Requirements

### Requirement: Question details and option descriptions
`aw ask <task> <question>` SHALL accept `--details <text>`, `--details-file <path>` (Markdown; `-` reads stdin) and `--option "<label>::<description>"` (repeat; the first `::` splits the label and the description). Inside a session, the CLI SHALL read the `--details-file` path only when it is in the working folder of the session after each symlink; else it SHALL exit 1 and call no route. `--details` with `--details-file`, or `--options` with `--option`, SHALL exit 2 before a call. Empty details SHALL exit 2.

#### Scenario: Details from a file
- **WHEN** the agent runs `aw ask AW-7 "Which queue library?" --details-file analysis.md --option "Library A::Same process" --option "Library B::A separate service"` in its session folder
- **THEN** the gate has the title "Which queue library?", the text of `analysis.md`, the options "Library A" and "Library B" with their descriptions, and `aw` exits 0

#### Scenario: File outside the session folder
- **WHEN** the agent runs `aw ask AW-7 "Which?" --details-file /etc/hosts`
- **THEN** `aw` exits 1 and no gate opens

#### Scenario: Two option forms
- **WHEN** the agent runs `aw ask AW-7 "Which?" --options "a|b" --option "c::d"`
- **THEN** `aw` exits 2 and no gate opens
