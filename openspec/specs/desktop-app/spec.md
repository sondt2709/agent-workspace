# desktop-app Specification

## Purpose
The macOS desktop app: the one awd connection of the Electron main process, the typed preload bridge, the renderer security, the server state in TanStack Query, and the task and gate screens.
## Requirements
### Requirement: One awd connection in the main process
The Electron main process SHALL own the only awd client of the app, on `~/.aw/run/awd.sock` (or `$AW_HOME/run/awd.sock`), with `@aw/client`. It SHALL open the event stream, forward each event message to the window, and reconnect after a close or a failure with an exponential backoff (start 500 ms, at most 30 s, with jitter). After each reconnect it SHALL send `resync` to the window. A stream that closes within 5 s, and an error that the retry library does not retry, SHALL count as a failed attempt with the same backoff; the loop SHALL end only at `stop()`. It SHALL never open a TCP connection to awd.

#### Scenario: awd restarts
- **WHEN** the event stream closes and awd answers again on the next attempt
- **THEN** the window gets the connection state `offline`, then `online`, then one `resync`

#### Scenario: Backoff grows
- **WHEN** 3 attempts in a row fail
- **THEN** the waits before the attempts grow from 500 ms and never pass 30 s

### Requirement: Typed preload bridge
The preload script SHALL expose only `window.aw`, made from the contract in `desktop/src/shared/`: `channels.ts` (the channel names and the type of each call, imported by main, the preload and the renderer) and `contract.ts` (a zod schema for the arguments of each allowed call, used by main). `window.aw.call(method, args)` SHALL send each call on the one `call` channel. Each `on*()` function SHALL return a function that removes the listener. Main SHALL refuse a call from a frame whose URL is not `app://` (or the development server URL in a development build), and a call whose payload does not match the contract.

#### Scenario: Unknown call
- **WHEN** a frame sends `aw:call` with a method that is not in the contract
- **THEN** main replies with the error code `invalid_input` and calls no awd route

#### Scenario: Unsubscribe
- **WHEN** the renderer calls the function that `onEvent()` returned
- **THEN** the listener gets no later event

### Requirement: Renderer security
The window SHALL use `sandbox: true`, `contextIsolation: true` and `nodeIntegration: false`. The production build SHALL serve the UI from `app://` with a `Content-Security-Policy` header with `script-src 'self'` and `style-src-elem 'self' 'nonce-<n>'`, a new nonce for each page load, and the same nonce in the Emotion cache. Navigation away from the app and new windows SHALL be refused; an `https:` link SHALL open in the default browser.
The packaged app SHALL ignore `ELECTRON_RENDERER_URL`. A dev build SHALL use it only for an `http:` URL on `localhost`, `127.0.0.1` or `[::1]`.

#### Scenario: Page load
- **WHEN** the window loads `app://aw/index.html`
- **THEN** the reply has the CSP header with a nonce, and the page has a `csp-nonce` meta tag with the same nonce

#### Scenario: Path outside the build folder
- **WHEN** a request asks for `app://aw/..%2Fmain/index.js`, or for a file that is not in `out/renderer/`
- **THEN** the reply is 404

#### Scenario: Dev server URL in the packaged app
- **WHEN** the packaged app starts with `ELECTRON_RENDERER_URL=https://example.com`
- **THEN** the window loads `app://aw/index.html`, and a call from any other origin gets `refused`

### Requirement: Server state and events in the renderer
The renderer SHALL keep awd data only in TanStack Query (`staleTime: Infinity`, no refetch on focus, retry 0), with each `queryFn` on the bridge. A `changed` event SHALL invalidate the queries of the listed tasks and their threads, the threads of their subtasks that show them as ancestors, the task lists and the gates of the workspace, and the projects when `documents_changed` is true; a `full` or `workspace_changed` event, or a `resync`, SHALL invalidate all queries of the workspace or of the app. The selection and the filters SHALL be in the route.

#### Scenario: A gate opens on another device
- **WHEN** awd sends `changed` for task `AW-3`
- **THEN** the queries of `AW-3`, of its thread and of the task and gate lists refetch, and the Inbox shows the new gate

