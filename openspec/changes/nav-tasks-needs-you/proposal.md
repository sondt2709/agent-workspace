## Why

The Inbox becomes the list of incoming messages (change `inbox-mattermost`). The items that need the person (gates, assign, files to fix) need a new place. A project row for each project in the sidebar does not scale and hides the tasks of other projects. The person approved the prototype `inbox-prototype` v6 on 2026-11-27.

## What Changes

- **BREAKING** The sidebar has Inbox and Tasks at the top. The tools are at the bottom: Projects, Knowledge, Sources, Credentials, Devices & sync, Settings. The project rows go away.
- **BREAKING** Tasks (`/w/<ws>/tasks`) replaces All tasks. It has the tabs "Needs you", "Working" and "All". "Needs you" has the rows of the old Inbox tab "Needs you" with their detail and the files to fix. "Working" has the groups Working now, Paused and Queued. "All" has the List and the Board.
- Project is a filter: a multi-select chip with a search field, in Tasks and in the Inbox. The selection is in the route (`?projects=a,b`). Each task row and card shows its project.
- The page Projects (`/w/<ws>/projects`) lists the projects with their repository, devices and task counts, "Add a project" and a link to the project settings, knowledge and files.
- The old project URLs `/w/<ws>/p/<project>/board` and `/list` open Tasks with the filter of that project. Knowledge, Files and Settings of a project stay.
- The top bar "Needs you" count opens Tasks › Needs you. ⌘1 to ⌘4 open Inbox, Tasks, Devices & sync and Settings.
- The old Inbox tab "Updates" (offline devices with changes, knowledge of today) goes to the end of Tasks › Needs you.
- Phone: Tasks gets the same tabs and the project filter. The bottom bar stays Home, Inbox, Tasks, Devices; Inbox shows the cards of `inbox-mattermost`.
- A task still always has a project. No change to the task model.

## Capabilities

### New Capabilities
- `tasks-view`: the Tasks screen with the tabs Needs you, Working and All, and the multi-select project filter, on the desktop and the phone.

### Modified Capabilities
- `desktop-navigation`: the sidebar items, the counts, the top bar, the screen keys and the command menu.
- `desktop-app`: the window layout without project rows; the old Inbox requirement moves to Tasks › Needs you.
- `android-app`: the phone Tasks screen gets the tabs and the filter; the phone Inbox shows cards.

## Impact

- `desktop/src/renderer`: `AppShell.tsx`, `routes.tsx`, `nav-model.ts`, `Inbox.tsx` (its Needs you part moves to `NeedsYou.tsx`), `TaskViews.tsx`, `CommandMenu.tsx`, new `ProjectFilter.tsx` and `Projects.tsx`.
- `android/control`: `Navigation.kt`, `InboxItems.kt`, a new `ProjectFilter.kt`; `android/app` `ListScreens.kt`.
- `shared/client`: the project filter rule and its fixture `contracts/fixtures/filters/projects.json`.
- `docs/design.md` 8.2 to 8.4, `docs/prd.md`, a decision document.
- No awd route and no file format changes.
