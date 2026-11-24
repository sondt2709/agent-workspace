## Why
The UI/UX review (findings F-27 to F-31 and F-34) found that Devices & sync, Knowledge, Files, Credentials, Settings and Project settings do not show the content of the phase 1 prototype. Devices shows one line per device, Files shows UUIDs, Knowledge repeats its group labels, Settings has no appearance choice, and Project settings is one long form. The owner also found that the session host of Project settings does not say what it changes (fix list ux-1). The design system (`docs/design.md`) is merged, so these screens can now use its layout.

## What Changes
- Devices & sync: a card for each device with property rows: presence, sync, route, folders, agent, sessions, test slots, session hosts, "Use Orca", the checkouts and their host. A block "Sync between your devices" with the engine state and the 3 folders. Only data of the current routes.
- Knowledge: one tree of groups (Rules, Knowledge, Learned) on each page; on the project page, shared files carry a "shared" tag. From 840 px the first file opens when no file is selected. The file view shows "Last change" and "Location".
- Files: task rows show the key, the title and the stage, not the task id. The folder root is one line with the full path in a tooltip.
- Credentials: list rows with a mono name, a meta line and a destructive Remove; the empty state has "Add a credential".
- Settings: titled sections: Appearance (System, Light, Dark), Startup ("Open at login"), Notifications, Sync across networks, Setup check.
- Appearance: a new desktop preference `appearance` in `aw-desktop.json`. Main sets `nativeTheme.themeSource`, so the window, the renderer and the menus follow it. New call `setAppearance`; `AppSettings` gets `appearance`.
- Project settings: sections General, Devices, Test servers (chips), one Save; "This device" with a help line under the session host that says where a session works; Archive.
- Loading: skeleton rows after 300 ms replace the "Loading …" text lines of these screens, the task detail, the Board and List, and the Inbox.
- Small fixes of the design-system check: no type sizes in the screen code of these screens and of `MarkdownText` (dsc-10); the "Open at login" section has a title (dsc-11).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `desktop-devices`: the Devices and sync page shows a card with property rows for each device; the Credentials page has an empty state with "Add a credential".
- `desktop-knowledge`: one group tree with the shared tag, the first file opens, the file view shows the last change; the Files view shows task keys and titles, not ids.
- `desktop-app`: new requirements "Appearance" and "Loading rows".
- `workspace-setup`: the project Settings page is in sections and explains the session host.

## Impact
- Code: `desktop/src/renderer/src/components/` (Devices, Knowledge, Files, Settings, ProjectSettings, common, and one line each in TaskDetail, TaskViews, Inbox), `devices-model.ts`, `kb-model.ts`, `desktop/src/main/` (prefs, index, calls), `desktop/src/shared/` (channels, contract).
- No awd, API, file format or dependency change. `aw-desktop.json` gets one optional key; old files stay valid.
- Docs: `docs/design.md` (status and the page layouts of these screens), `docs/phase-1.md` 10.13 (Appearance).
- Phone: Android follows the system scheme; an Appearance choice on the phone is an open item.