### Requirement: Navigation and layout
The window SHALL have a sidebar with, from the top: the workspace switcher; Inbox; All tasks; the section Projects with one row for each project of the current workspace; the section Workspace with Shared knowledge and Credentials; the section This device with Devices & sync and Settings; and a footer with the device name, the sync state and Sync. A project row SHALL open the Board of the project. The project pages SHALL show a header with the project name and the tabs Board, List, Knowledge, Files and Settings. A project URL with no tab SHALL open the Board. The layout SHALL work from a 400 × 480 window to a wide screen: a temporary drawer below 600 px, an icon rail up to 1200 px, a 240 px drawer above; below 840 px a selected task, Inbox item, knowledge file, device or task folder replaces the list; from 840 px list and detail show side by side.

#### Scenario: Narrow window
- **WHEN** the window is 400 px wide and the person selects a task in the List
- **THEN** the task detail replaces the list, and Back returns to the list

#### Scenario: Knowledge in a narrow window
- **WHEN** the window is 400 px wide and the person selects a knowledge file
- **THEN** the file view replaces the tree, and Back returns to the tree

#### Scenario: Project tabs
- **WHEN** the person selects the project row `billing-api` in the sidebar, then the tab List in the project header
- **THEN** the app shows the Board of `billing-api`, then its List, and the sidebar has one row for `billing-api`

### Requirement: Inbox
The Inbox SHALL show a list and a detail with the tabs "Needs you" and "Updates". "Needs you" SHALL list one row for each task in the "Needs you" lane (with its reason, title, key and project) and for each file to fix, then the groups Working now, Paused and Queued. "Updates" SHALL list the knowledge of today and each device with changes of this workspace not synced. The detail of a task SHALL show one card for each open gate and for each other reason (assign, a pause that needs the person), and "Open task". The person SHALL act on a gate in the card. A task with an answer notice SHALL keep its row until the person closes the notice. From 840 px the first row shows in the detail when no row is selected, or when the selected row left the list. When the workspace has no open project, the Inbox SHALL show "No projects yet" with the button "Add a project". When it has a project but no active task, the Inbox SHALL show "No tasks yet" with the button "New task". The files to fix and the knowledge of today SHALL show in each state of the Inbox, also with no project or no active task.

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

### Requirement: Board and List
The Board SHALL show the columns Backlog, Discuss, Ready, Implement, Review and Done, each with its count and a short description. The tasks with a "Needs you" reason SHALL show in the "Needs you" row across the columns, in the column of their stage; the other tasks SHALL show in the "Everything else" row. A task SHALL show in one place only. A card SHALL show the key, the project, the title, one state chip, the assignee and the age. A paused task SHALL show a Paused chip with its cause. A queued task SHALL show the chip "Queued · 2nd for claude@ubuntu-01" and its cause. The List SHALL show the same tasks in groups: Needs you, Running, Paused, Queued, Backlog, Done, with one row of one line for each task, and a group header that collapses the group. In the List, Up and Down SHALL move the focus between the rows, Enter SHALL open the task, and Esc SHALL close the task detail. The renderer SHALL read the queues route again every 10 s. Archived tasks SHALL not show. A project with no task SHALL show "No tasks yet" with the button "New task" on the Board and the List. An empty Board column SHALL show the line "No tasks".

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
- **THEN** the focus moves to the next row, and that task opens

#### Scenario: New project board
- **WHEN** the person opens the Board of the new project `billing-api`
- **THEN** the Board shows "No tasks yet" and "New task", and a click opens New task with `billing-api` selected

### Requirement: Task detail
The task detail SHALL show a header with the key, the project, the state chips, a stage progress bar of 6 segments with the stage name, and the title. It SHALL have the tabs Activity (default), Session, Terminal and Files. When the task detail itself is narrower than 1,000 px, it SHALL also have the tab Properties; from 1,000 px the properties SHALL show in a right panel next to the tabs. The width SHALL be the width of the task detail, not of the window, so the board split uses the narrow layout when its panel is narrow. The task route SHALL show a Back button, and the board split SHALL show a Close button. Each task SHALL open on the Activity tab, also when the person opens another task from a task.

