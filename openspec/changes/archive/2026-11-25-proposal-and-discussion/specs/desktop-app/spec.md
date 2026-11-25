## RENAMED Requirements

- FROM: `### Requirement: Approach versions in the task detail`
- TO: `### Requirement: Proposal versions in the task detail`

## MODIFIED Requirements

### Requirement: Inbox
The Inbox SHALL show a list and a detail with the tabs "Needs you" and "Updates". "Needs you" SHALL list one row for each task in the "Needs you" lane (with its reason, title, key and project) and for each file to fix, then the groups Working now, Paused and Queued. "Updates" SHALL list the knowledge of today and each device with changes of this workspace not synced. The reason of a row SHALL be "Reply to a question" for a `question` or `reply` gate and "Approve proposal" for an `approve_proposal` gate. The detail of a task SHALL show the title, the Activity row of each open gate (the question message with its option buttons and a reply field, the proposal card, or the gate card), the Assign card or the pause, and "Open task". The person SHALL act on a gate in the detail. A task with an answer notice SHALL keep its row until the person closes the notice. From 840 px the first row shows in the detail when no row is selected, or when the selected row left the list. When the workspace has no open project, the Inbox SHALL show "No projects yet" with the button "Add a project". When it has a project but no active task, the Inbox SHALL show "No tasks yet" with the button "New task". The files to fix and the knowledge of today SHALL show in each state of the Inbox, also with no project or no active task.

#### Scenario: Answer in place
- **WHEN** the Inbox detail shows the question gate of `AW-3` with the options `100/min` and `1000/min`, and the person selects `100/min`
- **THEN** the app sends `answerGate` with that answer and the gate version, and the card shows "Answer sent" until the gate resolves

#### Scenario: Select a row
- **WHEN** the "Needs you" tab lists `AW-1` (Assign task) and `AW-7` (Approve result), and the person selects the row of `AW-7`
- **THEN** the detail shows the title of `AW-7`, its "Approve result" card and "Open task"

#### Scenario: Updates
- **WHEN** agents learned 2 items today and the person selects the tab "Updates"
- **THEN** the list shows "Knowledge today", and its detail shows the learned items with Undo

#### Scenario: Empty workspace
- **WHEN** the person opens the Inbox of a new workspace with no project
- **THEN** the Inbox shows "No projects yet" and "Add a project", and a click opens the Add a project dialog

#### Scenario: Project with no task
- **WHEN** the workspace has the project `billing-api` and no task
- **THEN** the Inbox shows "No tasks yet" and "New task", and a click opens New task

#### Scenario: Knowledge with no active task
- **WHEN** the workspace has only archived tasks, and agents learned an item today
- **THEN** the Inbox shows "No tasks yet" and the "Knowledge today" card with the item

### Requirement: Task detail
The task page SHALL show a header with Back, the key, the project, the state chips, the need-you navigation, "Show list", the actions menu, the title, and a stage progress bar of 6 segments with the stage name. The need-you navigation SHALL show "<i> of <n> need you" with the buttons Previous and Next when the task is one of the <n> tasks of the Inbox, in the Inbox order; "<n> need you" with Next to the first of them when the task is not; and nothing when no task needs the person. "Show list" SHALL show a task list of 300 px on the left of the task page, with the tasks that need the person first, in the Inbox order, then the working tasks; a click on a row SHALL open that task on the page. "Show list" SHALL show only when the task page is 700 px or wider.

It SHALL have the tabs Activity (default), Session, Terminal and Files. When the task page without the task list is narrower than 1,000 px, it SHALL also have the tab Properties; from 1,000 px the properties SHALL show in a right panel of 280 px next to the tabs. The width SHALL be the width of the task page, not of the window. The content of the Activity and Session tabs and the message box SHALL have a maximum width of 840 px and SHALL be centred. Each task SHALL open on the Activity tab, also when the person opens another task from a task. Esc on the task page SHALL go back, except in a text field.

The properties SHALL be read-only: the stage, the assignee with New session, the project, the proposal versions (latest and approved), the test server, the credential names, the queue, the parent, the subtasks and the dependencies, and the progress. The properties SHALL NOT show the first message, the session or the task id.

