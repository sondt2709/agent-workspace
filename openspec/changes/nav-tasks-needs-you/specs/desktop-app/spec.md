## MODIFIED Requirements

### Requirement: Navigation and layout
The window SHALL have a sidebar as "Sidebar counts and sync state" of desktop-navigation says, and no row for each project. A project SHALL be a filter of Tasks and of the Inbox (capability `tasks-view`). The project pages SHALL show a header with the project name and the tabs Knowledge, Files and Settings. The URLs `/w/<ws>/p/<project>`, `/board` and `/list` SHALL open Tasks › All with the filter of that project and the view Board or List. The layout SHALL work from a 400 × 480 window to a wide screen: a temporary drawer below 600 px, an icon rail up to 1200 px, a 240 px drawer above. A task SHALL open as the task page (the task route) at each window width: from the Board, the List, Tasks › Needs you and the command menu. Back on the task page SHALL return to the screen that opened it, with its search parameters. Below 840 px a selected "Needs you" row, knowledge file, device or task folder SHALL replace the list; from 840 px list and detail show side by side.

#### Scenario: Narrow window
- **WHEN** the window is 400 px wide and the person selects a task in the List
- **THEN** the task page replaces the list, and Back returns to the list

#### Scenario: A task opens as a page on a wide window
- **WHEN** the window is 1440 px wide and the person clicks the card of AW-1 on the Board of Tasks › All
- **THEN** the task page of AW-1 fills the content area with no board next to it, and Back returns to the Board with the same filter

#### Scenario: Knowledge in a narrow window
- **WHEN** the window is 400 px wide and the person selects a knowledge file
- **THEN** the file view replaces the tree, and Back returns to the tree

#### Scenario: Old project URL
- **WHEN** the person opens `/w/<ws>/p/billing-api/list`
- **THEN** the app shows Tasks › All as a List with the filter `billing-api`

## REMOVED Requirements

### Requirement: Inbox
**Reason**: The Inbox shows the cards of the incoming messages (change `inbox-mattermost`). The items that need the person move to Tasks › Needs you.
**Migration**: Tasks › Needs you (capability `tasks-view`) has the same rows, detail, actions and empty states; the tab "Updates" is its section "Updates".
