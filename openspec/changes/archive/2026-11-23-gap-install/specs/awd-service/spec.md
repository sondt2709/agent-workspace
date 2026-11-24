## MODIFIED Requirements

### Requirement: Logs
awd SHALL write JSON log lines with pino to stderr, with a `trace_id` for each request, and SHALL redact the fields named like token, secret, key, cookie, password and authorization. The `node:sqlite` ExperimentalWarning SHALL NOT reach stderr; each other process warning SHALL go to the log. awd SHALL check `<AW_HOME>/logs/awd.log` (the log file of the launchd unit) at start and every 5 minutes; above 10 MB it SHALL keep 3 old files (`awd.log.1` to `awd.log.3`), copy the file to `awd.log.1` and truncate it to 0 bytes, because launchd keeps the file open.

#### Scenario: Redacted header
- **WHEN** a request has an `Authorization` header
- **THEN** the log line of the request has `[Redacted]` in place of its value

#### Scenario: SQLite warning
- **WHEN** Node emits the ExperimentalWarning "SQLite is an experimental feature"
- **THEN** the filter drops it, and an ExperimentalWarning with another text goes to the log

#### Scenario: Large log
- **WHEN** `awd.log` has 11 MB and `awd.log.1` and `awd.log.2` exist
- **THEN** after the check `awd.log` has 0 bytes, `awd.log.1` has the 11 MB, and the old `.1` and `.2` are `.2` and `.3`

### Requirement: Service units
`aw service install` SHALL write a systemd user unit on Linux, a LaunchAgent on macOS, or a LaunchDaemon with `--headless` on macOS, each with a restart on exit and an exec-form start of awd, and SHALL load it with `systemctl --user` or `launchctl`. On Linux it SHALL also write the user unit `aw-sessions.service`, which runs the tmux server of the sessions in its own control group, never restarts it by itself, and does not stop it with awd. The LaunchAgent and the LaunchDaemon SHALL have `AbandonProcessGroup` true. `--print` SHALL write the unit text to stdout and change nothing. `aw service uninstall` SHALL unload and remove the units, and `aw service status` SHALL report whether the awd unit is installed and loaded. The LaunchDaemon SHALL run awd as the user that ran `sudo` (`SUDO_USER`), with the home folder of that user for `HOME`, the default `AW_HOME` and the log file, and with `AW_KEYSTORE=file`; `aw service install --headless` SHALL refuse to run as root with no `SUDO_USER` or with `SUDO_USER=root`. The awd systemd unit uses `KillMode=control-group`, so the tmux server runs in `aw-sessions.service`.

Before the unit, `aw service install` SHALL run the engine install (unless `--no-engine`); a failed engine install SHALL print a warning with the fix and SHALL NOT stop the unit install. When the engine is new, it SHALL restart awd after the load. When tmux is not found, it SHALL print the install command of the OS and continue. `aw service install --headless` SHALL refuse with exit code 1 when `<AW_HOME>` has `identity.yaml` or `config.yaml` and no `keys/device`, and the message SHALL name `aw service move-keys`. `aw service move-keys` SHALL refuse while awd answers on the socket, copy the device key and the recovery phrase from the OS keystore to `<AW_HOME>/keys/`, read them back, and then delete them from the OS keystore.

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