The properties SHALL be read-only: the stage, the assignee with New session, the project, the approach versions (latest and confirmed), the test server, the credential names, the queue, the parent, the subtasks and the dependencies, and the progress. The properties SHALL NOT show the first message, the session or the task id.

The Session tab SHALL show the session summary (the state, the device, the host, the claim epoch, the session id, the branch, the task id, and Stop session for a running session of this device), then the raw thread: each event of the thread window with its text, each message with its raw text, "Show older", and the original conversation of the ancestors. The Session tab SHALL show a row for each event type, also for an unknown type (principle 8). The Files tab SHALL show the read-only folder of the task and the text of a selected file. The tabs Session, Files and Properties SHALL show the line "<n> items need you" with the button "Show in Activity" when an open gate, Assign or a pause needs the person, so that a gate never hides behind a tab.

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

#### Scenario: A gate does not hide behind a tab
- **WHEN** AW-12 has an open Answer question gate and the person opens the Session tab
- **THEN** the tab shows "1 item needs you" with "Show in Activity" and no gate card

#### Scenario: Narrow task detail
- **WHEN** the task detail is 700 px wide in the board split of a 1280 px window
- **THEN** the task detail shows the tabs Activity, Session, Terminal, Files and Properties, and no right panel

### Requirement: New task and New session
The New task dialog SHALL have the first message (required), the project, the title (made from the first line of the first message when empty), the assignee (default none, so the task opens "Needs you: assign"), "Start the agent now", the test server, the credential names and the parent task, and SHALL call `createTask`. An empty select SHALL show its empty value ("None") under its label. "Start the agent now" SHALL set the assignee to the default agent of the project on the first device of the project. The credentials SHALL be chips from the credential list of the workspace. When the workspace has no open project, the dialog SHALL show "Add a project first" with the button "Add a project" and no form; after the add, New task SHALL open with the new project. The New session dialog SHALL select a task and an `agent@device` (a new task selection SHALL clear the agent and the host that the person picked for the task before), show the session host, and SHALL write a human `task.assigned` with the chosen `session_host`, so that the device of the agent claims the task with a higher epoch. Opened on a task page or with a selected task, New session SHALL start with that task, and the person SHALL be able to change it. New session SHALL show where the session works: for this device the checkout folder of the project; for another device whether it has a checkout of the project. When Orca is not turned on for this device, the dialog SHALL link to the Project settings of the project. The Orca choice SHALL be enabled only when the bindings of the device have `use_orca: true` and, for this device, awd found Orca; the dialog SHALL first select the `session_host` of the checkout of the project, else Orca when it is enabled, else tmux. While the host list of the session-hosts route loads, the dialog SHALL wait for it or for a host that the person picks; when the list fails and the person picked no host, the dialog SHALL send no `session_host`, and awd decides. A dialog of a workspace (New task, New session, Add a project, Pair, Assign to another device) SHALL keep the workspace of the moment it opened, and SHALL send each write to that workspace. A navigation to another workspace, for example a notification click, SHALL not change it. While one of these dialogs is open, the app SHALL ignore the commands of the app menu and the Tray that open a dialog (New Task, New Session, Sync now), so the open dialog and its draft stay.

#### Scenario: Sync now while New task is open
- **WHEN** the person writes a first message in New task and presses `CmdOrCtrl+R`
- **THEN** the Sync dialog does not open, and New task keeps the first message

#### Scenario: Navigation while New task is open
- **WHEN** the person opens New task in `ws-1`, writes a first message, a notification click opens a task of `ws-2`, and the person selects "Create task"
- **THEN** `createTask` gets `ws: ws-1`

#### Scenario: Orca turned on for the device
- **WHEN** the bindings of `ubuntu-01` have `use_orca: true` and the person starts a session for `claude@ubuntu-01`
- **THEN** Orca is enabled and selected, the dialog says that the session runs in tmux when Orca is missing there, and `assignTask` gets `session_host: orca`

#### Scenario: Orca not turned on
- **WHEN** the bindings of `ubuntu-01` have no `use_orca`
- **THEN** the Orca choice is disabled with "Orca · not turned on on ubuntu-01", and `assignTask` gets `session_host: tmux`

