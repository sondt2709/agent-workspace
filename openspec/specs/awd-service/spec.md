# awd-service Specification

## Purpose
The awd service on each computer: the settings, the state folder and its modes, the logs, the start of each workspace (merge, index, watcher), the snapshots, the heartbeats and the service units.
## Requirements
### Requirement: Settings module
awd and `aw` SHALL read the environment only in `daemon/src/settings.ts`. `AW_HOME` SHALL select the state folder (default `~/.aw`), and `AW_LOG_LEVEL` the log level (default `info`). `AW_TMUX` SHALL select the tmux binary, `AW_TMUX_SOCKET` the tmux socket name (default `aw`), `AW_CLAUDE` the agent binary (default `claude` in `PATH`) and `AW_CLAUDE_MODEL` an optional `--model` value. `AW_SESSION`, `AW_TASK` and `AW_WORKSPACE` SHALL give the session of the agent commands, and `AW_MCP_TOKEN` its token. `AW_MCP_PORT` SHALL select the MCP port: unset for 7433 to 7442, a number for one port, `0` for any free port, `off` for no MCP server; another value SHALL stop the start of awd with an error, and SHALL NOT stop `aw`, `aw-hook` or `aw-launch`.

#### Scenario: State folder for tests
- **WHEN** awd starts with `AW_HOME=/tmp/x`
- **THEN** it uses `/tmp/x/run/awd.sock`, `/tmp/x/config.yaml` and `/tmp/x/index/`, and it does not create `~/.aw`

#### Scenario: Fake agent
- **WHEN** awd starts with `AW_CLAUDE=<path of the fake agent>`
- **THEN** each session runs that binary

#### Scenario: Bad MCP port
- **WHEN** awd starts with `AW_MCP_PORT=abc`
- **THEN** the start fails with "AW_MCP_PORT must be a port number, 0 or off, not abc"

### Requirement: State folder and socket permissions
awd SHALL create the state folder and `run/` with mode 0700, set the mode again when it differs, and create the socket `run/awd.sock` with mode 0600. awd SHALL NOT listen on a TCP port for the local API. A stale socket file SHALL be removed; a socket that answers SHALL stop the start with an error.

#### Scenario: Modes after start
- **WHEN** awd starts with a new `AW_HOME`
- **THEN** `AW_HOME` and `run/` have mode 0700 and `run/awd.sock` has mode 0600

#### Scenario: Wrong folder mode
- **WHEN** `run/` exists with mode 0755 and awd starts
- **THEN** `run/` has mode 0700

#### Scenario: Second awd
- **WHEN** an awd runs on the socket and a second awd starts with the same `AW_HOME`
- **THEN** the second awd exits with a message that awd already runs, and the first awd still answers

### Requirement: Device and workspace configuration
awd SHALL keep `config.yaml` in the state folder with the device (`slug`, `name`, `role`) and the registered workspace folders. A save SHALL keep each key that this version does not know (a key of a newer awd survives a rollback). When the file is missing, awd SHALL create it with a slug from the host name and the role `local`; this is a proposal until the device has a signed record. Pairing SHALL set the slug and the role from the signed record. At start and after each change of the records, a valid own record (same slug and device key) with another name or role SHALL correct `config.yaml`; the slug changes only by pairing. The open workspaces and their agent sessions SHALL read this device (slug and role) at each use, so a corrected role applies with no restart. `<AW_HOME>/identity.yaml` (mode 0600) SHALL hold the user id and the master public key; the keys SHALL be only in the keystore.

#### Scenario: First start
- **WHEN** awd starts and `config.yaml` is missing
- **THEN** awd writes `config.yaml` with a valid device slug, the role `local` and no workspace, and the keystore has a device key

#### Scenario: Pairing sets the role
- **WHEN** a new computer finishes a pairing as `ubuntu-01`
- **THEN** `config.yaml` has the slug `ubuntu-01` and the role `remote`, and `identity.yaml` has the user id of the showing device

#### Scenario: A new record changes the role
- **WHEN** the device with the master key writes a new signed record of `ubuntu-01` with the role `local`
- **THEN** `config.yaml` of `ubuntu-01` has the role `local`, and its open workspace reads the device `ubuntu-01` with the role `local` with no restart

### Requirement: Workspace start
For each registered workspace, awd SHALL remove stale `*.aw-tmp` files, open the index, create the merge engine with the last valid documents of the index, run one merge update and write the index before `/readyz` is ready. awd SHALL watch `<root>/tasks` and run one merge update and one index write for each batch of file events. A failed update or index write SHALL be logged and tried again at the next batch. A workspace that does not open SHALL show its error in `aw status` and `/readyz`, and awd SHALL try the open again every 10 s of the clock module until it opens. After each merge, the HLC of the files layer SHALL observe the highest merged HLC, so each new event of this device sorts after each merged event, also after an event of a device whose clock runs ahead.

