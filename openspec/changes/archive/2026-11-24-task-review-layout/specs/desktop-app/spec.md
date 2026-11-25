## MODIFIED Requirements

### Requirement: Board and List
The Board SHALL show the columns Backlog, Discuss, Ready, Implement, Review and Done, each with its count and a short description. The tasks with a "Needs you" reason SHALL show in the "Needs you" row across the columns, in the column of their stage; the other tasks SHALL show in the "Everything else" row. A task SHALL show in one place only. A card SHALL show the key, the project, the title, one state chip, the assignee and the age. A paused task SHALL show a Paused chip with its cause. A queued task SHALL show the chip "Queued · 2nd for claude@ubuntu-01" and its cause. The List SHALL show the same tasks in groups: Needs you, Running, Paused, Queued, Backlog, Done, with one row of one line for each task, and a group header that collapses the group. In the List, Up and Down SHALL move the focus between the rows, and Enter SHALL open the task page. A click on a card or a row SHALL open the task page ("Navigation and layout"); the Board and the List SHALL NOT show a task detail next to them. The renderer SHALL read the queues route again every 10 s. Archived tasks SHALL not show. A project with no task SHALL show "No tasks yet" with the button "New task" on the Board and the List. An empty Board column SHALL show the line "No tasks".

#### Scenario: Paused task
- **WHEN** a task in Implement has `paused.cause: device_offline`
- **THEN** its card is in the Implement column with the chip "Paused · device offline"

#### Scenario: Needs you keeps the stage
- **WHEN** `AW-3` is in Discuss and has an open "Confirm approach" gate
- **THEN** its card is in the "Needs you" row of the Discuss column, and the Discuss count includes it

#### Scenario: Queued task
- **WHEN** AW-4 is second in the queue of `claude@ubuntu-01` with the cause "2 sessions working"
- **THEN** the List shows AW-4 in the group Queued with "Queued · 2nd for claude@ubuntu-01" and "2 sessions working", and the task detail shows the same text

#### Scenario: Keyboard in the List
- **WHEN** the focus is on the row of `AW-3` and the person presses Down, then Enter
- **THEN** the focus moves to the next row, and the task page of that task opens

#### Scenario: New project board
- **WHEN** the person opens the Board of the new project `billing-api`
- **THEN** the Board shows "No tasks yet" and "New task", and a click opens New task with `billing-api` selected

### Requirement: Navigation and layout
The window SHALL have a sidebar with, from the top: the workspace switcher; Inbox; All tasks; the section Projects with one row for each project of the current workspace; the section Workspace with Shared knowledge and Credentials; the section This device with Devices & sync and Settings; and a footer with the device name, the sync state and Sync. A project row SHALL open the Board of the project. The project pages SHALL show a header with the project name and the tabs Board, List, Knowledge, Files and Settings. A project URL with no tab SHALL open the Board. The layout SHALL work from a 400 × 480 window to a wide screen: a temporary drawer below 600 px, an icon rail up to 1200 px, a 240 px drawer above. A task SHALL open as the task page (the task route) at each window width: from the Board, the List, the Inbox and the command menu. Back on the task page SHALL return to the screen that opened it, with its search parameters. Below 840 px a selected Inbox item, knowledge file, device or task folder SHALL replace the list; from 840 px list and detail show side by side.

#### Scenario: Narrow window
- **WHEN** the window is 400 px wide and the person selects a task in the List
- **THEN** the task page replaces the list, and Back returns to the list

#### Scenario: A task opens as a page on a wide window
- **WHEN** the window is 1440 px wide and the person clicks the card of AW-1 on the Board of `demo-api`
- **THEN** the task page of AW-1 fills the content area with no board next to it, and Back returns to the Board of `demo-api`

#### Scenario: Knowledge in a narrow window
- **WHEN** the window is 400 px wide and the person selects a knowledge file
- **THEN** the file view replaces the tree, and Back returns to the tree

#### Scenario: Project tabs
- **WHEN** the person selects the project row `billing-api` in the sidebar, then the tab List in the project header
- **THEN** the app shows the Board of `billing-api`, then its List, and the sidebar has one row for `billing-api`

