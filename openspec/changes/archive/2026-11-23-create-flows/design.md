## Context

Review `ui-ux.md` 5.3 (F-5, F-22, F-30, F-32, F-33, F-38) and decision 36. The base `ecd9fa0` has the screens of design-system, task-view-focus, keys-backup and screens-align. A person who starts with an empty app must find "Add project" in the "⋮" menu, then type the checkout as an absolute path in Project settings. The Add project dialog is rendered inside the sidebar, so it closes when the window gets narrower than 600 px (the sidebar becomes a drawer). awd already has the routes: `POST /projects` (the first device is this device, the default agent is `claude`) and `PATCH /bindings` (it checks that the checkout is an absolute path of an existing folder).

Parallel work: screens-align-check (Project settings and other pages), phone-task-focus (phone). Task 16e (navigation) changes the sidebar after this task, so the sidebar change stays small.

## Goals / Non-Goals

**Goals:**
- From an empty app: workspace, project with its checkout, first task in 3 short steps.
- The checkout folder comes from the native folder dialog.
- Each empty screen says what is missing and offers the next step.

**Non-Goals:**
- No awd route, file format or schema change. No new dependency.
- No sidebar redesign (task 16e). No permission mode or work folder choice (task 16f).
- No key preview in New task (decision 3).
- No phone change (open item).

## Decisions

1. **Folder picker in main.** New call `chooseFolder { purpose: "checkout" | "workspace", default_path? }` returns `{ path: string | null, name: string | null, git: boolean }`. `folder-picker.ts` has the logic with an injected `showOpenDialog` and `isGitRepo` (a `stat` of `<folder>/.git`, a folder or a file for a worktree). Options: `openDirectory`, `createDirectory`; the title and the button text depend on `purpose`. `default_path` must be absolute; it only sets the start folder. Alternative: an `<input type=file webkitdirectory>` in the renderer: it reads the whole folder tree and gives no absolute path in a sandboxed renderer. Refused.
2. **Two awd calls for one step.** The dialog calls `addProject`, then `editBindings` with `{ project, path }`. Alternative: a new awd route that does both: a public API change (medium risk) for a small gain. When the binding fails, the dialog keeps the created project and changes the primary button to "Save the folder", which sends only `editBindings`.
3. **Dialog in the provider.** `useDialogs()` gets `addProject(ws?, then?)`. `then: "task"` opens New task for the new project after the add (from "Add a project first"). Else the app opens the Board of the project. The provider renders the dialog, so a resize does not close it.
4. **Folder checks in the renderer.** Add is off when the folder is inside the workspace folder (`ws.path`), because the devices sync that folder. A folder with no `.git` shows a warning but Add stays on (the person can run `git init` later).
5. **Name and slug.** The name is the folder name; the slug is the name in lowercase with `-` between words, at most 64 characters. A name the person typed is kept when they pick another folder.
6. **"Start the agent now".** A checkbox. On: the assignee is `<default_agent>@<devices[0]>` of the project. The Assignee select shows the same value; "None" turns the checkbox off; another agent keeps it on. A project with no device disables it with a line.
7. **Credentials.** MUI `Autocomplete` (multiple, no free entry) with the names of `useCredentials`.
8. **New session.** `MenuCommands` and `TopBar` pass the task of the route (`/tasks/:task`) or `?task=` to `newSession`. The Task field always shows and starts with that task. The folder line uses the bindings of this device and the session-hosts route for other devices.
9. **Assign card.** The first choice of `agentChoices` (the default agent on the first device) is a filled button "Assign to <agent>"; the others are outline buttons; "Other agent…" shows the text field.

## Risks / Trade-offs

- [The native dialog cannot be driven by CDP] → The evidence wrapper replaces `dialog.showOpenDialog` with a stub that logs the options; unit tests check the options and the result mapping.
- [A project with no checkout after a failed binding] → The same state as the base after "Add project"; the dialog offers to save the folder again, and Project settings also has the picker.
- [AppShell conflicts with task 16e] → Only 3 small changes: the "+" button, the top bar actions with no workspace, the task for New session.