The Session tab SHALL show the session summary (the state, the device, the host, the claim epoch, the session id, the branch, the task id, and Stop session for a running session of this device), then the raw thread: each event of the thread window with its text, each message with its raw text, "Show older", and the original conversation of the ancestors. The Session tab SHALL show a row for each event type, also for an unknown type (principle 8). The Files tab SHALL show the read-only folder of the task and the text of a selected file. The tabs Session, Files and Properties SHALL show the line "<n> items need you" with the button "Show in Activity" when an open gate, Assign or a pause needs the person, so that a gate never hides behind a tab.

A `question` or `reply` gate SHALL show as an agent message with its options as buttons, and the message box is its free text ("Task activity"). An `approve_proposal` gate SHALL show as the proposal card ("Proposal card"). Each other open gate SHALL show as a gate card: Approve result (approve, or request changes with a required comment), Assign task (an `agent@device` choice), Approve command (Allow once, Allow for this task, Deny, a countdown from 120 s), Fix a file (its options), and other kinds with their options. A long Markdown text of a gate card SHALL show its first 240 px and "Show more"; "Show more" SHALL show the full text in the page, with no scroll box of its own. A message box SHALL send a message to the running session. It SHALL stay at the bottom of the Activity and Session tabs, outside the scroll area.

#### Scenario: Approve command countdown
- **WHEN** an Approve command gate opened 30 s ago
- **THEN** the card shows "Denies in 90 s"; after 120 s it shows "Denied after 120 s" and a late "Allow once" still sends an answer

#### Scenario: Request changes needs a comment
- **WHEN** the person selects "Request changes" on Approve result with an empty comment
- **THEN** the send button is disabled

#### Scenario: Session tab keeps each event
- **WHEN** the thread has one event of each type of `contracts/samples/schema-samples.json` and one unknown type
- **THEN** the Session tab shows one row with text for each event

#### Scenario: Another task opens on Activity
- **WHEN** the person views the Files tab of AW-8 and opens AW-9
- **THEN** AW-9 shows the Activity tab

#### Scenario: A gate does not hide behind a tab
- **WHEN** AW-12 has an open question gate and the person opens the Session tab
- **THEN** the tab shows "1 item needs you" with "Show in Activity" and no gate card

#### Scenario: Narrow task page
- **WHEN** the task page is 900 px wide
- **THEN** the task page shows the tabs Activity, Session, Terminal, Files and Properties, and no right panel

#### Scenario: Wide task page
- **WHEN** the task page is 1208 px wide and the task list is hidden
- **THEN** the properties show in a right panel, the tab row has no Properties tab, and the Activity content is 840 px wide and centred

#### Scenario: Need-you navigation
- **WHEN** AW-1 and AW-4 need the person, in this Inbox order, and the person opens AW-1
- **THEN** the header shows "1 of 2 need you", and Next opens AW-4 on its Activity tab

#### Scenario: Task list on request
- **WHEN** the task page is 1208 px wide and the person selects "Show list", then the row of AW-2
- **THEN** a 300 px task list shows on the left with AW-1 and AW-4 first, and the page shows AW-2

#### Scenario: Show more without a scroll box
- **WHEN** the proposal of AW-12 has 60 lines and the person selects "Show more" on the proposal card
- **THEN** the card shows the 60 lines in the page, and the text has no scroll bar of its own

### Requirement: Proposal versions in the task detail
The Proposal field SHALL list each version. A version SHALL open to the full text of the file of its `proposal.proposed` event (`proposal/v<n>.md`, or `approach/v<n>.md` from before the rename). The chip SHALL be "Approved" for the approved version, "Waits for you" for the latest version when no version is approved or the latest version is newer than the approved one, and "Replaced" for each other version.

#### Scenario: New version after an approved one
- **WHEN** v1 of AW-12 is approved and the agent proposes v2
- **THEN** v1 shows "Approved" and v2 shows "Waits for you"

#### Scenario: Full text
- **WHEN** the person opens v2
- **THEN** the field shows the full Markdown of `proposal/v2.md`

#### Scenario: Version from before the rename
- **WHEN** the task has `approach.proposed {version: 3, file: approach/v3.md}`
- **THEN** the field lists v3 and opens `approach/v3.md`

### Requirement: Gate cards with the full context
A gate card SHALL NOT show decisions: `data.decisions` of a gate from before openspec proposal-and-discussion SHALL show only in the Session tab, and the card SHALL show the gate text as written. The card SHALL read `gate.opened` from the work events of the task (`types=gate.opened,proposal.proposed,result.posted,artifact.added&newest=true`), not from the thread window. An "Approve result" card SHALL list the artifacts of its `result.posted` with name and size, each with "Open".