#### Scenario: Another device writes a log line
- **WHEN** awd runs and a `gate.opened` line appears in `tasks/<task-id>/log/ubuntu-01.jsonl`
- **THEN** the index shows the open gate within 2 s, with no API call

#### Scenario: Restart
- **WHEN** awd stops and starts again
- **THEN** the index rows equal the rows of a rebuilt index of the same files

#### Scenario: Failed open
- **WHEN** the first merge of a workspace fails at start (for example `EMFILE`), and the clock moves 10 s
- **THEN** the workspace shows the error, then opens, and the error is gone

#### Scenario: Peer clock ahead
- **WHEN** `ubuntu-01`, with a clock 60 s ahead, opens a gate, and a person answers it on `macbook-pro`
- **THEN** the HLC of the answer is after the HLC of the gate, and the answer counts (`reason` null)

### Requirement: Writes through the files layer
Each write of awd SHALL go through `WorkspaceFiles` of `shared/core` (owner check, redaction, HLC) and append to the log of this device. The writes of one workspace SHALL run one at a time. After each write, awd SHALL merge before it replies. When that merge or index write fails after the append, the reply SHALL be 500 `written_not_merged` with the path of the written file, so a client does not write it again; the next batch merges it.

#### Scenario: Create a task
- **WHEN** a client creates a task on `macbook-pro`
- **THEN** `tasks/<task-id>/log/macbook-pro.jsonl` has one valid `task.created` line with `by: human@macbook-pro`, and the reply has the merged task

#### Scenario: Parallel writes
- **WHEN** 20 clients create a task at the same time
- **THEN** each written line is valid, the 20 events have 20 different HLCs, and the keys `AW-1` to `AW-20` follow the HLC order

#### Scenario: Merge fails after the append
- **WHEN** a person creates a task and the merge after the append fails
- **THEN** `aw` exits with 1, stderr has `written_not_merged` and "Do not run the command again", and the next merge shows one task `AW-1`

### Requirement: Crash safety
A SIGKILL of awd during writes SHALL leave no broken document, and the next start SHALL give the same view as a full merge of the files.

#### Scenario: SIGKILL during writes
- **WHEN** awd gets SIGKILL while clients create tasks, and awd starts again
- **THEN** each YAML file of the workspace parses, the logs have no bad line, each task with a successful reply is in the view, and the view equals a new full merge

### Requirement: Task snapshot
After a merge that changed a task, awd SHALL write `task.yaml` of each changed task whose owner device is this device, when the text differs.

#### Scenario: New task
- **WHEN** `macbook-pro` creates a task
- **THEN** `tasks/<task-id>/task.yaml` is valid and has the key, the title and the first message of the task

### Requirement: Schema files in the workspace
Workspace init and each start SHALL copy each generated JSON Schema to `tasks/schemas/` when it is missing. awd SHALL NOT replace a schema file that exists: the file name has the schema version, and 2 devices with different AW versions must not write a shared file back and forth.

#### Scenario: Init
- **WHEN** a client initializes a new workspace folder
- **THEN** `tasks/schemas/` has each file of `contracts/schemas/`, byte for byte

#### Scenario: Schema file of another AW version
- **WHEN** `tasks/schemas/event.v1.schema.json` has another text and awd starts
- **THEN** awd keeps the file as it is, and copies only the missing files

### Requirement: Heartbeats and retention
awd SHALL append one `device.heartbeat` event every 30 s of the clock module to `tasks/devices/<device>/heartbeat/<UTC date>.jsonl` of each workspace, and SHALL remove its own heartbeat files with a date more than 7 days before the current UTC date. A merge notice `removed` for such a file SHALL NOT count as a Sync problem.

#### Scenario: Heartbeat loop
- **WHEN** the fake clock moves 60 s
- **THEN** the heartbeat file of the day has 3 valid lines: one at start and 2 after

#### Scenario: Retention
- **WHEN** the heartbeat folder has files of 2026-11-15, 2026-11-16 and 2026-11-23 and the date is 2026-11-23
- **THEN** awd removes 2026-11-15 (8 days old), keeps 2026-11-16 and 2026-11-23, and does not touch the files of other devices

