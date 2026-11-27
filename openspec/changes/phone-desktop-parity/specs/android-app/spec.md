## MODIFIED Requirements

### Requirement: Phone screens
The Android app SHALL have the screens Home, Inbox, Tasks, Task detail, New task and Devices, from the phone's own Room index. Home SHALL show "Needs you" first, then the devices with their sync state and a "Sync now" button, then the working and paused tasks. Inbox SHALL be the Inbox of the desktop ("Inbox" of desktop-app): the tabs "Needs you" and "Updates", the same rows (the reason, the title, the key) and the same groups (Working now, Paused, Queued), from the rule `inboxItems` tested against `contracts/fixtures/inbox/items.json`. A tap on a row SHALL open the item screen: the title, the Activity row of each open gate (the question message with its option buttons and a reply field, the proposal card, or the gate card), the Assign card or the pause, and "Open task". Tasks SHALL group the tasks by stage (Backlog, Discuss, Ready, Implement, Review, Done), then "Archived" closed at the start, and SHALL NOT show a stage group with no task. A group header SHALL show the group name and the count in `text2` on the `canvas` color. A task row SHALL show the status icon of its group, the key in the monospace font, the title on one line, and one wrapping line with the chips (the reason that needs the person, "Running", a "Paused" chip with the cause on a paused task and on a task whose session device is offline), the queue text, and "<assignee> · <age>".

Task detail SHALL be the task page of the desktop ("Task detail" of desktop-app) with the same parts in the same order: a header with Back, the key, the project, the state chips, the need-you navigation ("<i> of <n> need you" with Previous and Next, in the Inbox order), "Show list" (only when the task page is 700 dp or wider and does not show next to the Tasks list), the actions menu, the title, and a stage progress bar of 6 segments with the stage name; then the tabs Activity (default), Session, Terminal and Properties. The selected tab SHALL have the `text` color and a 2 dp accent line; the other tabs SHALL have the `text3` color. Activity has the gate cards, the description and the key activity. Session has the session summary and the raw thread. Terminal has the newest terminal snapshot. Properties has the fields, the proposal versions and the artifacts. From 1,000 dp of task page width, Properties SHALL show in a right panel of 280 dp and the tab row SHALL NOT have the Properties tab. The content of the tabs and the message box SHALL have a maximum width of 840 dp and SHALL be centred. The message box SHALL be below the Activity and Session tabs, about 70 dp high: one row with a field of one line that grows to 5 lines and the Send button, then one line with the recipient and the hint. Activity SHALL get the height: the header SHALL scroll with the list, and only the tab row SHALL stay at the top, with "Open as page" (next to the Tasks list) and the actions menu at its end. A tab row SHALL show each tab with the width of its label and SHALL start at the first tab. The description SHALL show about 3 lines and "Show more". Each tab SHALL open at its top. Devices SHALL show each device with its role, its presence ("Last heartbeat 8 s ago", offline after 90 s), the sync state of its peer and, for this phone, the engine state and the battery warning for the mode "Restricted" with a link to the setting.

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

#### Scenario: Tab colors
- **WHEN** the person opens AW-1 on Activity in the dark scheme
- **THEN** the label "Activity" is `#F7F8F8` with a `#F0B429` line, and "Session", "Terminal" and "Properties" are `#8A8F98`

#### Scenario: No empty stage group
- **WHEN** the workspace has tasks in Backlog and Discuss only, and one archived task
- **THEN** Tasks shows the groups "Backlog", "Discuss" and "Archived · 1" (closed), and no "Ready · 0", "Implement · 0", "Review · 0" or "Done · 0"

#### Scenario: Compact message box
- **WHEN** the person opens AW-1 on a 412 dp phone
- **THEN** the message box shows the field and Send in one row, and under it one line "To claude@ubuntu-01 · <hint>"

### Requirement: Adaptive layout
The app SHALL select the navigation from the window width class only: compact (< 600 dp) a bottom bar; medium (600 to 839 dp) and expanded (840 to 1199 dp) a rail; large (1200 dp and more) a navigation drawer. Inbox SHALL show 1 pane on a compact window and its list with a detail placeholder from medium width. Tasks SHALL show 1 pane on a compact window; from medium width it SHALL show the Tasks list in a 320 dp pane and, next to it, the task page of the selected task, or the text "Select a task" while no task is selected. A tap on a task row SHALL select the task: on a compact window the task page opens in one pane; from medium width the task page shows next to the list and the row shows as selected. While a task shows next to the list, the app bar SHALL NOT span both panes: the list pane SHALL have its own bar with the workspace switcher and "Sync now", and the task page SHALL use the full height of its pane. The task page next to the list SHALL show the button "Open as page"; it SHALL open the same task page at the full width, and Back SHALL return to the list with the same task selected. "Open task" of an Inbox item and a push notification SHALL open the task page at the full width. A task SHALL NOT share the window with a Session pane. On the full-width task page, the task list SHALL show only when the person selects "Show list" and the task page is 700 dp or wider. While the keyboard is open, the message box and the focused field SHALL stay above the keyboard, and on a compact window the bottom bar SHALL hide. AW SHALL own one back stack, so a fold, an unfold or a resize keeps the open item. The manifest SHALL set no orientation, keep `resizeableActivity` at its default, declare the touch screen as not required and set the `configChanges` of `docs/phase-1.md` 10.9.

