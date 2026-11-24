## MODIFIED Requirements

### Requirement: Task detail
The task detail SHALL show a header with the key, the project, the state chips, a stage progress bar of 6 segments with the stage name, and the title. It SHALL have the tabs Activity (default), Session, Terminal and Files. When the task detail itself is narrower than 1,000 px, it SHALL also have the tab Properties; from 1,000 px the properties SHALL show in a right panel next to the tabs. The width SHALL be the width of the task detail, not of the window, so the board split uses the narrow layout when its panel is narrow. The task route SHALL show a Back button, and the board split SHALL show a Close button. Each task SHALL open on the Activity tab, also when the person opens another task from a task.

The properties SHALL be read-only: the stage, the assignee with New session, the project, the approach versions (latest and confirmed), the test server, the credential names, the queue, the parent, the subtasks and the dependencies, and the progress. The properties SHALL NOT show the first message, the session or the task id.

The Session tab SHALL show the session summary (the state, the device, the host, the claim epoch, the session id, the branch, the task id, and Stop session for a running session of this device), then the raw thread: each event of the thread window with its text, each message with its raw text, "Show older", and the original conversation of the ancestors. The Session tab SHALL show a row for each event type, also for an unknown type (principle 8). The Files tab SHALL show the read-only folder of the task and the text of a selected file.

Each open gate SHALL show as a gate card: Answer question and Reply (options and free text), Confirm approach and Approve result (confirm or approve, or request changes with a required comment), Assign task (an `agent@device` choice), Approve command (Allow once, Allow for this task, Deny, a countdown from 120 s), Fix a file (its options), and other kinds with their options. The Markdown text of a gate card SHALL have a maximum height of half the window with its own scroll. A message box SHALL send a message to the running session. It SHALL stay at the bottom of the Activity and Session tabs, outside the scroll area.

#### Scenario: Approve command countdown
- **WHEN** an Approve command gate opened 30 s ago
- **THEN** the card shows "Denies in 90 s"; after 120 s it shows "Denied after 120 s" and a late "Allow once" still sends an answer

#### Scenario: Request changes needs a comment
- **WHEN** the person selects "Request changes" on Confirm approach with an empty comment
- **THEN** the send button is disabled

#### Scenario: Session tab keeps each event
- **WHEN** the thread has one event of each type of `contracts/samples/schema-samples.json` and one unknown type
- **THEN** the Session tab shows one row with text for each event

#### Scenario: Another task opens on Activity
- **WHEN** the person views the Files tab of AW-8 and opens AW-9
- **THEN** AW-9 shows the Activity tab

#### Scenario: Narrow task detail
- **WHEN** the task detail is 700 px wide in the board split of a 1280 px window
- **THEN** the task detail shows the tabs Activity, Session, Terminal, Files and Properties, and no right panel

### Requirement: Terminal tab
The task detail SHALL have a Terminal tab. It SHALL show the newest snapshot from the terminal route in a monospace block with its device and capture time, read again every 10 s, the empty text "No terminal snapshot yet" and the Orca note. It SHALL have the button "Open the terminal" while the task has a session. Above the snapshot, the tab SHALL show only the cards that act on the terminal: an open "Take over terminal" gate and a `login_expired` pause with "Sign in". When other items need the person, the tab SHALL show one line "<n> items need you" with the button "Show in Activity", which opens the Activity tab.

#### Scenario: Snapshot shown
- **WHEN** the person opens the Terminal tab of AW-12 and ubuntu-01 wrote a snapshot
- **THEN** the tab shows the screen with `[redacted:<name>]` in place of the value, "ubuntu-01" and the capture time

#### Scenario: Other gates as one line
- **WHEN** AW-12 has an open Answer question gate and the person opens the Terminal tab
- **THEN** the tab shows "1 item needs you" with "Show in Activity" and no gate card

## ADDED Requirements

### Requirement: Task activity
The Activity tab SHALL show the open gate cards, the Assign card and a pause first; then the first message once as the description, as Markdown with raw HTML off, with a "Show raw" switch that shows the exact text; then the activity rows in merge order. One table SHALL decide for each event type if it shows in Activity, with an entry for each type of the contract. Activity SHALL show `task.created` (as "Created by <by>", without the text), `task.assigned`, `task.rekeyed`, `task.edited`, `task.stage_changed`, `task.paused`, `task.resumed`, `task.done`, `task.archived`, `task.learned`, `message.agent`, `message.sent`, `comment.added`, `gate.opened`, `gate.answered`, `approach.proposed`, `result.posted` and `artifact.added`. It SHALL show a `message.human` only with the source `typed` or `phone` and no `delivery_id` (text that the person typed in the terminal). It SHALL NOT show the other types, a `message.human` that repeats a message, an answer, a notice or the first message, or an unknown type: these show in the Session tab. An agent message longer than 6 lines SHALL show its first 6 lines and "Show more".

#### Scenario: First message once
- **WHEN** the person opens a task whose thread has `task.created`, `task.claimed`, `session.started` and a `message.human` with source `first`
- **THEN** Activity shows the first message once as the description, the line "Created by human@macbook-pro", and no claim, session or input row

#### Scenario: Message from the terminal
- **WHEN** the thread has a `message.human` with source `typed` and no `delivery_id`
- **THEN** Activity shows its raw text as a message of the person

#### Scenario: Show raw
- **WHEN** the first message is "# Plan\n\nUse **cents**." and the person turns on "Show raw"
- **THEN** the description shows the exact text "# Plan\n\nUse **cents**."