### Requirement: Task detail
The task page SHALL show a header with Back, the key, the project, the state chips, the need-you navigation, "Show list", the actions menu, the title, and a stage progress bar of 6 segments with the stage name. The need-you navigation SHALL show "<i> of <n> need you" with the buttons Previous and Next when the task is one of the <n> tasks of the Inbox, in the Inbox order; "<n> need you" with Next to the first of them when the task is not; and nothing when no task needs the person. "Show list" SHALL show a task list of 300 px on the left of the task page, with the tasks that need the person first, in the Inbox order, then the working tasks; a click on a row SHALL open that task on the page. "Show list" SHALL show only when the task page is 700 px or wider.

It SHALL have the tabs Activity (default), Session, Terminal and Files. When the task page without the task list is narrower than 1,000 px, it SHALL also have the tab Properties; from 1,000 px the properties SHALL show in a right panel of 280 px next to the tabs. The width SHALL be the width of the task page, not of the window. The content of the Activity and Session tabs and the message box SHALL have a maximum width of 840 px and SHALL be centred. Each task SHALL open on the Activity tab, also when the person opens another task from a task. Esc on the task page SHALL go back, except in a text field.

The properties SHALL be read-only: the stage, the assignee with New session, the project, the approach versions (latest and confirmed), the test server, the credential names, the queue, the parent, the subtasks and the dependencies, and the progress. The properties SHALL NOT show the first message, the session or the task id.

The Session tab SHALL show the session summary (the state, the device, the host, the claim epoch, the session id, the branch, the task id, and Stop session for a running session of this device), then the raw thread: each event of the thread window with its text, each message with its raw text, "Show older", and the original conversation of the ancestors. The Session tab SHALL show a row for each event type, also for an unknown type (principle 8). The Files tab SHALL show the read-only folder of the task and the text of a selected file. The tabs Session, Files and Properties SHALL show the line "<n> items need you" with the button "Show in Activity" when an open gate, Assign or a pause needs the person, so that a gate never hides behind a tab.

Each open gate SHALL show as a gate card: Answer question and Reply (options and free text), Confirm approach and Approve result (confirm or approve, or request changes with a required comment), Assign task (an `agent@device` choice), Approve command (Allow once, Allow for this task, Deny, a countdown from 120 s), Fix a file (its options), and other kinds with their options. A long Markdown text of a gate card SHALL show its first 240 px and "Show more"; "Show more" SHALL show the full text in the page, with no scroll box of its own. A message box SHALL send a message to the running session. It SHALL stay at the bottom of the Activity and Session tabs, outside the scroll area.

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

#### Scenario: A gate does not hide behind a tab
- **WHEN** AW-12 has an open Answer question gate and the person opens the Session tab
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
- **WHEN** the plan of a Confirm approach gate has 60 lines and the person selects "Show more"
- **THEN** the card shows the 60 lines in the page, and the gate text has no scroll bar of its own

### Requirement: Gate cards with the full context
A gate card SHALL show each decision of `gate.opened` `data.decisions` with its question, its options and the recommended option marked "Recommended". When `data.decisions` is not empty, the card SHALL cut the text at the last `\n\n## Decisions\n`. When the gate has the option "Request changes", each decision SHALL be a radio group, and its recommended option SHALL be picked when the card opens. When each pick is the recommended option, the main button SHALL be the recommended option of the gate (for example "Confirm"). When a pick is not the recommended option, the main button SHALL be "Send my choices", a line SHALL say how many picks differ and that the agent writes a new approach with them, and "Send my choices" SHALL send the answer "Request changes" with the comment of `decisionsAnswer` (`shared/client/src/gates.ts`): "My choices for the decisions:", one line "- <question>: <picked option>" for each changed decision, and "Keep the recommended option of the other decisions." when a decision keeps its recommended option. A gate with no option "Request changes" SHALL show the decisions as labels. The card SHALL read `gate.opened` from the work events of the task (`types=gate.opened,approach.proposed,result.posted,artifact.added&newest=true`), not from the thread window. An "Approve result" card SHALL list the artifacts of its `result.posted` with name and size, each with "Open".

#### Scenario: Decisions with a recommendation
- **WHEN** the "Confirm approach" gate of AW-12 has 2 decisions, each with a recommended option
- **THEN** the card shows both questions, their options as radio groups with the recommended options picked and marked "Recommended", the button "Confirm", and no "## Decisions" text block

#### Scenario: Send my choices
- **WHEN** the person picks "In memory, one counter per pod" for the decision "D2 Counter store" of AW-12 and selects "Send my choices"
- **THEN** the app sends the answer "Request changes" with the comment "My choices for the decisions:\n- D2 Counter store: In memory, one counter per pod\nKeep the recommended option of the other decisions."

