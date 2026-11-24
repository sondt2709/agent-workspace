## MODIFIED Requirements

### Requirement: Inbox
The Inbox SHALL show each task in the "Needs you" lane first, with one card for each open gate and for each other reason (assign, a pause that needs the person). The person SHALL act on a gate in the card. Below them, the Inbox SHALL list the other active tasks. When the workspace has no open project, the Inbox SHALL show "No projects yet" with the button "Add a project". When it has a project but no active task, the Inbox SHALL show "No tasks yet" with the button "New task".

#### Scenario: Answer in place
- **WHEN** the Inbox shows the question gate of `AW-3` with the options `100/min` and `1000/min`, and the person selects `100/min`
- **THEN** the app sends `answerGate` with that answer and the gate version, and the card shows "Answer sent" until the gate resolves

#### Scenario: Empty workspace
- **WHEN** the person opens the Inbox of a new workspace with no project
- **THEN** the Inbox shows "No projects yet" and "Add a project", and a click opens the Add a project dialog

#### Scenario: Project with no task
- **WHEN** the workspace has the project `billing-api` and no task
- **THEN** the Inbox shows "No tasks yet" and "New task", and a click opens New task

### Requirement: Board and List
The Board SHALL show the columns Backlog, Discuss, Ready, Implement, Review and Done, and before them the "Needs you" lane with each task that has a "Needs you" reason. A task SHALL show in one place only: a task in the lane is not in its stage column. A paused task SHALL show a Paused chip with its cause. A queued task SHALL show the chip "Queued · 2nd for claude@ubuntu-01" and its cause. The List SHALL show the same tasks in groups: Needs you, Running, Paused, Queued, Backlog, Done. The renderer SHALL read the queues route again every 10 s. Archived tasks SHALL not show. A project with no task SHALL show "No tasks yet" with the button "New task" on the Board and the List. An empty Board column SHALL show the line "No tasks".

#### Scenario: Paused task
- **WHEN** a task in Implement has `paused.cause: device_offline`
- **THEN** its card is in the Implement column with the chip "Paused · device offline"

#### Scenario: Queued task
- **WHEN** AW-4 is second in the queue of `claude@ubuntu-01` with the cause "2 sessions working"
- **THEN** the List shows AW-4 in the group Queued with "Queued · 2nd for claude@ubuntu-01" and "2 sessions working", and the task detail shows the same text

#### Scenario: New project board
- **WHEN** the person opens the Board of the new project `billing-api`
- **THEN** the Board shows "No tasks yet" and "New task", and a click opens New task with `billing-api` selected

### Requirement: New task and New session
The New task dialog SHALL have the first message (required), the project, the title (made from the first line of the first message when empty), the assignee (default none, so the task opens "Needs you: assign"), "Start the agent now", the test server, the credential names and the parent task, and SHALL call `createTask`. An empty select SHALL show its empty value ("None") under its label. "Start the agent now" SHALL set the assignee to the default agent of the project on the first device of the project. The credentials SHALL be chips from the credential list of the workspace. When the workspace has no open project, the dialog SHALL show "Add a project first" with the button "Add a project" and no form; after the add, New task SHALL open with the new project. The New session dialog SHALL select a task and an `agent@device` (a new task selection SHALL clear the agent and the host that the person picked for the task before), show the session host, and SHALL write a human `task.assigned` with the chosen `session_host`, so that the device of the agent claims the task with a higher epoch. Opened on a task page or with a selected task, New session SHALL start with that task, and the person SHALL be able to change it. New session SHALL show where the session works: for this device the checkout folder of the project; for another device whether it has a checkout of the project. When Orca is not turned on for this device, the dialog SHALL link to the Project settings of the project. The Orca choice SHALL be enabled only when the bindings of the device have `use_orca: true` and, for this device, awd found Orca; the dialog SHALL first select the `session_host` of the checkout of the project, else Orca when it is enabled, else tmux. While the host list of the session-hosts route loads, the dialog SHALL wait for it or for a host that the person picks; when the list fails and the person picked no host, the dialog SHALL send no `session_host`, and awd decides.

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

## ADDED Requirements

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
