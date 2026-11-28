# android-app Specification

## Purpose
The phone app as a remote control (principle 1): the adaptive Compose screens, keyboard and mouse, the phone actions in its own logs, the credential outbox and the push receiver.
## Requirements
### Requirement: Phone screens
The Android app SHALL have the screens Home, Inbox, Tasks, Task detail, New task and Devices, from the phone's own Room index. Home SHALL show "Needs you" first, then the devices with their sync state and a "Sync now" button, then the working and paused tasks. Inbox SHALL show the cards of the incoming messages ("Phone Inbox" of inbox-cards). Tasks SHALL have the tabs "Needs you", "Working" and "All" and the project filter ("Phone Tasks" and "Project filter" of tasks-view): "Needs you" SHALL show the rows of the rule `inboxItems` tested against `contracts/fixtures/inbox/items.json`, and a tap on a row SHALL open the item screen: the title, the Activity row of each open gate (the question message with its option buttons and a reply field, the proposal card, or the gate card), the Assign card or the pause, and "Open task". "All" SHALL group the tasks by stage (Backlog, Discuss, Ready, Implement, Review, Done) and SHALL show a "Paused" chip with the cause on a paused task and on a task whose session device is offline.

Task detail SHALL be the task page of the desktop ("Task detail" of desktop-app) with the same parts in the same order: a header with Back, the key, the project, the state chips, the need-you navigation ("<i> of <n> need you" with Previous and Next, in the Inbox order), "Show list" (only when the task page is 700 dp or wider), the actions menu, the title, and a stage progress bar of 6 segments with the stage name; then the tabs Activity (default), Session, Terminal and Properties. Activity has the gate cards, the description and the key activity. Session has the session summary and the raw thread. Terminal has the newest terminal snapshot. Properties has the fields, the proposal versions and the artifacts. From 1,000 dp of task page width, Properties SHALL show in a right panel of 280 dp and the tab row SHALL NOT have the Properties tab. The content of the tabs and the message box SHALL have a maximum width of 840 dp and SHALL be centred. The message box SHALL be below the Activity and Session tabs, with its label above the field and a Send button. The header SHALL scroll with the list, and the tab row SHALL stay at the top of the list, so a short window keeps the list. Each tab SHALL open at its top. Devices SHALL show each device with its role, its presence ("Last heartbeat 8 s ago", offline after 90 s), the sync state of its peer and, for this phone, the engine state and the battery warning for the mode "Restricted" with a link to the setting.

#### Scenario: Needs you row and item
- **WHEN** AW-12 has an open question with the options "100/min" and "1000/min", and AW-9 is working
- **THEN** Tasks › Needs you shows the row "Reply to a question · Rate limits for the public API · AW-12", and Tasks › Working shows the group "Working now · 1"; a tap on the row shows the question message with the 2 buttons, a reply field and "Open task"

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

### Requirement: Keyboard and mouse
Each screen SHALL work with a keyboard and a mouse: Ctrl+N opens New task, Ctrl+R runs "Sync now", Esc closes the open detail or dialog, Enter sends a message or an answer, the arrow keys move the focus in a list. A secondary click on a task row SHALL open the same menu as a long press (Open, Copy task key, Sync now). The app SHALL list the shortcuts in `onProvideKeyboardShortcuts`.

#### Scenario: Esc closes the detail
- **WHEN** the stack is `[Tasks, Task(AW-7)]` and the human presses Esc
- **THEN** the stack is `[Tasks]`

#### Scenario: New task shortcut
- **WHEN** the human presses Ctrl+N on any screen
- **THEN** the New task form opens