#### Scenario: Title from the first message
- **WHEN** the person writes the first message "/my-team:implement Add a CSV export" and leaves the title empty
- **THEN** `createTask` gets the title "/my-team:implement Add a CSV export"

#### Scenario: Start the agent now
- **WHEN** the project `billing-api` has the default agent `claude` and the devices `macbook-pro`, `ubuntu-01`, and the person turns on "Start the agent now"
- **THEN** `createTask` gets `assignee: claude@macbook-pro`

#### Scenario: Credential chips
- **WHEN** the workspace has the credentials `staging-db` and `github-token`, and the person selects the chip `staging-db`
- **THEN** `createTask` gets `credentials: ["staging-db"]`

#### Scenario: No project
- **WHEN** the person opens New task in a workspace with no open project
- **THEN** the dialog shows "Add a project first" and "Add a project", and after the add New task opens with the new project selected

#### Scenario: New session on a task page
- **WHEN** the person is on the page of `AW-1` and selects New session in the top bar
- **THEN** the Task field shows `AW-1`, and the dialog shows the checkout folder of `billing-api` on this device

### Requirement: Learning step in the thread
The thread of the task detail SHALL show `task.learned` as one line: "Nothing new learned by <by>" for `nothing_new: true`, and "Learned by <by>: <path>" for a learned item, with "waits for approval" for an item with a suggestion. A line with a change id SHALL have an Undo button that calls the knowledge Undo of that change and shows its result.

#### Scenario: Nothing new
- **WHEN** the thread has `task.learned` `{nothing_new: true}` by `claude@macbook-pro`
- **THEN** the line is "Nothing new learned by claude@macbook-pro"

#### Scenario: Learned item with Undo
- **WHEN** the thread has `task.learned` with `path: projects/billing-api/learned/2026-11-23-use-cents.md` and a change id
- **THEN** the line names the path and has an Undo button for that change

### Requirement: Pause of an offline device
The renderer SHALL merge the presence `offline_tasks` into the pause of each task: cause, since, the device and its name, `needs_human` true only for `device_revoked`. A `device_offline` row SHALL apply only to a task that has no pause of its own; a `device_revoked` row SHALL replace the own pause. A pause that needs the human SHALL add the "Needs you" reason `paused` with its cause, so the task shows in the "Needs you" lane of the Board, the group "Needs you" of the List, the Inbox and the Tray count. The Board chip, the List group, the Inbox, the task detail and the Assign dialog SHALL show "Paused · <device name> offline" or "Paused · <device name> was revoked". The task detail SHALL offer "Assign to another device…" for an offline device and "Change assignee…" for a revoked device. The presence SHALL be read again every 10 s. An offline pause SHALL show no notification.

#### Scenario: Owner device offline
- **WHEN** the presence lists AW-21 in `offline_tasks` with the device `macbook-pro` named "MacBook Pro", and AW-21 has no pause event
- **THEN** the List shows AW-21 in Paused with "Paused · MacBook Pro offline", and the task detail shows "Assign to another device…"

#### Scenario: Own pause wins
- **WHEN** a task has the pause `usage_limit` and is also in `offline_tasks` with `device_offline`
- **THEN** the chip shows the usage limit

#### Scenario: Device revoked
- **WHEN** the presence lists AW-21 with the cause `device_revoked` and the device `ubuntu-01`
- **THEN** the List shows AW-21 in "Needs you", the Inbox has its card with "Paused · ubuntu-01 was revoked." and "Change assignee…", and the button opens the Assign dialog

### Requirement: Queue in the task detail
The task detail of a queued task SHALL show its label and its cause, for example "Queued · 2nd for claude@ubuntu-01 · 2 sessions working".

#### Scenario: Task with open dependencies
- **WHEN** AW-6 waits for AW-3
- **THEN** the task detail shows "Queued for claude@ubuntu-01 · waits for AW-3"

