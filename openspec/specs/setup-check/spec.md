# setup-check Specification

## Purpose
The setup check of a device: the doctor checks of awd with a fix for each failure, `GET /v1/doctor`, `aw doctor` and the desktop Setup check page.
## Requirements
### Requirement: Doctor checks
awd SHALL give the setup check of this device as a list of checks. Each check SHALL have `id`, `title`, `status` (`ok`, `warn`, `fail` or `skip`), `detail` and `fix` (a text, or null for `ok` and `skip`). The checks SHALL be: `service` (the unit is installed and loaded; on Linux also `loginctl` linger), `session_host` (tmux; Orca only when the bindings of this device ask for it), `agent` (the agent binary answers `--version`), `claude_login` (`claude auth status --json` in the context of awd), `disk` (the disk use of `AW_HOME`: warn from 90 %, fail from `AW_DISK_FULL_PERCENT`), `clock`, `sync_engine` (the engine state), one `device:<slug>` check for each peer of the sync engine (connected or not), and on macOS `sleep`, `autorestart` and `filevault`.

#### Scenario: Missing engine
- **WHEN** the engine binary does not exist
- **THEN** the `sync_engine` check is `fail` and its fix is `aw engine install`

#### Scenario: Peer not connected
- **WHEN** the peer `ubuntu-01` is not connected
- **THEN** the check `device:ubuntu-01` is `warn` and its fix names the device and the network

#### Scenario: Claude not signed in
- **WHEN** `claude auth status --json` gives `loggedIn: false`
- **THEN** the `claude_login` check is `fail` and its fix tells the person to run `claude` on this device and sign in

#### Scenario: Headless Mac sleeps
- **WHEN** the LaunchDaemon is installed and `pmset -g` gives `sleep 10`
- **THEN** the `sleep` check is `warn` and its fix is `sudo pmset -a sleep 0`

### Requirement: Doctor route and command
The local API SHALL have `GET /v1/doctor`, a person route, that runs the checks and replies `{device, checks, ok}`; `ok` is false when one check is `fail`. `aw doctor` SHALL print each check with its status and fix, and SHALL exit with 1 when a check failed. When awd is not reachable, `aw doctor` SHALL run the local checks (`service`, `session_host`, `sync_engine` from the binary, `disk`) and add a failed `awd` check with the fix `aw service install`.

#### Scenario: awd stopped
- **WHEN** `aw doctor` runs and awd does not answer on the socket
- **THEN** the output has the `awd` check with `fail` and the fix `aw service install`, and the exit code is 1

#### Scenario: Session caller
- **WHEN** an agent session calls `GET /v1/doctor`
- **THEN** the reply is 403 `refused`

### Requirement: Desktop setup check
The desktop app SHALL have a Setup check page (linked from Settings) that shows each check with its status, detail and fix, a "Check again" button, the Claude sign-in step and the text: "A plan has a 5-hour limit and a weekly limit. One agent that works day and night uses more than a Pro or Max plan gives. For heavy 24/7 work, use an API key."

#### Scenario: Failed check
- **WHEN** the doctor reply has the `sync_engine` check with `fail`
- **THEN** the page shows the check title, the status "Failed" and the fix text
