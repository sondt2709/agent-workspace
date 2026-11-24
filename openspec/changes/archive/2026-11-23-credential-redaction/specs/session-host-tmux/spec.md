## ADDED Requirements

### Requirement: Format lines of each tmux version
The tmux host SHALL read the `-F` output of `new-window` and `list-panes` with the printable separator `|`, because tmux before 3.4 prints a tab of a format as `_`. A format line with another field count SHALL be refused with an error that names the tmux version (`tmux 3.3a gave 1 fields, not 3: …`). The host SHALL never use a part of a line.

#### Scenario: tmux 3.3a
- **WHEN** awd opens a session window with tmux 3.3a (Debian 12)
- **THEN** the window opens, and the pane, the window id and the pid are known

#### Scenario: Line with the wrong field count
- **WHEN** tmux gives the line `@1_%1_271` for 3 fields
- **THEN** the host refuses it with an error that names the tmux version