### Requirement: Terminal tab
The task detail SHALL have a Terminal tab. It SHALL show the newest snapshot from the terminal route in a monospace block with its device and capture time, read again every 10 s, the empty text "No terminal snapshot yet" and the Orca note. It SHALL have the button "Open the terminal" while the task has a session. Above the snapshot, the tab SHALL show only the cards that act on the terminal: an open "Take over terminal" gate and a `login_expired` pause with "Sign in". When other items need the person, the tab SHALL show one line "<n> items need you" with the button "Show in Activity", which opens the Activity tab.

#### Scenario: Snapshot shown
- **WHEN** the person opens the Terminal tab of AW-12 and ubuntu-01 wrote a snapshot
- **THEN** the tab shows the screen with `[redacted:<name>]` in place of the value, "ubuntu-01" and the capture time

#### Scenario: Other gates as one line
- **WHEN** AW-12 has an open Answer question gate and the person opens the Terminal tab
- **THEN** the tab shows "1 item needs you" with "Show in Activity" and no gate card

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

### Requirement: Gate cards with the full context
A gate card SHALL show each decision of `gate.opened` `data.decisions` with its question, its options and the recommended option marked "Recommended". When `data.decisions` is not empty, the card SHALL cut the text at the last `\n\n## Decisions\n`. The card SHALL read `gate.opened` from the work events of the task (`types=gate.opened,approach.proposed,result.posted,artifact.added&newest=true`), not from the thread window. An "Approve result" card SHALL list the artifacts of its `result.posted` with name and size, each with "Open".

#### Scenario: Decisions with a recommendation
- **WHEN** the "Confirm approach" gate of AW-12 has 2 decisions, each with a recommended option
- **THEN** the card shows both questions, their options, "Recommended" next to the recommended options, and no "## Decisions" text block

#### Scenario: Result artifacts
- **WHEN** the result of AW-12 names `artifacts/ubuntu-01/shot.png` and `artifacts/ubuntu-01/report.xml`
- **THEN** the "Approve result" card lists both with their sizes and an "Open" button

### Requirement: Approach versions in the task detail
The Approach field SHALL list each version. A version SHALL open to the full text of `tasks/<task>/approach/v<n>.md`. The chip SHALL be "Confirmed" for the confirmed version, "Waits for you" for the latest version when no version is confirmed or the latest version is newer than the confirmed one, and "Replaced" for each other version.

#### Scenario: New version after a confirmed one
- **WHEN** v1 of AW-12 is confirmed and the agent proposes v2
- **THEN** v1 shows "Confirmed" and v2 shows "Waits for you"

#### Scenario: Full text
- **WHEN** the person opens v2
- **THEN** the field shows the full Markdown of `approach/v2.md`

### Requirement: Open a task artifact
The main call `openTaskArtifact {ws, task, path}` SHALL accept only a path that starts with `artifacts/`, is a file of the task files route, and whose real path stays in the task folder. It SHALL open the types `png jpg jpeg gif webp pdf txt md log json xml csv` in the default app, and SHALL show any other type in Finder. It SHALL never open another file.

#### Scenario: Image
- **WHEN** the person selects "Open" on `artifacts/ubuntu-01/shot.png`
- **THEN** main opens the file in the default app

#### Scenario: Program
- **WHEN** an artifact is `artifacts/ubuntu-01/run.command`
- **THEN** main shows it in Finder and does not open it

#### Scenario: Path outside the artifacts
- **WHEN** the renderer sends `log/ubuntu-01.jsonl` or `artifacts/../log/ubuntu-01.jsonl`
- **THEN** main refuses and opens nothing

### Requirement: Answer notices
After an answer, the card SHALL show: for the error `gate_not_open`, "Another answer resolved this gate first: “<answer>”. AW did not send your answer.", or "AW closed this gate first: “<answer>”. AW did not send your answer." when the details have `answer_event: null`; for `applied: false`, "AW did not use your answer: <reason>."; for an answer that the reply marks `use: comment`, "Your answer came after another answer. It is a comment now.", or "Your answer came after AW closed this gate: “<answer>”. It is a comment now." when the gate has no answer event. The notice SHALL show also when the gate closes before the reply arrives. In the Inbox, the card of the task SHALL stay until the person closes the notice.

