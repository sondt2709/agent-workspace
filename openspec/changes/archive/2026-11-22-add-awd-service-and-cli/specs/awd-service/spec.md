## ADDED Requirements

### Requirement: Settings module
awd and `aw` SHALL read the environment only in `apps/daemon/src/settings.ts`. `AW_HOME` SHALL select the state folder (default `~/.aw`), and `AW_LOG_LEVEL` the log level (default `info`).

#### Scenario: State folder for tests
- **WHEN** awd starts with `AW_HOME=/tmp/x`
- **THEN** it uses `/tmp/x/run/awd.sock`, `/tmp/x/config.yaml` and `/tmp/x/index/`, and it does not create `~/.aw`

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
awd SHALL keep `config.yaml` in the state folder with the device (`slug`, `name`, `role`) and the registered workspace folders. When the file is missing, awd SHALL create it with a slug from the host name and the role `local`.

#### Scenario: First start
- **WHEN** awd starts and `config.yaml` is missing
- **THEN** awd writes `config.yaml` with a valid device slug, the role `local` and no workspace

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
Each write of awd SHALL go through `WorkspaceFiles` of `packages/core` (owner check, redaction, HLC) and append to the log of this device. The writes of one workspace SHALL run one at a time. After each write, awd SHALL merge before it replies. When that merge or index write fails after the append, the reply SHALL be 500 `written_not_merged` with the path of the written file, so a client does not write it again; the next batch merges it.

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
- **THEN** `tasks/schemas/` has each file of `packages/schema/generated/schemas/`, byte for byte

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
awd SHALL write JSON log lines with pino to stderr, with a `trace_id` for each request, and SHALL redact the fields named like token, secret, key, cookie, password and authorization. The `node:sqlite` ExperimentalWarning SHALL NOT reach stderr; each other process warning SHALL go to the log.

#### Scenario: Redacted header
- **WHEN** a request has an `Authorization` header
- **THEN** the log line of the request has `[Redacted]` in place of its value

#### Scenario: SQLite warning
- **WHEN** Node emits the ExperimentalWarning "SQLite is an experimental feature"
- **THEN** the filter drops it, and an ExperimentalWarning with another text goes to the log

### Requirement: Service units
`aw service install` SHALL write a systemd user unit on Linux, a LaunchAgent on macOS, or a LaunchDaemon with `--headless` on macOS, each with a restart on exit and an exec-form start of awd, and SHALL load it with `systemctl --user` or `launchctl`. `--print` SHALL write the unit text to stdout and change nothing. `aw service uninstall` SHALL unload and remove the unit, and `aw service status` SHALL report whether it is installed and loaded. The LaunchDaemon SHALL run awd as the user that ran `sudo` (`SUDO_USER`), with the home folder of that user for `HOME`, the default `AW_HOME` and the log file; `aw service install --headless` SHALL refuse to run as root with no `SUDO_USER` or with `SUDO_USER=root`. The systemd unit uses `KillMode=control-group`, so a process that awd starts in its unit stops with awd; a session host must run in its own unit.

#### Scenario: systemd unit
- **WHEN** `aw service install --print` runs on Linux
- **THEN** the text has `Restart=always` and `ExecStart=` with the absolute Node path and the absolute awd entry path

#### Scenario: Headless Mac
- **WHEN** `sudo aw service install --headless --print` runs on macOS for the user `someone`
- **THEN** the plist has `KeepAlive` true, `AbandonProcessGroup` true, `UserName` `someone`, and `HOME` and the log path in the home folder of `someone`, never root

#### Scenario: Headless Mac with no sudo user
- **WHEN** root runs `aw service install --headless` with no `SUDO_USER`, or with `SUDO_USER=root`
- **THEN** `aw` exits with 2 and writes no unit
