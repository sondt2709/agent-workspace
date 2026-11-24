# session-host-tmux Specification

## Purpose
The tmux session host in `plugins/host-tmux`: the private tmux server, exec-form windows, input by paste, and the stop of a process group.
## Requirements
### Requirement: Private tmux server
The tmux host SHALL use its own socket name (`AW_TMUX_SOCKET`, default `aw`) and a config with `exit-empty off` and `remain-on-exit on`. It SHALL use `AW_TMUX`, else the first `tmux` in `PATH` that is not in a `/.orca/` folder. On Linux, when the user unit `aw-sessions.service` is installed, it SHALL start the server through that unit; when the unit is missing, it SHALL start the server in a transient scope of the systemd user manager (`systemd-run --user --scope`) and log a warning to run `aw service install` again, so an awd restart never stops the sessions.

#### Scenario: Shim in PATH
- **WHEN** the first `tmux` in `PATH` is in a `/.orca/` folder and a second one exists
- **THEN** the host uses the second one

### Requirement: Exec-form windows
The host SHALL open each window with exec-form arguments and at least 2 command arguments, so tmux runs no shell. The window name SHALL be `aw-<task-id>`. The host SHALL return the pane id, the pane pid and the process group id.

#### Scenario: Dead pane stays
- **WHEN** the process of a window exits with code 3
- **THEN** `list()` shows the pane as dead with status 3

### Requirement: Input and output
The host SHALL paste text with `load-buffer` from stdin and `paste-buffer -p -d`, and SHALL send only fixed key names with `send-keys`. It SHALL read the screen with `capture-pane` only for dialogs and the watchdog.

#### Scenario: Paste keeps lines together
- **WHEN** the host pastes "a\nb\nc" into a program that reads bracketed paste
- **THEN** the program gets one paste with 3 lines

### Requirement: Process-group stop
`stop()` SHALL send SIGTERM to the process group of the pane, SIGKILL after 5 s, then SIGKILL to each remaining descendant from the process table, and then close the window. It SHALL signal nothing when tmux does not list the pane with the stored pane id and pid. For a dead pane it SHALL signal only the members of the process group that started after the pane opened.

#### Scenario: Background command
- **WHEN** the pane process started a background command in another process group and the host stops the session
- **THEN** no process of the pane or its descendants is left

#### Scenario: Stored pids of another program
- **WHEN** the stored pane is gone and its pid is the pid of another program
- **THEN** the stop signals nothing, and the other program keeps running

### Requirement: Format lines of each tmux version
The tmux host SHALL read the `-F` output of `new-window` and `list-panes` with the printable separator `|`, because tmux before 3.4 prints a tab of a format as `_`. A `new-window` line with another field count SHALL be refused with an error that names the tmux version (`tmux 3.3a gave 1 fields, not 3: …`). The host SHALL never use a part of a line. In `list-panes`, `window_name` SHALL be the last field, and the rest of the line SHALL be the name, because a person or an agent can give a window a name with `|`. A `list-panes` line with too few fields SHALL be skipped and logged, so one bad window never stops the checks of the other sessions.

#### Scenario: tmux 3.3a
- **WHEN** awd opens a session window with tmux 3.3a (Debian 12)
- **THEN** the window opens, and the pane, the window id and the pid are known

#### Scenario: Line with the wrong field count
- **WHEN** tmux gives the line `@1_%1_271` for 3 fields
- **THEN** the host refuses it with an error that names the tmux version

#### Scenario: Window name with the separator
- **WHEN** a person renames a window of the AW session to `build|test`
- **THEN** `list()` gives that window with the name `build|test` and each other pane, with no error
