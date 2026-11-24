# session-host-orca Specification

## Purpose
The Orca session host in `plugins/host-orca` (optional, off by default): detect, the 2-step open in an Orca worktree, input with `terminal send`, the state from `terminal show`, the stop of a process group, and the fake Orca CLI of the tests.
## Requirements
### Requirement: Orca detection
The Orca host SHALL look for the Orca CLI in this order: `AW_ORCA`, `/Applications/Orca.app/Contents/Resources/bin/orca` on macOS, `orca-ide` in `PATH`, `orca` in `PATH`. It SHALL take the first binary whose `--version` starts its first line with a version `x.y.z` and whose `status --json` gives `ok: true`, `runtime.state: "ready"` and `runtime.reachable: true`. The host SHALL be available only when that version is 1.4.257 or later. It SHALL store the full path of the binary and give the cause when it is not available. The input text in the argv of the Orca CLI is an exception of `docs/engineering-rules.md` 12 that a maintainer approved for phase 1: the host SHALL need no setting for it.

#### Scenario: Version too old
- **WHEN** the Orca CLI gives the version 1.4.200 and a ready runtime
- **THEN** `detect()` gives `available: false`, the full path, the version and a cause that names 1.4.257

#### Scenario: Runtime not running
- **WHEN** `status --json` gives the error `runtime_unavailable`
- **THEN** `detect()` gives `available: false` and the cause from the error message

#### Scenario: A screen reader called orca
- **WHEN** the first `orca` in `PATH` gives no version `x.y.z`
- **THEN** the host does not use it

#### Scenario: Prerelease version
- **WHEN** `--version` gives `1.4.300-beta.2` and a warning line after it
- **THEN** the version is 1.4.300

#### Scenario: Text in the argv with no setting
- **WHEN** awd has no Orca setting, and the Orca CLI 1.4.257 is ready
- **THEN** `detect()` gives `available: true`, and `submit()` sends the text

### Requirement: Two-step open in an Orca worktree
The host SHALL make the working folder with `worktree()`: it SHALL reuse the Orca worktree `aw-<task-id>` of the same repo when git has the branch of the task checked out there (another branch SHALL give `branch_changed`), else add the checkout with `repo add` when Orca does not know it, run `worktree create --name aw-<task-id> --repo id:<repo> --branch <branch> --no-parent --setup skip --json` (with `--base-branch <branch>` when the branch exists), and close the first terminal of the new worktree. When that close fails, `worktree()` SHALL fail, and the next `worktree()` that reuses that worktree SHALL close its first terminal before it returns. When the branch is checked out in another folder, Orca would make a new branch `<branch>-2`: the host SHALL refuse with `branch_in_use` and make no worktree. `open()` SHALL run `terminal create --worktree path:<worktree path> --title aw-<task-id> --command "exec env AW_NODE='<node>' AW_HOME='<home>' '<aw-launch>' <session>" --json` and return the handle, the worktree id, the pid, the process group (the same pid) and the incarnation id. The command SHALL hold no message, no user text and no token. aw-launch SHALL give the agent in Orca the same environment as in tmux from the launch file and `AW_HOME`: `AW_MCP_URL`, `AW_MCP_TOKEN` and `AW_CREDENTIALS_DIR`. A path with a single quote SHALL be refused.

#### Scenario: Unknown repo
- **WHEN** Orca does not know the checkout and AW opens a session
- **THEN** the host runs `repo add --path <checkout>` before `worktree create`, and the session runs in the Orca worktree

#### Scenario: Branch in another folder
- **WHEN** the branch `aw/AW-10` is checked out in a git worktree of the tmux host and the host makes the Orca worktree for it
- **THEN** `worktree()` throws `branch_in_use`, and no branch `aw/AW-10-2` exists

#### Scenario: Orca worktree on another branch
- **WHEN** a person checked out another branch in the Orca worktree `aw-<task-id>` and AW starts a session of the task
- **THEN** `worktree()` throws `branch_changed`, and no agent runs on that branch

#### Scenario: Command of the terminal
- **WHEN** the host opens a session whose first message is "Fix the flaky test"
- **THEN** the `--command` value starts with `exec env`, names aw-launch and the session id, and does not hold the first message