### Requirement: Logs
awd SHALL write JSON log lines with pino to stderr, with a `trace_id` for each request, and SHALL redact the fields named like token, secret, key, cookie, password and authorization. The `node:sqlite` ExperimentalWarning SHALL NOT reach stderr; each other process warning SHALL go to the log. awd SHALL check `<AW_HOME>/logs/awd.log` (the log file of the launchd unit) at start and every 5 minutes; above 10 MB it SHALL keep 3 old files (`awd.log.1` to `awd.log.3`), copy the last 10 MB of the file to `awd.log.1` and truncate it to 0 bytes, because launchd keeps the file open. When the copy fails (for example on a full disk), awd SHALL still truncate the file and log a warning.

#### Scenario: Redacted header
- **WHEN** a request has an `Authorization` header
- **THEN** the log line of the request has `[Redacted]` in place of its value

#### Scenario: SQLite warning
- **WHEN** Node emits the ExperimentalWarning "SQLite is an experimental feature"
- **THEN** the filter drops it, and an ExperimentalWarning with another text goes to the log

#### Scenario: Large log
- **WHEN** `awd.log` has 11 MB and `awd.log.1` and `awd.log.2` exist
- **THEN** after the check `awd.log` has 0 bytes, `awd.log.1` has its last 10 MB, and the old `.1` and `.2` are `.2` and `.3`

#### Scenario: Large log on a full disk
- **WHEN** `awd.log` has 6 GB and the copy to `awd.log.1` fails with `ENOSPC`
- **THEN** `awd.log` has 0 bytes, no part of a copy stays, and awd logs a warning

### Requirement: Service units
`aw service install` SHALL write a systemd user unit on Linux, a LaunchAgent on macOS, or a LaunchDaemon with `--headless` on macOS, each with a restart on exit and an exec-form start of awd, and SHALL load it with `systemctl --user` or `launchctl`. On Linux it SHALL also write the user unit `aw-sessions.service`, which runs the tmux server of the sessions in its own control group, never restarts it by itself, and does not stop it with awd. The LaunchAgent and the LaunchDaemon SHALL have `AbandonProcessGroup` true. `--print` SHALL write the unit text to stdout and change nothing. `aw service uninstall` SHALL unload and remove the units, stop the tmux server of the sessions (on Linux with `aw-sessions.service`, on macOS with `tmux -L <socket> kill-server`), and `aw service status` SHALL report whether the awd unit is installed and loaded. On Linux, `aw service install` SHALL print the `loginctl enable-linger` hint only when linger is not on. The LaunchDaemon SHALL run awd as the user that ran `sudo` (`SUDO_USER`), with the home folder of that user for `HOME`, the default `AW_HOME` and the log file, and with `AW_KEYSTORE=file`; `aw service install --headless` SHALL refuse to run as root with no `SUDO_USER` or with `SUDO_USER=root`. The awd systemd unit uses `KillMode=control-group`, so the tmux server runs in `aw-sessions.service`. Each awd unit SHALL set `PATH` to the folder of the node binary, then the first folder of the PATH of the install that has `tmux`, `claude` and `git` (each one; never a folder with `/.orca/` in its path, a tool shim), then `<user home>/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`, `/usr/sbin` and `/sbin`, with no duplicate. It SHALL never copy the whole PATH of the shell (fc1-lead-2). `aw service install` SHALL look for tmux in that PATH. A new install SHALL keep each variable of the old unit that AW does not write itself (not `PATH`, `AW_HOME`, `HOME` or `AW_KEYSTORE`), for example `AW_DISK_FULL_PERCENT` that the person added, and SHALL name them in its output (owner question Q12 is open). On macOS, after the bootout of an old unit, it SHALL wait until `launchctl print` no longer finds the label (at most 10 s), and SHALL try the bootstrap again after 1, 2 and 4 s when launchd answers exit code 5 (fc1-lead-1).

Before the unit, `aw service install` SHALL run the engine install (unless `--no-engine`); a failed engine install SHALL print a warning with the fix and SHALL NOT stop the unit install. When the engine is new, it SHALL restart awd after the load. When tmux is not found, it SHALL print the install command of the OS and continue. `aw service install --headless` SHALL refuse with exit code 1 when `<AW_HOME>` has `identity.yaml` or `config.yaml` and no `keys/device`, and the message SHALL name `aw service move-keys`. `aw service move-keys` SHALL refuse while awd answers on the socket, copy the device key and the recovery phrase from the OS keystore to `<AW_HOME>/keys/`, read them back, and then delete them from the OS keystore.

#### Scenario: Homebrew tmux under launchd
- **WHEN** `aw service install` runs on a Mac where tmux is at `/opt/homebrew/bin/tmux` and Claude Code at `~/.local/bin/claude`
- **THEN** the LaunchAgent has a `PATH` with both folders, so awd finds tmux and `claude`

