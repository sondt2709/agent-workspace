## MODIFIED Requirements

### Requirement: Phone screens
The Android app SHALL have the screens Home, Inbox, Tasks, Task detail, New task and Devices, from the phone's own Room index. Home SHALL show "Needs you" first, then the devices with their sync state and a "Sync now" button, then the working and paused tasks. Inbox SHALL be the Inbox of the desktop ("Inbox" of desktop-app): the tabs "Needs you" and "Updates", the same rows (the reason, the title, the key) and the same groups (Working now, Paused, Queued), from the rule `inboxItems` tested against `contracts/fixtures/inbox/items.json`. A tap on a row SHALL open the item screen: the title, the Activity row of each open gate (the question message with its option buttons and a reply field, the proposal card, or the gate card), the Assign card or the pause, and "Open task". Tasks SHALL group the tasks by stage (Backlog, Discuss, Ready, Implement, Review, Done) and SHALL show a "Paused" chip with the cause on a paused task and on a task whose session device is offline.

Task detail SHALL be the task page of the desktop ("Task detail" of desktop-app) with the same parts in the same order: a header with Back, the key, the project, the state chips, the need-you navigation ("<i> of <n> need you" with Previous and Next, in the Inbox order), "Show list" (only when the task page is 700 dp or wider), the actions menu, the title, and a stage progress bar of 6 segments with the stage name; then the tabs Activity (default), Session, Terminal and Properties. Activity has the gate cards, the description and the key activity. Session has the session summary and the raw thread. Terminal has the newest terminal snapshot. Properties has the fields, the proposal versions and the artifacts. From 1,000 dp of task page width, Properties SHALL show in a right panel of 280 dp and the tab row SHALL NOT have the Properties tab. The content of the tabs and the message box SHALL have a maximum width of 840 dp and SHALL be centred. The message box SHALL be below the Activity and Session tabs, with its label above the field and a Send button. The header SHALL scroll with the list, and the tab row SHALL stay at the top of the list, so a short window keeps the list. Each tab SHALL open at its top. Devices SHALL show each device with its role, its presence ("Last heartbeat 8 s ago", offline after 90 s), the sync state of its peer and, for this phone, the engine state and the battery warning for the mode "Restricted" with a link to the setting.

#### Scenario: Inbox row and item
- **WHEN** AW-12 has an open question with the options "100/min" and "1000/min", and AW-9 is working
- **THEN** the Inbox shows the row "Reply to a question · Rate limits for the public API · AW-12" and the group "Working now · 1"; a tap on the row shows the question message with the 2 buttons, a reply field and "Open task"

#### Scenario: Offline device
- **WHEN** the session device of a running task has no heartbeat for more than 90 s
- **THEN** Tasks shows the task with the chip "Paused: <device> offline", and its task detail has the action "Assign to another device…"

#### Scenario: Battery restricted
- **WHEN** the battery mode of the app is "Restricted"
- **THEN** Home and Devices show the warning and a button that opens the app settings

#### Scenario: A gate does not hide behind a tab
- **WHEN** AW-1 has an open gate and the person selects the Session, Terminal or Properties tab
- **THEN** the tab shows "1 item needs you" with "Show in Activity", and "Show in Activity" selects the Activity tab and shows the row of the gate

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

### Requirement: Phone gate cards with the full context
A gate card SHALL NOT show decisions, as on the desktop ("Gate cards with the full context" of desktop-app). A long gate text SHALL show its start and "Show more"; "Show more" SHALL show the full text in the list. The task detail SHALL have a Proposal section with each version and its state ("Approved", "Waits for you", "Replaced", as on the desktop); a version SHALL open to the full text of its synced file (`proposal/v<n>.md`, or `approach/v<n>.md` from before the rename). A resolved gate whose newest answer of this phone became a comment, and that the used answer of another device resolved, SHALL show a closed card in the task detail (a gate that a newer version replaced has no used answer and shows no card): "Your answer “X” came after the answer of <device>. It is a comment now." A resolved gate that AW closed with no answer of a person ("Session ended", or "Denied after <n> s") and whose newest answer of this phone became a comment SHALL show the closed card "Your answer “X” came after AW closed the gate: <answer>. It is a comment now."

#### Scenario: Old gate with decisions on the phone
- **WHEN** an open custom gate from before the rename has 2 decisions
- **THEN** the card shows its text and its options, and no decision picker

#### Scenario: Late answer
- **WHEN** the phone answered "Request changes" and ubuntu-01 resolved the gate with the answer "Approve" of macbook-pro
- **THEN** the task detail shows "Your answer “Request changes” came after the answer of macbook-pro. It is a comment now."

#### Scenario: Answer to a gate of an ended session
- **WHEN** the phone answered "Allow once" and the owner device closed the gate with "Session ended"
- **THEN** the gate leaves Needs you, and the task detail shows "Your answer “Allow once” came after AW closed the gate: Session ended. It is a comment now."

### Requirement: Phone task activity
The Activity tab of the phone SHALL be the Activity of the desktop ("Task activity" of desktop-app): the late answers, the Assign card and a pause first; then the first message once as the description, as Markdown; then the rows in merge order, oldest first, with the same 3 row styles (message, proposal card, task line), the same rule tested against the shared fixture `contracts/fixtures/activity/cases.json`, and the same rows left to Session. A question SHALL be an agent message with its options as buttons of 48 dp while the gate is open; an answer SHALL be a person message. Each message SHALL show as Markdown, as a line with a 2 dp coloured edge; a message longer than 6 lines SHALL show its first 6 lines and "Show more". A subagent report SHALL show as on the desktop, tested against `contracts/fixtures/activity/agent-message.json`. The proposal card, its full screen view and the text size SHALL follow "Proposal card", "Proposal in full screen" and "Proposal text size" of desktop-app; the phone SHALL save the size in the file `proposal-text-px` of its files folder, with the rule `ProposalTextSize` tested with `contracts/fixtures/gates/proposal-text-size.json`. The full screen view SHALL have Close in its top bar, and "Approve proposal" and "Discuss" at the bottom, above the system bar. The Session tab SHALL show the raw text.

#### Scenario: Activity of a task with a session
- **WHEN** the thread of AW-1 has `task.created`, `task.claimed`, `session.started`, a `message.human` with source `first`, a `message.agent`, a question gate and its answer
- **THEN** Activity shows the description once, "Created by human@macbook-pro", the agent message, the question as an agent message and the answer as a person message, and no claim, session, input or "… opened" row

#### Scenario: Stopped session on the phone
- **WHEN** the person stops the session of AW-1 on ubuntu-01
- **THEN** the phone Activity shows "Session stopped on ubuntu-01: a person stopped it or ended the agent. AW starts no new session until a person starts one."

#### Scenario: Long agent message
- **WHEN** an agent message has 9 lines
- **THEN** Activity shows its first 6 lines and "Show more", and "Show more" shows the 9 lines

#### Scenario: Subagent report on the phone
- **WHEN** the thread has the typed `message.human` of the subagent report fixture
- **THEN** the phone Activity shows "Subagent report · arrived in the terminal" and the report as Markdown

#### Scenario: Turn text on the phone
- **WHEN** the thread has `message.agent` with the source `turn` and `message.agent` "Tests pass" with the source `tool`
- **THEN** the phone Activity shows "Tests pass" only, and the Session view shows both

#### Scenario: Proposal on the phone
- **WHEN** the agent sent proposal v1 and then v2, and the person taps the full screen button and A+
- **THEN** Activity shows "Proposal v1 · replaced by v2" and the v2 card; the full screen view shows v2 at 18 dp, and the card uses 18 dp after Close
