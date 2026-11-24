## 1. Model

- [x] 1.1 Add `nav-model.ts` with tests: breadcrumb parts, Inbox items, project counts, sync summary, command options and their filter

## 2. Shell (commit 1)

- [x] 2.1 Add `WorkspaceSwitcher` to `WorkspaceMenu.tsx` (workspaces with folders, Add a project, Add a workspace, Rename, Remove) and remove the "⋮" menu and the "Add workspace" item from the sidebar
- [x] 2.2 Rebuild the sidebar in `AppShell.tsx`: Inbox and All tasks with counts, Projects with the "+" and one row per project, Workspace, This device, the footer with the device and the sync state; the rail with the same items
- [x] 2.3 Add the breadcrumb, the "Needs you" count and the sync state to the top bar, and the hint ⌘N on New task
- [x] 2.4 Add `ProjectFrame.tsx` (project header with the tabs) and the All tasks frame; nest the project routes and add `w/:ws/tasks` in `routes.tsx`
- [x] 2.5 Rebuild `Inbox.tsx` as list and detail with the tabs "Needs you" and "Updates"
- [x] 2.6 Update the tests of the shell and the Inbox; add tests for the switcher, the counts, the breadcrumb and the Inbox tabs

## 3. Board, List and command menu (commit 2)

- [x] 3.1 Board: stage columns with descriptions, the "Needs you" swimlane row, quiet cards with the age
- [x] 3.2 List: one-line rows with the age, collapsible group headers, Up, Down and Esc
- [x] 3.3 Add `CommandMenu.tsx` (⌘K) and the shortcuts ⌘1 to ⌘4
- [x] 3.4 Tests of the Board swimlane, the List keyboard and the command menu

## 4. Docs and evidence

- [x] 4.1 Update `docs/design.md` (status, 8.2, 8.3, 8.4, 8.5, 8.9) and `docs/phase-1.md` 10
- [x] 4.2 Run `cd desktop && task check`, break each new test once, and run the root `task check`
- [x] 4.3 Capture the screens after each commit (1280 dark, 1280 light, 400 dark) and run the journey and the keyboard checks on the real app