#### Scenario: systemd unit
- **WHEN** `aw service install --print` runs on Linux
- **THEN** the text has `Restart=always` and `ExecStart=` with the absolute Node path and the absolute awd entry path

#### Scenario: Sessions unit
- **WHEN** `aw service install` runs on Linux
- **THEN** it writes `aw-sessions.service` with `Type=forking`, an `ExecStart=` of tmux with the AW socket and config, `Restart=no`, and `KillMode=process`

#### Scenario: Headless Mac
- **WHEN** `sudo aw service install --headless --print` runs on macOS for the user `someone`
- **THEN** the plist has `KeepAlive` true, `AbandonProcessGroup` true, `UserName` `someone`, `AW_KEYSTORE` `file`, and `HOME` and the log path in the home folder of `someone`, never root

#### Scenario: Headless Mac with no sudo user
- **WHEN** root runs `aw service install --headless` with no `SUDO_USER`, or with `SUDO_USER=root`
- **THEN** `aw` exits with 2 and writes no unit

#### Scenario: Key in the Keychain
- **WHEN** `sudo aw service install --headless` runs and the user's `~/.aw` has `config.yaml` and no `keys/device`
- **THEN** `aw` exits with 1, writes no unit, and the message names `aw service move-keys`

#### Scenario: No tmux
- **WHEN** `aw service install` runs on Ubuntu and no tmux is in PATH
- **THEN** the output has `sudo apt install tmux` and the unit is installed

### Requirement: Sync engine in awd
When the engine binary exists (`AW_SYNC_ENGINE`, else `<AW_HOME>/engine/syncthing`), awd SHALL start the sync engine after it opened the workspaces. When it does not exist, awd SHALL check for it every 5 s and start the engine when it appears, with no restart. awd SHALL add the 3 folders of each open workspace and of each workspace that `aw workspace init` adds, and stop the engine before it closes the workspaces. awd SHALL pass each write of the files layer to the transport (targeted scan) and to the write journal. awd SHALL NOT wait for the engine start before it is ready or before the heartbeat starts. The settings module SHALL read `AW_SYNC_ENGINE`, `AW_SYNC_LISTEN`, `AW_SYNC_COMMUNITY` (`on` or `off`, default `on`) and `AW_SYNC_TEST_PEERS` (`on` or `off`, default `off`).

#### Scenario: Start and stop
- **WHEN** awd starts with an engine binary and one workspace, and then gets SIGTERM
- **THEN** the engine runs with the 3 folders of the workspace while awd runs, and no engine process is left after awd exits

#### Scenario: Engine that never answers
- **WHEN** awd starts with an engine binary whose REST API never answers
- **THEN** `/readyz` answers 200 with `sync_engine: "starting"`, and awd stops the engine process at its stop

#### Scenario: Bad community value
- **WHEN** `AW_SYNC_COMMUNITY` is `maybe`
- **THEN** awd does not start and the error names the variable and the allowed values

### Requirement: Session manager at start
After it opened a workspace, awd SHALL start the session manager of that workspace: reconcile the session records with the tmux panes, drain each spool, deliver the missed answers, and run the claim check. When tmux or the agent binary is missing, awd SHALL look for them again every 60 s and start the manager when both answer, with no restart of awd, and each open task of `claude@<this device>` with no claim SHALL get one comment "AW cannot start a session" with the cause. On stop, awd SHALL stop the manager and SHALL NOT stop a session.

#### Scenario: awd stops
- **WHEN** awd gets SIGTERM while a session runs
- **THEN** the tmux window still runs the agent

#### Scenario: Agent installed after the start
- **WHEN** `claude --version` fails at the start of awd, a task is assigned to `claude@<this device>`, and later the binary answers
- **THEN** the task has one comment "AW cannot start a session", and its session starts with no restart of awd

### Requirement: MCP listener at start
After the local API listens and before the workspaces and their session managers start, awd SHALL start the MCP listener (the mcp-server spec) and log its port, so each window that the start opens finds the port file. When no port of the range is free, awd SHALL log an error and keep running with no MCP server; `aw-launch` then exports `AW_MCP_TOKEN` and no `AW_MCP_URL`. On stop, awd SHALL close the MCP listener first and remove `~/.aw/run/mcp.port`.

#### Scenario: No free port
- **WHEN** each port from 7433 to 7442 is in use and awd starts
- **THEN** awd runs, the local API answers, the log has one error that names the range, and `~/.aw/run/mcp.port` does not exist