#### Scenario: Gate resolved first
- **WHEN** the person answers a gate that this device knows as resolved with "Approve"
- **THEN** the card shows "Another answer resolved this gate first: “Approve”. AW did not send your answer."

#### Scenario: Refused answer in the Inbox
- **WHEN** the person answers "Approve" in the Inbox, awd refuses with `gate_not_open`, and the task leaves the "Needs you" lane
- **THEN** the Inbox keeps the card of the task with the notice until the person closes it

#### Scenario: Gate that AW closed
- **WHEN** the person answers "Allow once" to a gate that the owner device closed with "Session ended"
- **THEN** the card shows "AW closed this gate first: “Session ended”. AW did not send your answer."

### Requirement: Thread window
The thread SHALL show the newest 500 events of the task. "Show older" SHALL add the 500 events before them. The window SHALL stay one list in merge order after each refresh.

#### Scenario: Long thread
- **WHEN** a task has 1,100 events
- **THEN** the thread shows the newest event and "Show older"; after "Show older" it shows 1,000 events

### Requirement: Design system
The desktop app SHALL follow `docs/design.md`. The color tokens SHALL live in `@aw/ui/tokens` for the dark and the light scheme, and `createAppTheme()` SHALL take each color, type size, radius and component default from them. A Typography `color` prop with a palette path (`text.secondary`, `warning.main`, `aw.text2`) SHALL show the color of that path. Each text token and each status color SHALL have a contrast of at least 4.5:1 on the surfaces of `docs/design.md` 2.2 and 2.3, and `onAccent` on `accent` and `onYou` on `you` SHALL too. The app SHALL bundle its fonts (Inter Variable, Geist Mono Variable) and load no font from the network. Keyboard focus SHALL show a 2 px ring in the `focus` color on `:focus-visible`, and no ripple. Dialogs, menus and popovers SHALL use the `overlay` surface with no elevation gradient. The window SHALL have the `canvas` color of the system scheme as its background; on macOS it SHALL use the hidden inset title bar, with the traffic lights in a 44 px row of the sidebar and the top rows as drag regions.

#### Scenario: Token contrast
- **WHEN** the test computes the WCAG contrast of `text3` on `surface` in the light scheme
- **THEN** the value is at least 4.5

#### Scenario: Secondary text
- **WHEN** a screen shows a meta line as a Typography with `color="text.secondary"`
- **THEN** the line has the `text3` color, not the `text` color

#### Scenario: Keyboard focus
- **WHEN** the person moves the focus to a sidebar item with Tab
- **THEN** the item shows a 2 px ring in the `focus` color, and its fill does not change to the accent

#### Scenario: Fonts offline
- **WHEN** the app starts with no network
- **THEN** the page text uses "Inter Variable", loaded from an `app://` file

#### Scenario: macOS window
- **WHEN** the app opens its window on macOS in the dark scheme
- **THEN** the window options have `titleBarStyle: "hiddenInset"` and the background `#08090A`, and the sidebar starts with a 44 px drag row

### Requirement: Task activity
The Activity tab SHALL show the open gate cards, the Assign card and a pause first; then the first message once as the description, as Markdown with raw HTML off, with a "Show raw" switch that shows the exact text; then the activity rows in merge order. One table SHALL decide for each event type if it shows in Activity, with an entry for each type of the contract. The table and the rule SHALL agree with the shared fixture `contracts/fixtures/activity/cases.json`, which the phone tests too. Activity SHALL show `task.created` (as "Created by <by>", without the text), `task.assigned`, `task.rekeyed`, `task.edited`, `task.stage_changed`, `task.paused`, `task.resumed`, `task.done`, `task.archived`, `task.learned`, `message.agent` (only with the source `tool` or with no source), `message.sent` (not with `kind: nudge`), `comment.added`, `gate.opened`, `gate.answered`, `approach.proposed`, `result.posted` and `artifact.added`. It SHALL show a `message.human` only with the source `typed` or `phone` and no `delivery_id` (text that the person typed in the terminal). It SHALL show a `session.ended` only with the reason `stopped` or `crashed`, as a line with the cause and the next step (principle 2): "Session stopped on <device>: a person stopped it or ended the agent. AW starts no new session until a person starts one." or "Session crashed on <device>: the agent process ended and AW did not restart it. AW starts no new session until a person starts one." It SHALL NOT show the other types, a `message.agent` with the source `turn` (the text of an agent turn), a nudge notice, a `message.human` that repeats a message, an answer, a notice or the first message, a `session.ended` with another reason, or an unknown type: these show in the Session tab. An agent message longer than 6 lines SHALL show its first 6 lines and "Show more".

