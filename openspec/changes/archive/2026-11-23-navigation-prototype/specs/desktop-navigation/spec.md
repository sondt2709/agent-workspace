## ADDED Requirements

### Requirement: Sidebar counts and sync state
The Inbox item of the sidebar SHALL show the number of "Needs you" items of the Inbox in the `you` color. All tasks SHALL show the number of active tasks that are not done. A project row SHALL show the number of its tasks that need the person and of its working tasks. The sidebar footer SHALL show the name of this device and the sync state ("Synced", "Syncing", "3 changes not synced", "Sync is off"), which opens Devices & sync, and a Sync button that opens the Sync dialog.

#### Scenario: Counts
- **WHEN** the workspace has 4 tasks in the "Needs you" lane, 1 file to fix and 2 working tasks of `billing-api`
- **THEN** the Inbox item shows 5, and the row of `billing-api` shows its "Needs you" tasks and 2 working tasks

#### Scenario: Offline peer
- **WHEN** the sync status has the offline peer `ubuntu-01` with 3 items to send
- **THEN** the footer shows "3 changes not synced", and the Inbox tab "Updates" lists the text of that peer

### Requirement: Top bar breadcrumb
The top bar SHALL show a breadcrumb: the workspace and the screen (Inbox, All tasks, Devices & sync, Shared knowledge, Credentials), or the workspace, the project and the project tab, or the workspace, the project and the task key. The earlier parts SHALL be links. Below 600 px it SHALL show the last part only. The top bar SHALL show the number of "Needs you" items, which opens the Inbox, the sync state (from 1200 px; the sidebar footer shows it at each width), Sync now, New session and New task with the hint ⌘N.

#### Scenario: Task route
- **WHEN** the person opens the task `AW-7` of `billing-api` in the workspace Personal
- **THEN** the breadcrumb shows "Personal › billing-api › AW-7", and "billing-api" opens its Board

### Requirement: All tasks
The app SHALL have the screen All tasks with the tabs Board and List of all tasks of the current workspace, with the same cards, rows, groups and task detail as the project screens.

#### Scenario: Tasks of 2 projects
- **WHEN** the workspace has tasks in `billing-api` and `web-app` and the person opens All tasks
- **THEN** the Board shows the tasks of both projects, each card with its project

### Requirement: Command menu
⌘K (Ctrl+K on other systems) SHALL open the command menu: a search field with the actions New task, New session, Sync now and Add a project, the screens, the projects and the tasks of the current workspace by key and title. Each action SHALL show its shortcut. Enter SHALL run the selected item, and Esc SHALL close the menu. ⌘1, ⌘2, ⌘3 and ⌘4 SHALL open Inbox, All tasks, Devices & sync and Settings.

#### Scenario: Open a task by key
- **WHEN** the person presses ⌘K, types "AW-7" and presses Enter
- **THEN** the app opens the task `AW-7`

#### Scenario: Screen shortcut
- **WHEN** the person presses ⌘2
- **THEN** the app opens All tasks of the current workspace
