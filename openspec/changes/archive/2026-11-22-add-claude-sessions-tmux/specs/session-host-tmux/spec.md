## ADDED Requirements

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