#### Scenario: Unfold keeps the task
- **WHEN** a task is open on a 360 dp window and the window becomes 840 dp
- **THEN** the same task shows next to the Tasks list, with its row selected

#### Scenario: Width classes
- **WHEN** the window is 599, 600, 839, 840, 1199 or 1200 dp wide
- **THEN** the width class is compact, medium, medium, expanded, expanded or large

#### Scenario: Task on a Fold inner screen
- **WHEN** the person taps AW-1 in Tasks on an 840 dp window
- **THEN** the Tasks list stays in a 320 dp pane, AW-1 shows next to it with "Open as page", and no "Select a task" text shows

#### Scenario: Open as page and Back
- **WHEN** AW-1 shows next to the Tasks list on an 840 dp window and the person taps "Open as page", then Back
- **THEN** AW-1 shows at the full width next to the rail, and after Back the Tasks list shows again with AW-1 selected next to it

#### Scenario: Activity gets the height next to the list
- **WHEN** AW-1 shows next to the Tasks list on an 840 dp window and the person scrolls its Activity down
- **THEN** the header scrolls away, the 4 tabs with "Open as page" and the actions menu stay at the top, the message box is one row with one hint line, and the list pane shows the workspace switcher with no Back

#### Scenario: Tasks before a selection
- **WHEN** the person opens Tasks on an 840 dp window and selects no task
- **THEN** the pane next to the list shows "Select a task"

#### Scenario: Keyboard on the phone
- **WHEN** the person taps the message box of AW-1 on a 412 dp phone
- **THEN** the message box shows directly above the keyboard, and the bottom bar hides until the keyboard closes

### Requirement: Queue on the phone
The phone SHALL apply the queue rule to its own index: the applied `queue.reordered` events (the newest per agent), the `health.yaml` of each device, the presence and the tasks. A queued task row SHALL show "Queued · 2nd for claude@ubuntu-01 · <cause>" as one text that wraps at word boundaries, and the task detail SHALL have the field "Queue" with the same text. The queue chip of the task page header and its cause SHALL wrap as whole words: no line SHALL hold a single letter of a word.

#### Scenario: Queued row
- **WHEN** AW-4 waits second for `claude@ubuntu-01` with 2 working sessions
- **THEN** its row shows "Queued · 2nd for claude@ubuntu-01 · 2 sessions working"

#### Scenario: Long assignee in a narrow pane
- **WHEN** AW-5 waits first for `claude@mac-mini-lab` with the cause "starts soon", and the Tasks list pane is 320 dp wide
- **THEN** the row shows "Queued · 1st for claude@mac-mini-lab · starts soon" on at most 2 lines, and "starts soon" shows as one word group

### Requirement: Phone task activity
The Activity tab of the phone SHALL be the Activity of the desktop ("Task activity" of desktop-app): the late answers, the Assign card and a pause first; then the first message once as the description, as Markdown; then the rows in merge order, oldest first, with the same 3 row styles (message, proposal card, task line), the same rule tested against the shared fixture `contracts/fixtures/activity/cases.json`, and the same rows left to Session. Each row SHALL show its time as the desktop does ("32 s ago", "5 min ago", "3 h ago", "2 days ago"), from the rule tested against `contracts/fixtures/time/ago.json`. A task line SHALL be one muted line with no dot in front. The state chip of a message ("Waits for your reply") SHALL show on its author line. A question SHALL be an agent message with its options as buttons while the gate is open; an answer SHALL be a person message. Each message SHALL show as Markdown, as a line with a 2 dp coloured edge; a message longer than 6 lines SHALL show its first 6 lines and "Show more". A subagent report SHALL show as on the desktop, tested against `contracts/fixtures/activity/agent-message.json`. The proposal card, its full screen view and the text size SHALL follow "Proposal card", "Proposal in full screen" and "Proposal text size" of desktop-app; the phone SHALL save the size in the file `proposal-text-px` of its files folder, with the rule `ProposalTextSize` tested with `contracts/fixtures/gates/proposal-text-size.json`. "Approve proposal" SHALL have the width of its label, with "To change it, write a message." next to it. The full screen view SHALL have Close in its top bar, and "Approve proposal" and "Discuss" at the bottom, above the system bar. The Session tab SHALL show the raw text.

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

#### Scenario: Relative times
- **WHEN** the agent message of AW-2 is 125 s old and the task was created 3 days ago
- **THEN** the message shows "2 min ago" and the line "Created by human@macbook-pro" shows "3 days ago"

#### Scenario: Open question chip
- **WHEN** AW-2 has an open question of claude@macbook-pro
- **THEN** the author line shows "claude@macbook-pro · question · <time>" and the chip "Waits for your reply" on the same line when the width holds it

### Requirement: New task button of the task list
The phone task list SHALL show the title "All tasks" with the task count and the "New task" button at the end of the same line, outside the scrolling row of project tabs, at each window size.

#### Scenario: Many projects on a 2560x1600 tablet
- **WHEN** the workspace has more project tabs than the list width holds
- **THEN** the project tabs scroll, and the full "New task" button stays visible in the title line
