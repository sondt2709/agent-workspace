## MODIFIED Requirements

### Requirement: Phone screens
The Android app SHALL have the screens Home, Inbox, Tasks, Task detail, New task and Devices, from the phone's own Room index. Home SHALL show "Needs you" first, then the devices with their sync state and a "Sync now" button, then the working and paused tasks. Inbox SHALL list each task in the "Needs you" lane with its gate cards, which the human answers in place. Tasks SHALL group the tasks by stage (Backlog, Discuss, Ready, Implement, Review, Done) and SHALL show a "Paused" chip with the cause on a paused task and on a task whose session device is offline.

Task detail SHALL be the task page of the desktop ("Task detail" of desktop-app) with the same parts in the same order: a header with Back, the key, the project, the state chips, the need-you navigation ("<i> of <n> need you" with Previous and Next, in the Inbox order), "Show list" (only when the task page is 700 dp or wider), the actions menu, the title, and a stage progress bar of 6 segments with the stage name; then the tabs Activity (default), Session, Terminal and Properties. Activity has the gate cards, the description and the key activity. Session has the session summary and the raw thread. Terminal has the newest terminal snapshot. Properties has the fields, the approach versions and the artifacts. From 1,000 dp of task page width, Properties SHALL show in a right panel of 280 dp and the tab row SHALL NOT have the Properties tab. The content of the tabs and the message box SHALL have a maximum width of 840 dp and SHALL be centred. The message box SHALL be below the Activity and Session tabs, with its label above the field and a Send button. The header SHALL scroll with the list, and the tab row SHALL stay at the top of the list, so a short window keeps the list. Each tab SHALL open at its top. Devices SHALL show each device with its role, its presence ("Last heartbeat 8 s ago", offline after 90 s), the sync state of its peer and, for this phone, the engine state and the battery warning for the mode "Restricted" with a link to the setting.

#### Scenario: Gate card in the Inbox
- **WHEN** a task has an open "Answer question" gate with the options "100/min" and "1000/min"
- **THEN** the Inbox shows the task with one button per option and a free-text answer

#### Scenario: Offline device
- **WHEN** the session device of a running task has no heartbeat for more than 90 s
- **THEN** Tasks shows the task with the chip "Paused: <device> offline", and its task detail has the action "Assign to another device…"

#### Scenario: Battery restricted
- **WHEN** the battery mode of the app is "Restricted"
- **THEN** Home and Devices show the warning and a button that opens the app settings

#### Scenario: A gate does not hide behind a tab
- **WHEN** AW-1 has an open gate and the person selects the Session, Terminal or Properties tab
- **THEN** the tab shows "1 item needs you" with "Show in Activity", and "Show in Activity" selects the Activity tab with the gate card

#### Scenario: An answered gate waits for the owner
- **WHEN** the person answered the open gate of AW-1 on the phone and the owner device did not resolve it yet
- **THEN** the Session, Terminal and Properties tabs show no "items need you" line for that gate

#### Scenario: Another task opens on Activity
- **WHEN** the person selected the Session tab of AW-1 and opens AW-2
- **THEN** the task detail of AW-2 shows the Activity tab

#### Scenario: Same header as the desktop
- **WHEN** AW-1 and AW-4 need the person and the person opens AW-1 on a 412 dp phone
- **THEN** the header shows Back, "AW-1", the project, the state chip, "1 of 2 need you" with Previous and Next, the title and the stage bar, and no "Show list"

#### Scenario: Properties panel on a wide window
- **WHEN** the task page is 1220 dp wide on a DeX window
- **THEN** the properties show in a right panel, the tab row is Activity, Session and Terminal, and the Activity content is 840 dp wide and centred

### Requirement: Adaptive layout
The app SHALL select the navigation from the window width class only: compact (< 600 dp) a bottom bar; medium (600 to 839 dp) and expanded (840 to 1199 dp) a rail; large (1200 dp and more) a navigation drawer. Inbox and Tasks SHALL show 1 pane on a compact window and their list with a detail placeholder from medium width. A task SHALL open as the task page in one pane at each width: it SHALL NOT share the window with the task list or a Session pane. The task list SHALL show inside the task page only when the person selects "Show list" and the task page is 700 dp or wider. While the keyboard is open, the message box and the focused field SHALL stay above the keyboard, and on a compact window the bottom bar SHALL hide. AW SHALL own one back stack, so a fold, an unfold or a resize keeps the open item. The manifest SHALL set no orientation, keep `resizeableActivity` at its default, declare the touch screen as not required and set the `configChanges` of `docs/phase-1.md` 10.9.

#### Scenario: Unfold keeps the task
- **WHEN** a task is open on a 360 dp window and the window becomes 840 dp
- **THEN** the same task shows as the task page in one pane

