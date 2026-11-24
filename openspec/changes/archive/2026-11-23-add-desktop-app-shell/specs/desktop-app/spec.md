## ADDED Requirements

### Requirement: One awd connection in the main process
The Electron main process SHALL own the only awd client of the app, on `~/.aw/run/awd.sock` (or `$AW_HOME/run/awd.sock`), with `@aw/client`. It SHALL open the event stream, forward each event message to the window, and reconnect after a close or a failure with an exponential backoff (start 500 ms, at most 30 s, with jitter). After each reconnect it SHALL send `resync` to the window. It SHALL never open a TCP connection to awd.

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

#### Scenario: Page load
- **WHEN** the window loads `app://aw/index.html`
- **THEN** the reply has the CSP header with a nonce, and the page has a `csp-nonce` meta tag with the same nonce

#### Scenario: Path outside the build folder
- **WHEN** a request asks for `app://aw/..%2Fmain/index.js`, or for a file that is not in `out/renderer/`
- **THEN** the reply is 404

### Requirement: Server state and events in the renderer
The renderer SHALL keep awd data only in TanStack Query (`staleTime: Infinity`, no refetch on focus, retry 0), with each `queryFn` on the bridge. A `changed` event SHALL invalidate the queries of the listed tasks and their threads, the task lists and the gates of the workspace, and the projects when `documents_changed` is true; a `full` or `workspace_changed` event, or a `resync`, SHALL invalidate all queries of the workspace or of the app. The selection and the filters SHALL be in the route.

#### Scenario: A gate opens on another device
- **WHEN** awd sends `changed` for task `AW-3`
- **THEN** the queries of `AW-3`, of its thread and of the task and gate lists refetch, and the Inbox shows the new gate

### Requirement: Navigation and layout
The window SHALL have a sidebar with the Inbox, each workspace and its projects, and for each project Board, List, Knowledge and Files (Knowledge and Files show "Comes with the knowledge and files screens"). The layout SHALL work from a 400 × 480 window to a wide screen: a temporary drawer below 600 px, an icon rail up to 1200 px, a 240 px drawer above; below 840 px a selected task replaces the list; from 840 px list and detail show side by side with a divider that the person drags.

#### Scenario: Narrow window
- **WHEN** the window is 400 px wide and the person selects a task in the List
- **THEN** the task detail replaces the list, and Back returns to the list

### Requirement: Inbox
The Inbox SHALL show each task in the "Needs you" lane first, with one card for each open gate and for each other reason (assign, a pause that needs the person). The person SHALL act on a gate in the card. Below them, the Inbox SHALL list the other active tasks.

#### Scenario: Answer in place
- **WHEN** the Inbox shows the question gate of `AW-3` with the options `100/min` and `1000/min`, and the person selects `100/min`
- **THEN** the app sends `answerGate` with that answer and the gate version, and the card shows "Answer sent" until the gate resolves

### Requirement: Board and List
The Board SHALL show the columns Backlog, Discuss, Ready, Implement, Review and Done, and before them the "Needs you" lane with each task that has a "Needs you" reason. A task SHALL show in one place only: a task in the lane is not in its stage column. A paused task SHALL show a Paused chip with its cause. The List SHALL show the same tasks in groups: Needs you, Running, Paused, Backlog, Done. Archived tasks SHALL not show.

#### Scenario: Paused task
- **WHEN** a task in Implement has `paused.cause: device_offline`
- **THEN** its card is in the Implement column with the chip "Paused · device offline"

### Requirement: Task detail
The task detail SHALL show the key, the title, the stage, the first message, the approach versions (latest and confirmed), the test server, the credential names, the assignee, the parent and the subtasks, the session, and the thread with the raw text of each message. Each open gate SHALL show as a gate card: Answer question and Reply (options and free text), Confirm approach and Approve result (confirm or approve, or request changes with a required comment), Assign task (an `agent@device` choice), Approve command (Allow once, Allow for this task, Deny, a countdown from 120 s), Fix a file (its options), and other kinds with their options. A message box SHALL send a message to the running session.

#### Scenario: Approve command countdown
- **WHEN** an Approve command gate opened 30 s ago
- **THEN** the card shows "Denies in 90 s"; after 120 s it shows "Denied after 120 s" and a late "Allow once" still sends an answer

#### Scenario: Request changes needs a comment
- **WHEN** the person selects "Request changes" on Confirm approach with an empty comment
- **THEN** the send button is disabled

### Requirement: New task and New session
The New task dialog SHALL have the first message (required), the project, the title (made from the first line of the first message when empty), the assignee (default none, so the task opens "Needs you: assign"), the test server, the credential names and the parent task, and SHALL call `createTask`. The New session dialog SHALL select a task and an `agent@device`, show the session host (tmux; Orca only when the device reports it), and SHALL write a human `task.assigned`, so that the device of the agent claims the task with a higher epoch.

#### Scenario: Title from the first message
- **WHEN** the person writes the first message "/my-team:implement Add a CSV export" and leaves the title empty
- **THEN** `createTask` gets the title "/my-team:implement Add a CSV export"
