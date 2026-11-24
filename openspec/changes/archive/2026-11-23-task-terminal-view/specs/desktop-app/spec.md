## ADDED Requirements

### Requirement: Terminal tab
The task detail SHALL have a Terminal tab next to the thread. It SHALL show the newest snapshot from the terminal route in a monospace block with its device and capture time, read again every 10 s, the empty text "No terminal snapshot yet" and the Orca note. It SHALL have the button "Open the terminal" while the task has a session. The cards of what needs the person (open gates, Assign, a pause) SHALL show above the Terminal tab too, so "Take over terminal" and "Sign in" stay in view.

#### Scenario: Snapshot shown
- **WHEN** the person opens the Terminal tab of AW-12 and ubuntu-01 wrote a snapshot
- **THEN** the tab shows the screen with `[redacted:<name>]` in place of the value, "ubuntu-01" and the capture time

### Requirement: Open the terminal and Sign in
The main process SHALL have the call `openTerminal {ws, task, action: "attach" | "sign_in"}`. It SHALL read the terminal route and use the target of the action. For a local `terminal` target it SHALL open Terminal.app through `/usr/bin/osascript` with the argv as separate arguments after the script (`on run argv`, `quoted form of` each argument), so no argument goes into the script text. For a local `orca` target it SHALL run `<orca> worktree activate --worktree path:<worktree> --json`. Each program SHALL start with `execFile` and no shell, through one adapter module. For a `copy` target it SHALL start nothing and return the command. The "Take over terminal" card SHALL have the button "Open the terminal" (action `attach`), and a `login_expired` pause SHALL have the button "Sign in" (action `sign_in`). The card SHALL show "Opened in Terminal", or "Run this command on <device>:" with the command and a Copy button.

#### Scenario: Local tmux session
- **WHEN** the person selects "Open the terminal" for a session in tmux on this Mac
- **THEN** the app runs `/usr/bin/osascript` with the script and the arguments `<tmux> -L aw attach -t aw:aw-<task>`, and shows "Opened in Terminal"

#### Scenario: Remote device
- **WHEN** the session runs on ubuntu-01
- **THEN** the app starts no program and shows `ssh -t ubuntu-01 tmux -L aw attach -t aw:aw-<task>` with a Copy button

#### Scenario: Local Orca session
- **WHEN** the session runs in Orca on this Mac
- **THEN** the app runs `<orca> worktree activate --worktree path:<worktree> --json`

#### Scenario: Sign in
- **WHEN** a task shows "Paused · login expired" for this Mac and the person selects "Sign in"
- **THEN** the app opens Terminal.app with `<claude> auth login`