#### Scenario: Width classes
- **WHEN** the window is 599, 600, 839, 840, 1199 or 1200 dp wide
- **THEN** the width class is compact, medium, medium, expanded, expanded or large

#### Scenario: Task on a Fold inner screen
- **WHEN** a task is open on an 840 dp window
- **THEN** the task page uses the full width next to the rail, and no task list shows until the person selects "Show list"

#### Scenario: Keyboard on the phone
- **WHEN** the person taps the message box of AW-1 on a 412 dp phone
- **THEN** the message box shows directly above the keyboard, and the bottom bar hides until the keyboard closes

### Requirement: Phone gate cards with the full context
A gate card SHALL show each decision of `gate.opened` `data.decisions` with its question, its options and the recommended option marked "Recommended", and SHALL cut the text at the last `\n\n## Decisions\n` when `data.decisions` is not empty. The decisions SHALL follow the rule of the desktop ("Gate cards with the full context" of desktop-app): radio groups with the recommended option picked when the gate has the option "Request changes", the main button "Send my choices" when a pick differs, and the same answer and comment (`GateTexts.decisionsAnswer`, tested against the TypeScript cases). Each decision option SHALL be a row of 48 dp. A long gate text SHALL show its start and "Show more"; "Show more" SHALL show the full text in the list. The task detail SHALL have an Approach section with each version and its state ("Confirmed", "Waits for you", "Replaced", as on the desktop); a version SHALL open to the full text of its synced file. A resolved gate whose newest answer of this phone became a comment, and that the used answer of another device resolved, SHALL show a closed card in the task detail (a gate that a newer version replaced has no used answer and shows no card): "Your answer “X” came after the answer of <device>. It is a comment now." A resolved gate that AW closed with no answer of a person ("Session ended", or "Denied after <n> s") and whose newest answer of this phone became a comment SHALL show the closed card "Your answer “X” came after AW closed the gate: <answer>. It is a comment now."

#### Scenario: Decisions on the phone
- **WHEN** the "Confirm approach" card of AW-12 has 2 decisions
- **THEN** the card shows both as radio groups with the recommended options picked and marked, the button "Confirm", and no "## Decisions" text block

#### Scenario: Send my choices on the phone
- **WHEN** the person picks the other option of the second decision and taps "Send my choices"
- **THEN** the phone sends "Request changes" with the same comment as the desktop for the same picks

#### Scenario: Late answer
- **WHEN** the phone answered "Request changes" and ubuntu-01 resolved the gate with the answer "Confirm" of macbook-pro
- **THEN** the task detail shows "Your answer “Request changes” came after the answer of macbook-pro. It is a comment now."

#### Scenario: Answer to a gate of an ended session
- **WHEN** the phone answered "Allow once" and the owner device closed the gate with "Session ended"
- **THEN** the gate leaves Needs you, and the task detail shows "Your answer “Allow once” came after AW closed the gate: Session ended. It is a comment now."

### Requirement: Phone task activity
The Activity tab of the phone SHALL show the open gate cards, the late answers and the Assign card first; then the first message once as the description, as Markdown; then the activity rows in merge order. The phone SHALL use the Activity rule of the desktop ("Task activity" of desktop-app): one table with an entry for each event type of the contract, tested against the shared fixture `contracts/fixtures/activity/cases.json`, with the same `message.human` rule and the same `session.ended` lines. `task.created` SHALL show as "Created by <by>". An agent message and a person message SHALL show as Markdown; a message longer than 6 lines SHALL show its first 6 lines and "Show more". A subagent report SHALL show as on the desktop, tested against `contracts/fixtures/activity/agent-message.json`. A message row SHALL be a line with a 2 dp coloured edge, as on the desktop, and not a filled card. The Session tab SHALL show the raw text.

#### Scenario: Activity of a task with a session
- **WHEN** the thread of AW-1 has `task.created`, `task.claimed`, `session.started`, a `message.human` with source `first`, a `message.agent`, a `gate.opened` and a `gate.answered`
- **THEN** Activity shows the description once, "Created by human@macbook-pro", the agent message, the gate and the answer, and no claim, session or input row

#### Scenario: Stopped session on the phone
- **WHEN** the person stops the session of AW-1 on ubuntu-01
- **THEN** the phone Activity shows "Session stopped on ubuntu-01: a person stopped it or ended the agent. AW starts no new session until a person starts one."

#### Scenario: Long agent message
- **WHEN** an agent message has 9 lines
- **THEN** Activity shows its first 6 lines and "Show more", and "Show more" shows the 9 lines

#### Scenario: Subagent report on the phone
- **WHEN** the thread has the typed `message.human` of the subagent report fixture
- **THEN** the phone Activity shows "Subagent report · arrived in the terminal" and the report as Markdown
