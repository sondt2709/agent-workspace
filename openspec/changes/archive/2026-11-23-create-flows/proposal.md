## Why

A UI review found that the flows to create a workspace, a project and a task are hard to use (decision 36, review `ui-ux.md` 5.3). After the first workspace, the Inbox shows no way to add a project. "Add project" hides in the "⋮" menu and asks for no folder. The checkout is a typed absolute path in Project settings. New task opens with no project, empty selects and free-text credentials (F-5, F-22, F-30, F-32, F-33, F-38).

## What Changes

- A new bridge call `chooseFolder`: main shows the native folder dialog and returns the path, the folder name and whether it is a git repository. The renderer gets only the path that the person picked.
- "Add a project" asks for the checkout folder (native picker) and the name, then writes the project and the binding of this device in one step. The name and the slug come from the folder name.
- Entry points of "Add a project": a "+" next to the workspace name in the sidebar, the workspace menu, the empty Inbox, and New task with no project. The dialog is in the dialog provider, so a resize does not close it.
- New task: "Add a project first" when the workspace has no open project; "None" shows in empty selects; "Start the agent now" assigns the project default agent on its first device; credentials are chips from the credential list; a footer status line.
- The top bar hides Sync, New session and New task when no workspace exists.
- Empty states with one next step: Inbox (no project, no task), Board and List (no task), an empty Board column.
- New session starts with the task of the current page, shows where the session works, and links to the Orca switch of this device.
- The Assign card assigns the default agent in one click; the free-text agent field shows only after "Other agent…".
- Project settings and "Add a workspace" get "Choose…" next to the folder field.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `desktop-app`: Inbox, Board and List get empty states with a next step; New task and New session change (no project, "Start the agent now", credential chips, the task of the page, the folder line); the native folder picker call; the Assign card; the top bar with no workspace.
- `workspace-setup`: the desktop setup screens add a project with its checkout folder and the binding of this device in one step, from 4 entry points, and the folder fields get the native picker.

## Impact

- Code: `desktop/src/main` (new `folder-picker.ts`, `calls.ts`, `index.ts`), `desktop/src/shared` (`channels.ts`, `contract.ts`), `desktop/src/renderer` (new `ProjectCreate.tsx` and `create-model.ts`; `dialogs.tsx`, `WorkspaceMenu.tsx`, `AppShell.tsx`, `Inbox.tsx`, `TaskViews.tsx`, `common.tsx`, `GateCard.tsx`, `ProjectSettings.tsx`).
- API: no awd route, file format or dependency change. The bridge contract gets one call (`chooseFolder`).
- Docs: `docs/design.md` (8.13, new 8.17), `docs/phase-1.md` 10 (new item 14).
- Phone: no change in this task (open item: credential chips on the phone New task).
