## Context

`docs/phase-1.md` 3.1 lists `tasks/<task-id>/terminal/<device>.txt` ("last terminal lines, at most once per 30 s and at each gate"), and the files layer already redacts this path (`task-terminal` rule). No code writes it. The watchdog of the session manager already reads the visible screen of each tmux session every 30 s (`capture-pane -p -J`) and keeps its hash. AW never reads the screen of an Orca session (9.9.4). Every gate of a session goes through `EventBuffer.now()`. The desktop main process is the only place that can open a window on the person's screen: awd can run as a LaunchDaemon with no GUI session.

The review of credential-redaction found 2 more gaps: some writers cut agent text before the redaction (fix list 0-41), and the files layer writes terminal bytes with an invalid UTF-8 byte unredacted (finding 4). Both are proven on the base commit (`base-cut-29c1ec2.log`, `base-terminal-bytes-29c1ec2.log`).

## Goals / Non-Goals

**Goals:**
- A snapshot of each tmux session screen, synced to each device, with its device and capture time.
- The desktop and the phone show it. The desktop opens the terminal of a local session and gives the command for a remote one. "Sign in" for `login_expired`.
- No cut of agent text before the redaction.

**Non-Goals:**
- The live terminal and the takeover over the network (N6), input from the phone into the terminal.
- A screen read of Orca sessions (Orca input, open question Q2).
- Thread paging (0-7) and the full gate context (0-20, task gate-full-context).

## Decisions

1. **File format: one JSON header line, then the screen.** `{"kind":"aw-terminal","v":1,"device":"ubuntu-01","session":"<id>","host":"tmux","socket":"aw","window":"aw-<task>","captured_at":"<ISO>"}` and `\n`, then the screen text. The time comes from the clock module (testable), and TypeScript and Kotlin parse one line. Alternative: the file mtime (Syncthing keeps it), rejected: wall time outside the clock module, and no session or socket. A file with no valid header is shown with no time. `contracts/fixtures/terminal/cases.json` holds parse cases that both languages run.
2. **Write rule.** A periodic write needs a screen hash change since the last write and 30 s since the last write; it runs in the watchdog check (every 30 s). A gate write runs at once after each `gate.opened` of a task with a running tmux session on this device, also when the screen did not change, so the time shows when AW looked. `TerminalSnapshots` is a small class in `daemon/src/sessions/terminal-snapshot.ts` with the rule, the text builder and the parser; the manager calls it. `EventBuffer` gets an optional `afterWrite(task, type)` hook; an error of the hook is logged and never fails the event.
3. **Redact, then cut.** The writer redacts the full screen with `files.redactText`, then keeps the last 200 lines and at most 64 KiB (UTF-8), cutting at a line start; then `writeFile` redacts again (no change). The same order applies to the long message preview (`buffer.ts`), the gate text and title of `approach`, `gate` and `result` (`loop/agent.ts`), the permission gate summary (`toolSummary` takes a redact function) and the watchdog line (the manager passes the redacted screen).
4. **Terminal bytes.** For the `task-terminal` rule, the files layer decodes a byte array with replacement characters and always redacts it. A snapshot is always text.
5. **Route.** `GET /v1/workspaces/{ws}/tasks/{task}/terminal` (person) answers `{task, session, snapshot, note, open, sign_in}`. `snapshot` is the newest file of `tasks/<task>/terminal/` by `captured_at`. `note` explains an Orca session or no snapshot. `open` and `sign_in` are targets: `{kind: "terminal", device, local: true, argv, command}` for this device (absolute tmux binary of awd, `-L <socket> attach -t aw:aw-<task>`; `claude auth login` with `AW_CLAUDE`), `{kind: "orca", device, local: true, orca, worktree, command}` for a local Orca session, `{kind: "copy", device, local: false, command}` for another device (`ssh -t <device> tmux -L <socket> attach -t aw:aw-<task>`, with the socket of its newest snapshot, default `aw`; `ssh -t <device> claude auth login`). An Orca session on another device has `command: null` and the text "Open the Orca worktree aw-<task> on <device>". The service code is shared by the route and `aw terminal`.
6. **Desktop launch adapter.** `desktop/src/main/terminal.ts` holds the one adapter for local programs (`TerminalLauncher`) and the logic `openTerminal(ws, task, action)`. Terminal.app: `/usr/bin/osascript -e 'on run argv' … 'do script cmd' … -- <argv>`; the script builds the command from `quoted form of` each argument, so no argument goes into a script string. Orca: `<orca> worktree activate --worktree path:<worktree> --json`. Both run with `execFile` (no shell). The renderer shows the result: "Opened in Terminal" or the command with a Copy button. Tests use a fake launcher and check the exact arguments.
7. **Phone.** `android/control` `TerminalPane.read(files, task, now)` lists `tasks/<task>/terminal/`, parses each file and gives the newest with "Captured 14:20 on ubuntu-01 · 3 min ago", an empty text, or the Orca note. The task detail reads it again at each model reload (index refresh), so a synced snapshot shows without an event.
8. **CLI.** `aw terminal <task>` prints the header and the text, or the note. It is a person command, refused in a session (403 from the route).

## Risks / Trade-offs

- [A value that Claude Code wraps inside a box is split over 2 screen lines; the redactor finds only a full value] → `-J` joins the tmux wraps; a TUI wrap stays a known limit (open issue). The snapshot shows only the visible screen.
- [Many gates in one second write many snapshots] → each is a small file; a gate burst is rare.
- [The argv of `open` comes from awd] → the socket is 0600 and only the person's processes reach it; the app runs the argv only for this device; the session caller cannot read the route.
- [`tmux attach` from Terminal.app changes the window size of the agent] → expected for a takeover.
- [The ssh host of a remote device is its slug] → the person's ssh config must have that host; the text shows the command so the person can change it.

## Migration Plan

No migration: a new file, a new route and new UI. Rollback: revert the commit; old snapshot files stay as plain text files.

## Open Questions

- Orca input and screen (Q2, owner).