### Requirement: Phone actions
Each human action of the phone SHALL write one event to the phone's own log through the event writer of `shared`, then start a targeted scan of the engine and a refresh of the index: a gate answer (`gate.answered` with the gate id and version), a message to a running session (`message.sent` with the session id), a new task (`task.created` with the next free key of the workspace) and an assignment (a human `task.assigned`, also "Assign to another device…" on a paused task). A gate answer that needs a comment ("Request changes", "Reject") SHALL not be sent without one. The card SHALL show "Answer sent, waiting for <owner device>" until the gate is resolved, and SHALL say when the owner device is offline. A message SHALL be refused when the task has no running session. A new task SHALL be refused with the text "The phone does not have workspace.yaml of this workspace yet. Wait for the sync, then try again." while the phone does not know the `key_prefix` of `workspace.yaml`, and the phone SHALL write no `task.rekeyed` in that state, as awd does (`not_ready`); the phone SHALL NOT use a default prefix. "Create task" SHALL be off while a create runs. A change of the project on New task SHALL clear the assignee and the test server. The end of a create or a credential add SHALL close its form only when the form is the top screen.

#### Scenario: Answer from the phone
- **WHEN** the human selects "1000/min" on the card of gate G version 1 of AW-7
- **THEN** the phone log of AW-7 has `gate.answered {gate: G, version: 1, answer: "1000/min"}`, the engine scans that file, and the card shows "Answer sent, waiting for ubuntu-01"

#### Scenario: New task from the phone
- **WHEN** the human creates a task in project `api` with the first message "Add a rate limit" and no assignee, and the highest key is AW-12
- **THEN** the phone writes `task.created` with key AW-13 in a new task folder, and the task shows "Needs you: assign"

#### Scenario: New task before workspace.yaml
- **WHEN** the phone has the task logs but not `tasks/workspace.yaml`, and the human creates a task or the phone has a duplicate key to rekey
- **THEN** the create is refused with the text about workspace.yaml, and the phone writes no event

#### Scenario: Project change on New task
- **WHEN** the human selects project `api`, taps `claude@mac-mini-lab`, then selects project `web`
- **THEN** the assignee is None, and a create sends no assignee

#### Scenario: Request changes needs a comment
- **WHEN** the human selects "Request changes" with an empty comment
- **THEN** the app writes nothing and asks for the comment

### Requirement: Credential outbox
The phone SHALL add or replace a credential without the means to read it: it seals the value with age to the X25519 key of each valid, not revoked computer record through the `CredentialSealer` interface and writes the result to `tasks/devices/<phone>/sealed/<id>.age`. The sealed content SHALL be `{"kind":"sealed-credential","v":1,"name":<name>,"value":<value>}`, so `openCredential()` of `shared/identity` opens it. The value SHALL never go to an event, a log or the index, and SHALL never become a `String` in the sealer; the value array and the content bytes SHALL be cleared after the seal. The Value field SHALL show the value masked and SHALL give accessibility services only the masked text, never the clear value. With no paired computer, the screen SHALL say so and SHALL write nothing. After each index refresh, the phone SHALL remove `tasks/devices/<phone>/sealed/<id>.age` when an applied `credential.imported` event has `from` = this phone and `sealed` = `<id>`, and its device has a computer record that is not revoked. Then it SHALL run the targeted scan, so the delete syncs to each computer. It SHALL keep each other file of the outbox. An error of the removal SHALL be logged and SHALL NOT stop the other work of the snapshot.

#### Scenario: No paired computer
- **WHEN** the human adds a credential on a phone with no computer record
- **THEN** the phone refuses with "No paired computer can get the credential" and writes no file

#### Scenario: Value hidden from accessibility services
- **WHEN** the human types `stg_live_SECRET42` in the Value field
- **THEN** the accessibility tree (uiautomator dump) has the node with `password="true"` and the text `•••••••••••••••••`, not the value

#### Scenario: Sealed file
- **WHEN** the age sealer seals the value of `github-token` to 2 computers
- **THEN** the phone writes one file `tasks/devices/<phone>/sealed/<uuidv7>.age` that each computer identity opens, and no event holds the value