#### Scenario: Old gate with decisions
- **WHEN** an open custom gate from before the rename has 2 decisions
- **THEN** the card shows its text and its options, and no decision picker and no "Send my choices"

#### Scenario: Result artifacts
- **WHEN** the result of AW-12 names `artifacts/ubuntu-01/shot.png` and `artifacts/ubuntu-01/report.xml`
- **THEN** the "Approve result" card lists both with their sizes and an "Open" button

### Requirement: Task activity
The Activity tab SHALL show the Assign card and a pause first; then the first message once as the description, as Markdown with raw HTML off, with a "Show raw" switch that shows the exact text; then the activity rows in merge order, oldest first. The header chip "Needs you: <reason>" SHALL scroll to the row that needs the person. One table SHALL decide for each event the row style and the text, with an entry for each type of the contract. The table and the rule SHALL agree with the shared fixture `contracts/fixtures/activity/cases.json`, which the phone tests too. Activity SHALL have 3 row styles:
- **Message**: an agent message (`message.agent` with the source `tool` or no source, a subagent report), a person message (`message.human` with the source `typed` or `phone` and no `delivery_id`, `message.sent` that is not a nudge, `comment.added` by a person), a question (`gate.opened` of the kind `question` or `reply`: an agent message with the gate text and, while the gate is open, its options as buttons and the chip "Waits for your reply"), and an answer (`gate.answered` of a question or reply: a person message with the answer and the comment).
- **Proposal card**: the `proposal.proposed` of the newest version ("Proposal card").
- **Task line**: `task.created` (as "Created by <by>", without the text), `task.assigned`, `task.rekeyed`, `task.edited`, `task.stage_changed`, `task.paused`, `task.resumed`, `task.done`, `task.archived`, `task.learned`, `result.posted`, `artifact.added`, a `proposal.proposed` that a newer version replaced ("Proposal v<n> · replaced by v<m>"), the approval of a proposal ("Proposal v<n> approved by <by>"), an answered gate of another kind ("<gate> answered: <answer>"), and a `session.ended` with the reason `stopped` or `crashed` as a line with the cause and the next step (principle 2): "Session stopped on <device>: a person stopped it or ended the agent. AW starts no new session until a person starts one." or "Session crashed on <device>: the agent process ended and AW did not restart it. AW starts no new session until a person starts one."

An open gate of another kind (Approve result, Approve command, Fix a file, a custom gate, …) SHALL show its gate card at its place in time. Activity SHALL NOT show the `gate.opened` of a proposal, a `gate.resolved`, a `comment.added` by `aw@<device>` (for example "Context compacted"), a `message.agent` with the source `turn`, a nudge notice, a `message.human` that repeats a message, a notice or the first message, a `session.ended` with another reason, or an unknown type: these show in the Session tab.

Each message SHALL show as Markdown with raw HTML off, as a line with a 2 px edge in the colour of its author (agent or person) and the same text sizes for each author. A message longer than 6 lines SHALL show its first 6 lines and "Show more". A `message.human` whose text is a subagent report (the rule `agentMessage` of `shared/client`, tested against `contracts/fixtures/activity/agent-message.json`) SHALL show as an agent message with the text of the agent and the label "Subagent report · arrived in the terminal", or "Agent message · arrived in the terminal" for a message of another agent of the session. The Session tab SHALL show the raw text of each event.

#### Scenario: First message once
- **WHEN** the person opens a task whose thread has `task.created`, `task.claimed`, `session.started` and a `message.human` with source `first`
- **THEN** Activity shows the first message once as the description, the line "Created by human@macbook-pro", and no claim, session or input row

#### Scenario: Question as a message
- **WHEN** the agent of AW-12 asks "Where do the counters live?" with the options "Redis" and "In memory"
- **THEN** Activity shows an agent message with the question, the buttons "Redis" and "In memory" and the chip "Waits for your reply", and no "… opened" line

#### Scenario: Answer as a message
- **WHEN** the person selects "Redis"
- **THEN** the question has no buttons, and a person message "Redis" follows it

#### Scenario: One proposal
- **WHEN** the agent sent proposal v1 and then v2
- **THEN** Activity shows the line "Proposal v1 · replaced by v2" at the place of v1, and one proposal card for v2

#### Scenario: AW note
- **WHEN** the thread has `comment.added` "Context compacted at 10:51 UTC." by `aw@macbook-pro`
- **THEN** Activity has no row for it, and the Session tab shows it

