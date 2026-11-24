## ADDED Requirements

### Requirement: Snapshot file
The session device SHALL write the snapshot of the screen of a running tmux session to `tasks/<task>/terminal/<device>.txt` through `writeFile` of the files layer. The file SHALL start with one JSON header line `{"kind":"aw-terminal","v":1,"device","session","host","socket","window","captured_at"}` and a newline, followed by the visible screen of `capture-pane -p -J`. `captured_at` SHALL come from the clock module. A reader SHALL show a file with no valid header as text with no time. TypeScript and Kotlin SHALL parse the cases of `contracts/fixtures/terminal/cases.json` with the same result.

#### Scenario: Header and screen
- **WHEN** ubuntu-01 writes the snapshot of the session of AW-12 at 14:20:05 UTC
- **THEN** the first line of `tasks/<task>/terminal/ubuntu-01.txt` is the JSON header with `device: ubuntu-01`, `host: tmux` and `captured_at: 2026-11-23T14:20:05.000Z`, and the next lines are the screen

#### Scenario: File with no header
- **WHEN** a reader gets a snapshot file whose first line is not a valid header
- **THEN** it shows the full text with no device and no time

### Requirement: Snapshot write rule
At each watchdog check (every 30 s), awd SHALL write the snapshot of a running tmux session only when the hash of its screen changed since the last write and the last write is 30 s old or more. After each `gate.opened` of a task whose running session is on this device in tmux, awd SHALL write the snapshot at once, also when the screen did not change. An error of a gate write SHALL be logged and SHALL NOT fail the gate. awd SHALL write no snapshot of an Orca session.

#### Scenario: Screen changes
- **WHEN** the screen changed 30 s after the last write
- **THEN** awd writes a new snapshot

#### Scenario: Same screen
- **WHEN** the screen hash is the same as at the last write
- **THEN** the watchdog check writes nothing

#### Scenario: Gate open
- **WHEN** the agent opens "Answer question" 5 s after the last write
- **THEN** awd writes a new snapshot at once, with the time of the gate

#### Scenario: Orca session
- **WHEN** the session of the task runs in Orca
- **THEN** awd writes no snapshot

### Requirement: Redaction before the cut
The writer SHALL redact the full screen with the redaction of the files layer first. Then it SHALL keep the last 200 lines and at most 64 KiB, and cut only at the start of a line (a single longer line keeps its end).

#### Scenario: Value at the cut
- **WHEN** a credential value is on the line where the 200-line or the 64 KiB cut falls
- **THEN** the snapshot has no prefix of the value: it has `[redacted:<name>]` or no part of that line

### Requirement: Terminal view on the desktop and the phone
The desktop task detail SHALL have a Terminal tab, and the phone task detail SHALL have a Terminal section. Each SHALL show the newest snapshot of the task with its device and its capture time ("Captured 14:20 on ubuntu-01 · 3 min ago"), "No terminal snapshot yet" when there is none, and the note "AW does not read the screen of an Orca session" for an Orca session.

#### Scenario: Snapshot of a remote device
- **WHEN** the session of AW-12 runs on ubuntu-01 and its snapshot synced
- **THEN** the desktop and the phone show its text, "ubuntu-01" and the capture time

#### Scenario: No snapshot
- **WHEN** a task has no file in `terminal/`
- **THEN** the view shows "No terminal snapshot yet"
