## Context
Review `ui-ux.md` 5.6 compares the desktop app (`c81ef50`) with the phase 1 prototype. The look of `docs/design.md` is built (openspec `design-system`), the task view (`task-view-focus`) and the create flows (`create-flows`) are done. The structure of the shell, the Inbox, the Board and the List is still the old one. `create-flows` left the "+" (`AddProjectButton`), `usePageTask()` and the `ws` prop of `TopBar` for this change.

## Goals / Non-Goals
**Goals:**
- The sidebar, top bar, project tabs, All tasks, Inbox, Board, List and ⌘K of design.md 8.2 to 8.5 and 8.9.
- Keep the create entry points of `create-flows` and the task view of `task-view-focus`.
- Each screen works from 400 px to a wide screen, in dark and light.

**Non-Goals:**
- No awd, bridge, schema or file format change. No new dependency.
- No phone change (the phone Inbox has its own tabs; "Updates" is an open item).
- No "Recent activity" in the Inbox detail, no app menu "Go" items, no drag and drop on the Board.

## Decisions
1. **Pure model, thin components.** `nav-model.ts` holds the logic with no React: the breadcrumb parts of a path, the Inbox items, the project counts, the sync summary and the command options with their filter. Unit tests cover it. Alternative: logic in the components; harder to test.
2. **Routes keep their URLs.** The project routes become children of `w/:ws/p/:project` with the element `ProjectFrame` (header and tabs, then `<Outlet/>`). All tasks is the new route `w/:ws/tasks` (next to `w/:ws/tasks/:task`). Deep links of notifications stay valid.
3. **The current workspace** is the `ws` of the route; on a route with no `ws` (`/settings`), the last one of the session, else the first workspace. The sidebar shows only its projects. The switcher navigates to `/w/<id>/inbox`.
4. **Inbox items.** "Needs you": each task in the lane (or with an answer notice), each `bad_document` issue ("Fix a file"). The sidebar and top bar count these items, not the open gates (F-10). Under them, the groups Working now, Paused and Queued (the `listGroups` rule). "Updates": the knowledge digest of today and each peer that is offline with changes not synced. The selection is the search param `item`, the tab is `tab`. From 840 px the first item shows when none is selected. Below 840 px the detail replaces the list, with Back.
5. **Board swimlane with CSS grid subgrid.** Each stage column is a `section` (the region name stays the stage name) that spans the grid rows with `grid-template-rows: subgrid`, so the "Needs you" cells and the "Everything else" cells align across the columns. The lane labels span all columns and stick to the left. Columns use `minmax(160px, 1fr)`: all 6 fit at 1280 px with the 240 px sidebar. Alternative: one flex row per lane; then a column is not one region and the empty-column rule is harder.
6. **Project mark.** A neutral letter tile, not a color dot: `project.yaml` has no color, and design principle 3 keeps color for status.
7. **Shortcuts in the renderer.** A `keydown` listener in the shell handles ⌘K and ⌘1 to ⌘4 (Ctrl on other systems). No bridge or menu change, so the parallel create-flows check has no conflict. The app menu keeps ⌘N and ⌘R.
8. **Command menu.** MUI `Dialog` + `Autocomplete` (`open`, `disablePortal`, `groupBy`), 640 px at the top third, 36 px rows with the shortcut hint. Options: actions, screens, projects (Board), tasks (key and title). The filter matches each word in the key, the title and the label. Enter runs the option.
9. **List keyboard.** ↑ ↓ move the focus between the rows of the List; Enter opens (the row is a button); Esc closes the detail of the split when the focus is not in a text field.
10. **No Join in the switcher.** A device with a workspace has its identity and master key; joining another workspace is not checked in phase 1. "Join with a pairing code" stays on the first-run screen.

## Risks / Trade-offs
- [The sidebar reads the tasks, issues and sync state of the workspace on each screen] → the same query keys as the Inbox (cache hits); the sync state reads again every 10 s, as the Devices screen.
- [Subgrid support] → Electron 45 (Chromium) supports it; jsdom does not lay out, so tests check the DOM structure, and the real-app screenshots check the layout.
- [Tests and capture scripts that used the old labels ("Other active tasks", the "⋮" button)] → update the unit tests in this change; the review tools of other tasks are local.
- [160 px columns are narrow] → the title wraps to 2 lines, the assignee is cut with an ellipsis and has a tooltip.