#### Scenario: Back to the recommendation
- **WHEN** the person picks another option of D2, then the recommended option of D2 again
- **THEN** the main button is "Confirm" again

#### Scenario: Decisions of a gate with no Request changes
- **WHEN** a custom gate has the options "Yes" and "No" and 1 decision
- **THEN** the card shows the decision as labels with "Recommended", and no radio group

#### Scenario: Result artifacts
- **WHEN** the result of AW-12 names `artifacts/ubuntu-01/shot.png` and `artifacts/ubuntu-01/report.xml`
- **THEN** the "Approve result" card lists both with their sizes and an "Open" button

### Requirement: Task activity
The Activity tab SHALL show the open gate cards, the Assign card and a pause first; then the first message once as the description, as Markdown with raw HTML off, with a "Show raw" switch that shows the exact text; then the activity rows in merge order. One table SHALL decide for each event type if it shows in Activity, with an entry for each type of the contract. The table and the rule SHALL agree with the shared fixture `contracts/fixtures/activity/cases.json`, which the phone tests too. Activity SHALL show `task.created` (as "Created by <by>", without the text), `task.assigned`, `task.rekeyed`, `task.edited`, `task.stage_changed`, `task.paused`, `task.resumed`, `task.done`, `task.archived`, `task.learned`, `message.agent`, `message.sent`, `comment.added`, `gate.opened`, `gate.answered`, `approach.proposed`, `result.posted` and `artifact.added`. It SHALL show a `message.human` only with the source `typed` or `phone` and no `delivery_id` (text that the person typed in the terminal). It SHALL show a `session.ended` only with the reason `stopped` or `crashed`, as a line with the cause and the next step (principle 2): "Session stopped on <device>: a person stopped it or ended the agent. AW starts no new session until a person starts one." or "Session crashed on <device>: the agent process ended and AW did not restart it. AW starts no new session until a person starts one." It SHALL NOT show the other types, a `message.human` that repeats a message, an answer, a notice or the first message, a `session.ended` with another reason, or an unknown type: these show in the Session tab.

An agent message, a person message, a sent message, a comment and the comment of an answer SHALL show as Markdown with raw HTML off. A message longer than 6 lines SHALL show its first 6 lines and "Show more". A `message.human` whose text is a subagent report (the rule `agentMessage` of `shared/client`, tested against `contracts/fixtures/activity/agent-message.json`) SHALL show in the style of an agent message, with the text of the agent as Markdown and the label "Subagent report · arrived in the terminal" for the report of a subagent, or "Agent message · arrived in the terminal" for a message of another agent of the session. The Session tab SHALL show the raw text of each message.

#### Scenario: First message once
- **WHEN** the person opens a task whose thread has `task.created`, `task.claimed`, `session.started` and a `message.human` with source `first`
- **THEN** Activity shows the first message once as the description, the line "Created by human@macbook-pro", and no claim, session or input row

#### Scenario: Message from the terminal
- **WHEN** the thread has a `message.human` with source `typed`, no `delivery_id` and the text "Use **cents**.\n\n- one\n- two"
- **THEN** Activity shows a message of the person with "cents" in bold and a list of 2 items

#### Scenario: Subagent report
- **WHEN** the thread has a typed `message.human` whose text starts with `<agent-message from="a5190c65">`, has the line "The report follows:", and then "  ## Gateway: what runs today"
- **THEN** Activity shows "Subagent report · arrived in the terminal" and the heading "Gateway: what runs today", and the Session tab shows the raw text with the tags

#### Scenario: Show raw
- **WHEN** the first message is "# Plan\n\nUse **cents**." and the person turns on "Show raw"
- **THEN** the description shows the exact text "# Plan\n\nUse **cents**."

#### Scenario: Stopped session
- **WHEN** the person stops the session of AW-1 on ubuntu-01 and the thread gets `session.ended` with the reason `stopped`
- **THEN** Activity shows "Session stopped on ubuntu-01: a person stopped it or ended the agent. AW starts no new session until a person starts one."

#### Scenario: Moved session
- **WHEN** the thread has `session.ended` with the reason `moved`
- **THEN** Activity shows no line for it, and the Session tab shows "Session ended (moved)"
