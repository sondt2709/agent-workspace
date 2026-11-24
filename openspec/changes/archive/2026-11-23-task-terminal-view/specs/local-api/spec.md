## ADDED Requirements

### Requirement: Terminal route
`GET /v1/workspaces/{ws}/tasks/{task}/terminal` SHALL be a person route. It SHALL answer `{task, session, snapshot, note, open, sign_in}`. `session` SHALL be the session of the merged task view (`{session, device, host, state, local}`) or null. `snapshot` SHALL be the newest snapshot file of the task by `captured_at` (`{device, session, host, captured_at, text}`) or null. `note` SHALL say "AW does not read the screen of an Orca session. Open the Orca worktree aw-<task> on <device>." for an Orca session, "No terminal snapshot yet." with no snapshot, else null. `open` (the terminal of the session) and `sign_in` (`claude auth login` on the session device) SHALL each be null with no session, else a target: `{kind: "terminal", device, local: true, argv, command}` on this device, `{kind: "orca", device, local: true, orca, worktree, command}` for a local Orca session, and `{kind: "copy", device, local: false, command}` for another device. The tmux target SHALL be `-L <socket> attach -t aw:aw-<task>`; the command for another device SHALL start with `ssh -t <device>`, and its socket SHALL come from the newest snapshot of that device (default `aw`).

#### Scenario: Snapshot of another device
- **WHEN** the person asks for the terminal of AW-12 on macbook-pro, and the session runs on ubuntu-01
- **THEN** the reply has the snapshot of ubuntu-01 with its time, and `open.command` is `ssh -t ubuntu-01 tmux -L aw attach -t aw:aw-<task>`

#### Scenario: Local tmux session
- **WHEN** the session runs on this device in tmux
- **THEN** `open` has `local: true` and the argv `<tmux> -L <socket> attach -t aw:aw-<task>`, and `sign_in` has the argv `<claude> auth login`

#### Scenario: Orca session
- **WHEN** the session runs in Orca
- **THEN** `snapshot` is the newest older snapshot or null, and `note` says that AW does not read the screen of an Orca session

#### Scenario: Session caller
- **WHEN** a session caller sends `GET /v1/workspaces/-/tasks/AW-12/terminal`
- **THEN** awd answers 403 `refused`