#### Scenario: Sealed file after the import
- **WHEN** `ubuntu-01` writes `credential.imported {name: "staging-api-key", from: "pixel-9", sealed: <id>}` and the phone merges it
- **THEN** the phone removes `tasks/devices/pixel-9/sealed/<id>.age`, keeps the other sealed files, and a second refresh removes nothing

#### Scenario: Import that does not count
- **WHEN** a `credential.imported` names another phone, or a mobile device wrote it
- **THEN** the phone keeps its sealed file

### Requirement: Push receiver
The app SHALL register one UnifiedPush instance per computer and joined workspace (instance name `<workspace id>/<computer>`) for each computer that publishes `vapid_public_key` in its `bindings.yaml`, through the embedded FCM distributor (or another UnifiedPush distributor, for example ntfy), and SHALL write the endpoints, the Web Push keys and the VAPID key of each computer to `tasks/devices/<phone>/push.yaml` of that workspace. The registration SHALL run for every joined workspace, not only the selected one, and SHALL run in the app process also when no screen is open. A new endpoint that arrives in a new app process SHALL use the VAPID key of the existing `push.yaml` entry of that computer, else the key of a reloaded snapshot; an endpoint with no key SHALL be logged as dropped. A failed registration SHALL show "Push is off: the registration failed" on Devices and SHALL NOT be sent again with the same key until the next app open; at each app open the phone SHALL register the failed instances again. A received push SHALL start the sync engine for a short sync and SHALL show a notification with the title "<task key> · <gate name>" and the preview line; a tap SHALL select the workspace of the instance and open the stack `[Inbox, Task(id)]`, or `[Inbox]` for a push with no task. The notification of a gate SHALL go away when the index of the phone shows that gate resolved (its tag is the event id of `gate.opened`). A tap on a push of a workspace that is not on the phone SHALL open only the Inbox and show "This workspace is not on this phone". The activity SHALL read the task and workspace of a tap only from an intent of AW's own notifications (a component that the manifest does not export), never from an intent of another app.

#### Scenario: New endpoint
- **WHEN** the distributor gives a new endpoint for the instance `<ws>/ubuntu-01`
- **THEN** `push.yaml` of that workspace has one subscription for `ubuntu-01` with the endpoint, `p256dh`, `auth` and the VAPID key, and the other subscriptions stay

#### Scenario: Each joined workspace
- **WHEN** the phone has joined Personal and Side projects, Personal is selected, and ubuntu-01 publishes a VAPID key in both
- **THEN** the phone registers `<Personal id>/ubuntu-01` and `<Side projects id>/ubuntu-01`, and each workspace gets its own `push.yaml`

#### Scenario: Endpoint in a new process
- **WHEN** the app process starts for a new endpoint of `<ws>/ubuntu-01` and the snapshot of the workspace is not loaded yet
- **THEN** the phone writes the new endpoint with the VAPID key of the existing `push.yaml` entry

#### Scenario: Failed registration
- **WHEN** the distributor reports a failed registration for `<ws>/ubuntu-01`
- **THEN** Devices shows "Push is off: the registration failed", and the next snapshot refresh does not register that instance again with the same key

#### Scenario: Gate push
- **WHEN** a push with the preview `{task, key: "AW-7", gate_kind: "question", text: "Which limit?"}` arrives
- **THEN** the phone shows the notification "AW-7 · Answer question" with "Which limit?", and the engine syncs

#### Scenario: Push of another workspace
- **WHEN** Personal is selected and the person taps the notification of a gate of Side projects
- **THEN** the app selects Side projects and opens the task in the Inbox stack

#### Scenario: Open task from another app
- **WHEN** another app starts the AW activity with the task and workspace extras
- **THEN** the app opens its last screen and does not select the workspace or open the task