#### Scenario: First message once
- **WHEN** the person opens a task whose thread has `task.created`, `task.claimed`, `session.started` and a `message.human` with source `first`
- **THEN** Activity shows the first message once as the description, the line "Created by human@macbook-pro", and no claim, session or input row

#### Scenario: Message from the terminal
- **WHEN** the thread has a `message.human` with source `typed` and no `delivery_id`
- **THEN** Activity shows its raw text as a message of the person

#### Scenario: Show raw
- **WHEN** the first message is "# Plan\n\nUse **cents**." and the person turns on "Show raw"
- **THEN** the description shows the exact text "# Plan\n\nUse **cents**."

#### Scenario: Stopped session
- **WHEN** the person stops the session of AW-1 on ubuntu-01 and the thread gets `session.ended` with the reason `stopped`
- **THEN** Activity shows "Session stopped on ubuntu-01: a person stopped it or ended the agent. AW starts no new session until a person starts one."

#### Scenario: Moved session
- **WHEN** the thread has `session.ended` with the reason `moved`
- **THEN** Activity shows no line for it, and the Session tab shows "Session ended (moved)"

#### Scenario: Turn text stays in Session
- **WHEN** the thread has `message.agent` "Plan: …" with the source `turn` and `message.agent` "Tests pass" with the source `tool`
- **THEN** Activity shows "Tests pass" only, and the Session tab shows both texts

#### Scenario: Old agent message
- **WHEN** the thread has `message.agent` with no source
- **THEN** Activity shows it

#### Scenario: Nudge notice
- **WHEN** the thread has `message.sent` with `kind: nudge` by `aw@ubuntu-01`
- **THEN** Activity shows no row for it, and the Session tab shows it

### Requirement: Appearance
Settings SHALL have "Appearance" with System, Light and Dark. The choice SHALL be stored as `appearance` in `<userData>/aw-desktop.json` (default `system`; an unknown value counts as `system`). The main process SHALL set `nativeTheme.themeSource` to the choice at the start, before the first window, and after each change, so the renderer, the window background and the menus use that scheme.

#### Scenario: Choose Light
- **WHEN** the system scheme is dark and the person selects Light in Settings
- **THEN** the app sends `setAppearance` with `light`, `aw-desktop.json` has `"appearance": "light"`, and the page uses the light tokens

#### Scenario: Restart keeps the choice
- **WHEN** `aw-desktop.json` has `"appearance": "light"` and the app starts
- **THEN** the first window has the light `canvas` background and the page uses the light tokens

### Requirement: Loading rows
While the data of a screen loads, the screen SHALL show nothing for 300 ms, then skeleton rows of the size of its content, not a "Loading …" text line. This applies to Devices & sync, Knowledge, Files, the task detail, the Board and List, and the Inbox.

#### Scenario: Slow load
- **WHEN** the devices route has not replied after 300 ms
- **THEN** the Devices page shows skeleton rows and no text "Loading"

### Requirement: Settings sections
The Settings page SHALL show titled sections: Appearance, Startup ("Open at login"), Notifications, Sync across networks, Workspaces on this computer and Setup check. "Workspaces on this computer" SHALL list each workspace of this device with its name and its folder, from the workspaces route. The recovery phrase reminder SHALL stay above them.

#### Scenario: Open at login has a title
- **WHEN** the person opens Settings
- **THEN** the "Open at login" switch is in a section with the title "Startup"

#### Scenario: Workspace folders
- **WHEN** this device has the workspaces Personal at `~/AW/Personal` and demo at `/srv/work/demo-aw1`
- **THEN** "Workspaces on this computer" shows both names with these folders