#### Scenario: Message from the terminal
- **WHEN** the person types "Use cents." in the terminal of the session
- **THEN** Activity shows a person message "Use cents." with "typed in the terminal"

#### Scenario: Subagent report
- **WHEN** the person relays a subagent report into the terminal
- **THEN** Activity shows "Subagent report · arrived in the terminal" and the report as Markdown

#### Scenario: Stopped session
- **WHEN** the session of AW-12 on ubuntu-01 ended with `stopped`
- **THEN** Activity shows the task line "Session stopped on ubuntu-01: a person stopped it or ended the agent. AW starts no new session until a person starts one."

#### Scenario: Turn text stays in Session
- **WHEN** the thread has a `message.agent` with the source `turn`
- **THEN** Activity has no row for it, and the Session tab shows it with "turn text"

#### Scenario: Nudge notice
- **WHEN** the thread has a `message.sent` with `kind: nudge`
- **THEN** Activity has no row for it, and the Session tab shows it

### Requirement: Question details and context on gate cards
A question message in Activity and in the Inbox detail SHALL show the gate title in bold and the gate text as Markdown when the gate has a body (the trimmed text is not empty and not the trimmed title). A body longer than 12 lines SHALL show its start and "Show more". A `question` or `reply` gate with no body SHALL show "Context": the `message.agent` texts after the last event by `human@…` before its `gate.opened`, oldest first, at most 5, each longer than 6 lines clamped with "Show more". With no such message, the question SHALL show no Context. An option with a description SHALL show the description under its label.

#### Scenario: Details
- **WHEN** the agent asks "Which queue library?" with details
- **THEN** the message shows the question in bold, the details as Markdown, and then the option buttons

#### Scenario: Analysis before the question
- **WHEN** the agent writes its analysis with `aw message` and then asks "Which option? (see the gate message above)" in the same turn
- **THEN** the question message shows the analysis under "Context" above the buttons a, b, c and d

## ADDED Requirements

### Requirement: Proposal card
The proposal card SHALL show "Proposal v<n>", the author and the time, the proposal as Markdown (the first 240 px and "Show more", with no scroll box of its own), and a full screen button. While its gate is open, it SHALL show the chip "Waits for your approval", the button "Approve proposal" and the line "To change it, write a message." After the approval it SHALL show "Approved by <by>" and no button. The card SHALL use the text size of the device ("Proposal text size"). "Approve proposal" SHALL send the answer "Approve" with the gate version. A message that the person sends while the gate is open SHALL go to the session, and the card SHALL stay open.

#### Scenario: Approve
- **WHEN** the person selects "Approve proposal" on proposal v2 of AW-12
- **THEN** the app sends `answerGate` with "Approve", and after the resolution the card shows "Approved by human@macbook-pro"

#### Scenario: Discuss
- **WHEN** the person writes "Also send Retry-After" in the message box while proposal v2 waits
- **THEN** the message goes to the session, and the card still shows "Approve proposal"

### Requirement: Proposal in full screen
The full screen button of the proposal card SHALL open the proposal over the whole window: the title "Proposal v<n>", the task key and title, the text size control, Close, the proposal as Markdown with a maximum width of 760 px, and at the bottom "Approve proposal" (while the gate is open) and "Discuss". Esc and Close SHALL close the view. "Discuss" SHALL close the view and put the cursor in the message box.

#### Scenario: Open and close
- **WHEN** the person selects the full screen button of proposal v2, then presses Esc
- **THEN** the view shows the full proposal, and Esc shows the task page again

#### Scenario: Discuss from full screen
- **WHEN** the person selects "Discuss" in the full screen view
- **THEN** the view closes and the message box has the focus

### Requirement: Proposal text size
The text size control SHALL have A− and A+ and show the size. The size SHALL be 14 to 24 px in steps of 2 px, 16 px by default. The app SHALL save the size as `proposal_text_px` in `aw-desktop.json` and SHALL use it for each proposal, in the card and in the full screen view, also after a restart. The rule SHALL be `proposalTextSize` of `shared/client`, tested with the cases of `contracts/fixtures/gates/proposal-text-size.json`.

#### Scenario: Larger text is kept
- **WHEN** the person selects A+ twice in the full screen view and starts the app again
- **THEN** the proposal text is 20 px in the card and in the full screen view

#### Scenario: Limits
- **WHEN** the size is 24 px and the person selects A+
- **THEN** the size stays 24 px and A+ is disabled