### Requirement: Queue on the phone
The phone SHALL apply the queue rule to its own index: the applied `queue.reordered` events (the newest per agent), the `health.yaml` of each device, the presence and the tasks. A queued task row SHALL show "Queued · 2nd for claude@ubuntu-01 · <cause>" as one text that wraps at word boundaries, and the task detail SHALL have the field "Queue" with the same text. The queue chip of the task page header and its cause SHALL wrap as whole words: no line SHALL hold a single letter of a word.

#### Scenario: Queued row
- **WHEN** AW-4 waits second for `claude@ubuntu-01` with 2 working sessions
- **THEN** its row shows "Queued · 2nd for claude@ubuntu-01 · 2 sessions working"

#### Scenario: Long assignee in a narrow pane
- **WHEN** AW-5 waits first for `claude@mac-mini-lab` with the cause "starts soon", and the Tasks list pane is 320 dp wide
- **THEN** the row shows "Queued · 1st for claude@mac-mini-lab · starts soon" on at most 2 lines, and "starts soon" shows as one word group

### Requirement: Terminal section on the phone
The task detail SHALL have a Terminal section with the newest synced snapshot of the task from `tasks/<task>/terminal/`: the screen in a monospace block, "Captured <time> on <device> · <age>", "No terminal snapshot yet" with no file, and the Orca note for an Orca session. The phone SHALL read the files again at each reload of the workspace model, so a new snapshot shows with no new event.

#### Scenario: Snapshot synced
- **WHEN** ubuntu-01 wrote a snapshot of AW-12 and it synced to the phone
- **THEN** the task detail shows its text and "Captured … on ubuntu-01"

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

### Requirement: Artifacts on request
The task detail SHALL have an Artifacts section with each `artifact.added` of the task, its size and its state: "Not on this phone" with "Download", "Downloading…", or "On this phone" with "Open". Download SHALL add the request to `<files>/artifact-requests/<workspace>.txt` and the ignore line of the engine. On a metered network with the switch "Use mobile data for artifacts" off (the default), Download SHALL refuse with "You are on mobile data. Connect to Wi-Fi, or turn on Use mobile data for artifacts." and SHALL add nothing. The switch SHALL be on the Devices screen. The list SHALL show only an `artifact.added` path of the form `artifacts/<device>/<name>`. Open SHALL start `ACTION_VIEW` with a read-only content URI, and only for the types `png jpg jpeg gif webp pdf txt md log json xml csv`; for any other type it SHALL show "AW does not open <name> on the phone: only images, PDF and text files open." and start nothing.

#### Scenario: Download on Wi-Fi
- **WHEN** the phone is on Wi-Fi and the person selects Download on `shot.png`
- **THEN** the file syncs to the phone and the row shows "On this phone" with "Open"

#### Scenario: Mobile data refused
- **WHEN** the phone is on mobile data with the switch off and the person selects Download
- **THEN** the phone shows the refusal and requests nothing

#### Scenario: Mobile data allowed
- **WHEN** the switch is on and the phone is on mobile data
- **THEN** Download requests the file

#### Scenario: Program artifact
- **WHEN** the person selects Open on the downloaded artifact `build.apk`
- **THEN** the phone shows "AW does not open build.apk on the phone: only images, PDF and text files open." and no other app starts

### Requirement: Phone thread window
The Session view SHALL show the newest 500 events of the task, each as a raw row (principle 8): a row for each event type of the contract, and the type name for an unknown type. "Show older" SHALL add the 500 events before them. The Activity tab SHALL use the same window and SHALL say "No activity in the newest <n> events. "Show older" loads more." when the window has events but no Activity row and older events exist.

#### Scenario: Long phone thread
- **WHEN** a task has 600 events
- **THEN** the Session view shows events 101 to 600 and "Show older"

#### Scenario: No event type is dropped
- **WHEN** the thread has one event of each contract event type and one unknown type
- **THEN** the Session view has one row for each of them

