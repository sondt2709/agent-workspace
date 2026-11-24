## 1. Folder picker (main and bridge)

- [x] 1.1 Add `desktop/src/main/folder-picker.ts`: `chooseFolder` with an injected dialog and `.git` check; unit tests (cancel, pick, git folder, git file, no git, options per purpose, `default_path`)
- [x] 1.2 Add the call `chooseFolder` to `channels.ts`, `contract.ts` (purpose enum, absolute `default_path`), `calls.ts` (`HostDeps.chooseFolder`) and `index.ts`; contract and call tests

## 2. Add a project

- [x] 2.1 Add `create-model.ts`: name and slug from a folder, folder inside the workspace check, start agent of a project; unit tests
- [x] 2.2 Add `ProjectCreate.tsx`: `FolderField` and `AddProjectDialog` (pick, name, slug, warnings, `addProject` then `editBindings`, retry of the binding only)
- [x] 2.3 Add `addProject(ws, then)` to `useDialogs` and render the dialog in `DialogsProvider`; the workspace menu item uses it
- [x] 2.4 Sidebar "+" next to the workspace name (`AppShell.tsx`)
- [x] 2.5 Tests: AddProjectDialog sends both calls; binding error keeps the project; workspace folder refused; dialog stays open after a resize

## 3. New task and New session

- [x] 3.1 New task: "Add a project first", "None" in empty selects, "Start the agent now", credential chips, footer status line, no key preview
- [x] 3.2 New session: starts with the task of the page, Task field always visible, folder line, Orca link
- [x] 3.3 `MenuCommands` and `TopBar` pass the task of the route; `TopBar` hides its actions with no workspace
- [x] 3.4 Tests: no project, start agent, credential chips, empty selects, New session task, top bar with no workspace

## 4. Empty states, Assign card, folder fields

- [x] 4.1 `Empty` gets an optional `action`; Inbox (no project, no task), Board and List (no task), empty Board column
- [x] 4.2 Assign card: "Assign to <default>" filled, other agents outline, "Other agent…" shows the field
- [x] 4.3 "Choose…" in Project settings (checkout) and "Add a workspace" (folder); "Use another name or folder" as a text link
- [x] 4.4 Tests: Inbox and Board empty states, Assign card one click, Project settings picker fills the field

## 5. Docs and checks

- [x] 5.1 `docs/design.md` (status, 8.13, new 8.17 Create flows), `docs/phase-1.md` 10 item 14
- [x] 5.2 Break each new test once and restore; `cd desktop && task check`
- [x] 5.3 Real-app journey (`tools/journey.sh`) and after captures (1280 dark, 1280 light, 400 dark)
- [x] 5.4 Root `task check` on the final commit