### Requirement: Native folder picker
The bridge SHALL have the call `chooseFolder` with `purpose` (`checkout` or `workspace`) and an optional absolute `default_path`. Main SHALL show the native folder dialog (open a folder, create a folder) and SHALL return the chosen absolute path, the folder name, and `git: true` when the folder has a `.git` folder or file; on cancel it SHALL return `path: null`. Main SHALL refuse a relative `default_path`. The renderer SHALL get a checkout path only from this call or from a path that the person typed in Project settings.

#### Scenario: Pick a checkout
- **WHEN** the person picks the folder `/Users/example/dev/example-org/billing-api`, which has a `.git` folder
- **THEN** `chooseFolder` returns `path: /Users/example/dev/example-org/billing-api`, `name: billing-api` and `git: true`

#### Scenario: Cancel
- **WHEN** the person cancels the folder dialog
- **THEN** `chooseFolder` returns `path: null`, and the field keeps its value

### Requirement: Top bar with no workspace
The top bar SHALL show Sync, New session and New task only when a workspace exists.

#### Scenario: First run
- **WHEN** the app starts and awd has no workspace
- **THEN** the top bar shows no Sync, New session or New task button

### Requirement: Assign in one click
The Assign card SHALL show the default agent of the project on its first device as one filled button "Assign to <agent>", the other agents of the project devices as outline buttons, and a free-text agent field only after "Other agent…".

#### Scenario: Default agent
- **WHEN** the task `AW-1` of `billing-api` (default agent `claude`, devices `macbook-pro`) has no assignee and the person selects "Assign to claude@macbook-pro"
- **THEN** the app sends `assignTask` with `claude@macbook-pro`

### Requirement: Question details and context on gate cards
A gate card in the Inbox detail and in Activity SHALL show the gate text as Markdown above the choices when the gate has a body (the trimmed text is not empty and not the trimmed title). A body longer than 12 lines SHALL show its start and "Show more". A `question` or `reply` gate with no body SHALL show "Context": the `message.agent` texts after the last event by `human@…` before its `gate.opened`, oldest first, at most 5, each longer than 6 lines clamped with "Show more". With no such message, the card SHALL show no Context.

#### Scenario: Details
- **WHEN** the agent asks "Which queue library?" with details
- **THEN** the card shows the title, the details as Markdown, and then the option buttons

#### Scenario: Analysis before the question
- **WHEN** the agent writes its analysis with `aw message` and then asks "Which option? (see the gate message above)" in the same turn
- **THEN** the card shows the analysis under "Context" above the buttons a, b, c and d

### Requirement: Gate cards with questions
When `gate.opened` has `questions`, the card SHALL show each option description under its label. A gate with one single-choice question SHALL keep one button per option. A gate with 2 or more questions, or a multiSelect question, SHALL show each question with its header and its options as choices (one pick, or any picks for multiSelect), and "Send answers", which sends one answer: `"<question>"="<answer>"` for each question joined by `, `, multiSelect labels joined by `, `, and `(no option selected)` for a question with no pick.

#### Scenario: Two questions
- **WHEN** the person picks "Library B" for "Which queue library do we use?" and "Unit tests" and "Leak check" for "Which checks must run before the release?", and selects "Send answers"
- **THEN** the answer is `"Which queue library do we use?"="Library B", "Which checks must run before the release?"="Unit tests, Leak check"`

### Requirement: Session link in the summary
The session summary of the Session tab SHALL show the full session id (the Claude session id), the session name, the terminal (`tmux window <window> · pane <pane>` or `Orca terminal <pane>`) and the pid, when `session.started` has them. The merge SHALL copy `name`, `terminal` and the pane pid into the session view. A `session.resumed` of the same session SHALL keep the name, and SHALL replace the terminal and the pid when it has them.

#### Scenario: Link of a tmux session
- **WHEN** `session.started` of AW-7 has the name `AW-7`, the window `aw-01a2`, the pane `%12` and the pid 4242
- **THEN** the session summary shows the full session id, "AW-7", "tmux window aw-01a2 · pane %12" and "pid 4242"