### Requirement: Push titles of finished and stopped work
The notification title SHALL come from the preview `kind`: the gate label for `gate`, "Done" for `done`, "Login expired" for `login_expired`, "Login ends soon" for `login_ends`, after the task key ("AW-12 · Done"). A push with no known kind and no gate kind SHALL show "A gate needs you".

#### Scenario: Done push
- **WHEN** a push with `{key: "AW-12", kind: "done", gate_kind: null, text: "Done: Add rate limits"}` arrives
- **THEN** the phone shows "AW-12 · Done" with "Done: Add rate limits"

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

### Requirement: Question details and context on phone gate cards
A phone gate card SHALL show the gate body as Markdown above the choices, clamped to 6 lines with "Show more". A `question` or `reply` gate with no body SHALL show "Context" with the same rule and the same fixture as the desktop (`contracts/fixtures/gates/context.json`), each message as Markdown. When `gate.opened` has `questions`, the card SHALL show each option description, and a gate with 2 or more questions or a multiSelect question SHALL show each question with its options as full-width choices and "Send answers", with the answer text of `contracts/fixtures/gates/questions.json`.

#### Scenario: Context on the phone
- **WHEN** the agent writes its analysis and then asks "Which option? (see the gate message above)" in the same turn
- **THEN** the phone card shows the start of the analysis under "Context" and "Show more"

#### Scenario: Two questions on the phone
- **WHEN** the person picks one option for each of 2 questions and taps "Send answers"
- **THEN** the gate answer is the same text as the desktop sends for the same picks

#### Scenario: Markdown body
- **WHEN** the gate details are "## Options\n\n1. **Queue A**"
- **THEN** the phone card shows a heading and a numbered item with "Queue A" in bold

### Requirement: Pinned action bar of the phone New task
The phone New task SHALL have a bottom action bar with "Create task" and "Cancel" that stays visible while the form scrolls, above the navigation bar and the keyboard. "Create task" SHALL be enabled only with a project, a first message that is not blank, and no create in progress.

#### Scenario: A tall form on a 1080x2220 screen
- **WHEN** the person opens New task on a 1080x2220 phone
- **THEN** "Create task" shows with no scroll

#### Scenario: Blank first message
- **WHEN** the first message is only spaces
- **THEN** "Create task" is disabled

### Requirement: New task button of the task list
The phone task list SHALL show the title "All tasks" with the task count and the "New task" button at the end of the same line, outside the scrolling row of project tabs, at each window size.

#### Scenario: Many projects on a 2560x1600 tablet
- **WHEN** the workspace has more project tabs than the list width holds
- **THEN** the project tabs scroll, and the full "New task" button stays visible in the title line

### Requirement: Each desktop field in the phone New task
The phone New task SHALL have each field of the desktop New task: first message, title (blank: the first line of the first message), project, assignee and "Start the agent now" (the default agent of the project on its first device), test server, parent task (open tasks of the project), credentials (chips of the names that the tasks of the workspace use, and a field for another name), and the Session block (Project default and the 3 modes, agent teams, Works in, the absolute folder of the session device). It SHALL use the compact components and keep the pinned "Create task" bar.

#### Scenario: All fields
- **WHEN** the person writes "Add a CSV export", the title "CSV export", picks a parent task and the credentials staging-db and github-token, and taps "Create task"
- **THEN** `task.created` has the title "CSV export", the parent, both credential names and `session_options.permission_mode: skip`

### Requirement: Session link in the phone summary
The session summary of the phone Session view SHALL show the session id, the session name, the terminal and the pid as the desktop ("Session link in the summary" of desktop-app), from the session view of the Kotlin merge.

#### Scenario: Link on the phone
- **WHEN** `session.started` of AW-7 has the name `AW-7`, the window `aw-01a2`, the pane `%12` and the pid 4242
- **THEN** the phone session summary has the rows "Name" `AW-7`, "Terminal" "tmux window aw-01a2 · pane %12" and "Pid" 4242