#### Scenario: MCP and credentials in Orca
- **WHEN** a task with the credential `stripe-test` starts in Orca and its agent calls the MCP tool `stage`
- **THEN** the tool works, the credential file is in `AW_CREDENTIALS_DIR` with the mode 0600, and no command line of the device has the token or the value

### Requirement: Orca terminal state
`find(ref)` SHALL read `terminal show --terminal <handle> --json` with a time limit of 5 s, and SHALL never read the screen. A terminal SHALL be live when `connected` is true and its `incarnationId` is the stored one. A terminal with `connected: false` SHALL be dead, with the exit code, or 128 + the signal, as its status. The error `terminal_handle_stale` SHALL give no terminal. Each other failure, `runtime_unavailable` too, SHALL throw, so the manager does not resume a session while Orca does not answer. `capture()` SHALL give an empty text, and `readsScreen` SHALL be false.

#### Scenario: Orca runtime stopped
- **WHEN** the Orca runtime does not run and the manager checks a running session
- **THEN** `find()` throws, and the manager neither resumes nor stops the session

#### Scenario: Killed terminal
- **WHEN** the agent of a terminal ends with SIGTERM
- **THEN** `find()` gives the terminal as dead with the status 143

### Requirement: Orca input
`submit(ref, text)` SHALL send the text with `terminal send --terminal <handle> --text <text> --enter --wait-submit 10 --json`. After a failure whose error has `orchestrationRequestId` and whose code is not `terminal_handle_stale`, `request_mismatch`, `invalid_argument` or `runtime_unavailable`, the host SHALL keep the id, and the next submit of the same text to the same terminal SHALL use `--retry-request <id>` (`terminal_not_writable` too: its reply says to re-issue the command with that id). A text of more than 100 KiB in UTF-8 SHALL be refused with `text_too_large` and not sent. One send SHALL have a time limit of 15 s. `paste()` and `keys()` SHALL throw.

#### Scenario: Ambiguous failure
- **WHEN** a send fails with an error that has a request id and the code `transport_timeout`
- **THEN** the next submit of the same text runs `terminal send` with `--retry-request <id>`

#### Scenario: Terminal not writable
- **WHEN** a send fails with `terminal_not_writable` and a request id
- **THEN** the next submit of the same text uses `--retry-request` with that id

### Requirement: Orca reply parsing
The Orca CLI adapter SHALL parse each reply into a declared zod schema: the envelope, and the `result` fields that AW reads of each command. A reply that does not match SHALL throw `OrcaError` with the code `bad_reply` and the path of the first field that does not match.

#### Scenario: Changed reply
- **WHEN** `terminal create` gives `processId` as a text
- **THEN** the call throws `bad_reply` that names `terminal.processId`

### Requirement: Orca stop
`stop(ref)` SHALL signal only when `find()` gives the stored incarnation and the process table has the stored pid in the stored process group. For a live terminal it SHALL send SIGTERM to the group, SIGKILL after the grace time, then SIGKILL to each remaining descendant from the table read before the first signal. For a dead terminal it SHALL signal only the members of the group that started after `opened`. `close(ref)` SHALL run `terminal close --terminal <handle> --json`.

#### Scenario: Background command in Orca
- **WHEN** the agent of an Orca terminal started a background command and AW stops the session
- **THEN** no process of the group is left, and the terminal is closed

#### Scenario: Another incarnation
- **WHEN** `terminal show` gives another `incarnationId` than the stored one
- **THEN** the stop signals nothing

### Requirement: Fake Orca CLI
`@aw/host-orca/testing` SHALL have a fake Orca CLI that prints the JSON shape of the captured replies of `orca-ide` 1.4.257, keeps its state in `FAKE_ORCA_STATE`, makes worktrees with `git worktree add`, and runs each terminal in a private tmux server. Each fixture SHALL name where and when it was captured, with paths, host names and ids removed.

#### Scenario: Same flow as Orca
- **WHEN** the session e2e test runs with the fake Orca CLI
- **THEN** a session starts in a fake Orca terminal, gets an answer through `terminal send`, and stops by its process group
