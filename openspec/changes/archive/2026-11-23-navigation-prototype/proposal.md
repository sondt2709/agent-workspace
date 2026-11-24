## Why
The desktop app has all phase 1 functions, but the person does not move through it as in the prototype (review `ui-ux.md` 5.6). The sidebar has 5 rows per project and every workspace, the top bar repeats the window name, the Inbox is a long column of large cards, the Board has "Needs you" as a separate column, the List has two-line rows, and no command menu exists (F-2, F-9 to F-16, F-24, F-39, F-40).

## What Changes
- Sidebar: a workspace switcher at the top; Inbox with the count of "Needs you" items; All tasks; "Projects" with one row per project and its counts; "Workspace" (Shared knowledge, Credentials); "This device" (Devices & sync, Settings); a footer with the device name, the sync state and Sync. Only the current workspace shows.
- The switcher menu lists each workspace with its folder, and has "Add a project…", "Add a workspace…", "Rename…" and "Remove from this device…". It replaces the "⋮" menu and the "Add workspace" item.
- Top bar: a breadcrumb, the "Needs you" count, the sync state, Sync now, New session and New task with its shortcut hint.
- Project pages: a project header with the tabs Board, List, Knowledge, Files and Settings. The URLs stay.
- All tasks: a new screen `/w/:ws/tasks` with Board and List of all tasks of the workspace.
- Inbox: list and detail with the tabs "Needs you" and "Updates".
- Board: "Needs you" is a swimlane row across the 6 stage columns; quiet cards with the age; each column has a short description; all 6 columns show at 1280 px.
- List: one-line rows with the age; collapsible group headers; ↑ ↓, Enter and Esc.
- Command menu: ⌘K opens a search of actions, screens, projects and tasks. ⌘1 to ⌘4 open Inbox, All tasks, Devices & sync and Settings.

## Capabilities

### New Capabilities
- `desktop-navigation`: the sidebar with the workspace switcher, the top bar with the breadcrumb and the sync state, the project header tabs, All tasks, the command menu and the navigation shortcuts.

### Modified Capabilities
- `desktop-app`: "Navigation and layout" (the sidebar items and the project tabs), "Inbox" (list and detail with "Needs you" and "Updates"), "Board and List" (the swimlane, the quiet card, the one-line row, the keyboard).
- `workspace-setup`: "Desktop setup screens" and "Add a project with its checkout" (the workspace actions and the "+" move into the switcher and the Projects section).

## Impact
- Desktop renderer only: `AppShell.tsx`, `WorkspaceMenu.tsx`, `Inbox.tsx`, `TaskViews.tsx`, `routes.tsx`, new `nav-model.ts`, `ProjectFrame.tsx`, `CommandMenu.tsx`.
- No awd route, bridge call, schema, file format or dependency change. The phone does not change (open item: the phone Inbox has no "Updates" tab).
- Docs: `docs/design.md` 8.2 to 8.5 and 8.9; `docs/phase-1.md` 10 (a new item for the desktop navigation).
