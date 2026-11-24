## MODIFIED Requirements

### Requirement: Settings module
awd and `aw` SHALL read the environment only in `daemon/src/settings.ts`. `AW_HOME` SHALL select the state folder (default `~/.aw`), and `AW_LOG_LEVEL` the log level (default `info`). `AW_TMUX` SHALL select the tmux binary, `AW_TMUX_SOCKET` the tmux socket name (default `aw`), `AW_CLAUDE` the agent binary (default `claude` in `PATH`) and `AW_CLAUDE_MODEL` an optional `--model` value. `AW_SESSION`, `AW_TASK` and `AW_WORKSPACE` SHALL give the session of the agent commands.

#### Scenario: State folder for tests
- **WHEN** awd starts with `AW_HOME=/tmp/x`
- **THEN** it uses `/tmp/x/run/awd.sock`, `/tmp/x/config.yaml` and `/tmp/x/index/`, and it does not create `~/.aw`

#### Scenario: Fake agent
- **WHEN** awd starts with `AW_CLAUDE=<path of the fake agent>`
- **THEN** each session runs that binary

### Requirement: Service units
`aw service install` SHALL write a systemd user unit on Linux, a LaunchAgent on macOS, or a LaunchDaemon with `--headless` on macOS, each with a restart on exit and an exec-form start of awd, and SHALL load it with `systemctl --user` or `launchctl`. On Linux it SHALL also write the user unit `aw-sessions.service`, which runs the tmux server of the sessions in its own control group, never restarts it by itself, and does not stop it with awd. The LaunchAgent and the LaunchDaemon SHALL have `AbandonProcessGroup` true. `--print` SHALL write the unit text to stdout and change nothing. `aw service uninstall` SHALL unload and remove the units, and `aw service status` SHALL report whether the awd unit is installed and loaded. The LaunchDaemon SHALL run awd as the user that ran `sudo` (`SUDO_USER`), with the home folder of that user for `HOME`, the default `AW_HOME` and the log file; `aw service install --headless` SHALL refuse to run as root with no `SUDO_USER` or with `SUDO_USER=root`. The awd systemd unit uses `KillMode=control-group`, so the tmux server runs in `aw-sessions.service`.

#### Scenario: systemd unit
- **WHEN** `aw service install --print` runs on Linux
- **THEN** the text has `Restart=always` and `ExecStart=` with the absolute Node path and the absolute awd entry path

#### Scenario: Sessions unit
- **WHEN** `aw service install` runs on Linux
- **THEN** it writes `aw-sessions.service` with `Type=forking`, an `ExecStart=` of tmux with the AW socket and config, `Restart=no`, and `KillMode=process`

#### Scenario: Headless Mac
- **WHEN** `sudo aw service install --headless --print` runs on macOS for the user `someone`
- **THEN** the plist has `KeepAlive` true, `AbandonProcessGroup` true, `UserName` `someone`, and `HOME` and the log path in the home folder of `someone`, never root

#### Scenario: Headless Mac with no sudo user
- **WHEN** root runs `aw service install --headless` with no `SUDO_USER`, or with `SUDO_USER=root`
- **THEN** `aw` exits with 2 and writes no unit

## ADDED Requirements

### Requirement: Session manager at start
After it opened a workspace, awd SHALL start the session manager of that workspace: reconcile the session records with the tmux panes, drain each spool, deliver the missed answers, and run the claim check. When tmux or the agent binary is missing, awd SHALL look for them again every 60 s and start the manager when both answer, with no restart of awd, and each open task of `claude@<this device>` with no claim SHALL get one comment "AW cannot start a session" with the cause. On stop, awd SHALL stop the manager and SHALL NOT stop a session.

#### Scenario: awd stops
- **WHEN** awd gets SIGTERM while a session runs
- **THEN** the tmux window still runs the agent

#### Scenario: Agent installed after the start
- **WHEN** `claude --version` fails at the start of awd, a task is assigned to `claude@<this device>`, and later the binary answers
- **THEN** the task has one comment "AW cannot start a session", and its session starts with no restart of awd
