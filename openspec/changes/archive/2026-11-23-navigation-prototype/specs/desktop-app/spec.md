## MODIFIED Requirements

### Requirement: Navigation and layout
The window SHALL have a sidebar with, from the top: the workspace switcher; Inbox; All tasks; the section Projects with one row for each project of the current workspace; the section Workspace with Shared knowledge and Credentials; the section This device with Devices & sync and Settings; and a footer with the device name, the sync state and Sync. A project row SHALL open the Board of the project. The project pages SHALL show a header with the project name and the tabs Board, List, Knowledge, Files and Settings. The layout SHALL work from a 400 × 480 window to a wide screen: a temporary drawer below 600 px, an icon rail up to 1200 px, a 240 px drawer above; below 840 px a selected task, Inbox item, knowledge file, device or task folder replaces the list; from 840 px list and detail show side by side.

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
The Inbox SHALL show a list and a detail with the tabs "Needs you" and "Updates". "Needs you" SHALL list one row for each task in the "Needs you" lane (with its reason, title, key and project) and for each file to fix, then the groups Working now, Paused and Queued. "Updates" SHALL list the knowledge of today and each device with changes not synced. The detail of a task SHALL show one card for each open gate and for each other reason (assign, a pause that needs the person), and "Open task". The person SHALL act on a gate in the card. A task with an answer notice SHALL keep its row until the person closes the notice. From 840 px the first row shows in the detail when no row is selected, or when the selected row left the list. When the workspace has no open project, the Inbox SHALL show "No projects yet" with the button "Add a project". When it has a project but no active task, the Inbox SHALL show "No tasks yet" with the button "New task". The files to fix and the knowledge of today SHALL show in each state of the Inbox, also with no project or no active task.

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
