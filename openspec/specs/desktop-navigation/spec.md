# desktop-navigation Specification

## Purpose
The navigation of the desktop app: the sidebar counts and the sync state, the breadcrumb of the top bar, All tasks, the command menu and the screen keys.
## Requirements
### Requirement: Sidebar counts and sync state
The sidebar SHALL have, from the top: the workspace switcher; Inbox with the number of unread open cards; Tasks with the number of "Needs you" items in the `you` color (the tasks in the lane, the tasks that keep an answer notice and the files to fix); then, at the bottom, Projects, Knowledge, Sources, Credentials, Devices & sync and Settings. The sidebar SHALL NOT have a row for each project. The sidebar footer SHALL show the name of this device and the sync state ("Synced", "Syncing", "3 changes not synced", "Sync is off"; only a connected device that is not in sync makes "Syncing"), which opens Devices & sync, and a Sync button that opens the Sync dialog.

#### Scenario: Counts
- **WHEN** the workspace has 4 tasks in the "Needs you" lane, 1 file to fix and 3 unread open cards
- **THEN** the Tasks item shows 5 in the `you` color, and the Inbox item shows 3

#### Scenario: Offline peer
- **WHEN** the sync status has the offline peer `ubuntu-01` with 3 items to send
- **THEN** the footer shows "3 changes not synced", and the section "Updates" of Tasks › Needs you lists the text of that peer

#### Scenario: Offline peer with no change
- **WHEN** `mac-mini-lab` is connected and in sync, and `pixel-9` is offline with no change to get
- **THEN** the footer shows "Synced", not "Syncing"

### Requirement: Top bar breadcrumb
The top bar SHALL show a breadcrumb: the workspace and the screen (Inbox, Tasks, Projects, Sources, Devices & sync, Knowledge, Credentials), or the workspace, the project and the project tab, or the workspace, the project and the task key. The earlier parts SHALL be links. Below 600 px it SHALL show the last part only. The top bar SHALL show the number of "Needs you" items, which opens Tasks › Needs you, the sync state (from 1200 px; the sidebar footer shows it at each width), Sync now, New session and New task with the hint ⌘N.

#### Scenario: Task route
- **WHEN** the person opens the task `AW-7` of `billing-api` in the workspace Personal
- **THEN** the breadcrumb shows "Personal › billing-api › AW-7", and "billing-api" opens Tasks with the filter of `billing-api`

### Requirement: Command menu
⌘K (Ctrl+K on other systems) SHALL open the command menu: a search field with the actions New task, New session, Sync now and Add a project, the screens, the projects and the tasks of the current workspace by key and title. Each action SHALL show its shortcut. When the search text is a task key, that task SHALL be the first row. Enter SHALL run the selected item, and Esc SHALL close the menu. ⌘1, ⌘2, ⌘3 and ⌘4 SHALL open Inbox, Tasks, Devices & sync and Settings. On macOS the keys SHALL use ⌘ only, so Ctrl+K stays "delete to the end of the line" in a text field. While another dialog is open, the keys SHALL do nothing.

#### Scenario: Open a task by key
- **WHEN** the person presses ⌘K, types "AW-7" and presses Enter
- **THEN** the app opens the task `AW-7`, also when the title of `AW-3` contains "AW-7"

#### Scenario: Screen shortcut
- **WHEN** the person presses ⌘2
- **THEN** the app opens Tasks of the current workspace

