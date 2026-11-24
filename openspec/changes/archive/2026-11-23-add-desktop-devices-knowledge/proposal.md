## Why
The desktop app shell (add-desktop-app-shell) shows tasks and gates only. A person cannot see the devices and the sync state, pair a device, read the knowledge, look at the files of a task, or manage credentials from the app. The app also has no notifications, no menu bar item and no login item (`docs/phase-1.md` 6.4, 6.5, 7, 10; `docs/tech-stack.md` 1.4; `docs/decisions/2026-11-23-manual-move.md`).

## What Changes
- Devices & sync page: each device with its role, last heartbeat, sync state per folder and engine state. The "Sync" button (header, Devices page, menu item "Sync now" on `CmdOrCtrl+R`) syncs and shows the result, with no move suggestion. Revoke with a confirmation that names the sessions that stop.
- Pair a device: start a pairing, show the QR code (the `qr_svg` of awd) and the code as text, wait for the new device, approve with the check code that the new device shows. The recovery phrase screen on the device with the master key: show the 24 words once, then confirm 3 of them.
- Paused task: "Assign to another device…" writes one human `task.assigned`. The dialog selects no device for the person.
- Knowledge: the project and shared trees, the file view (Markdown), the history with Undo, the learned entries ("Learned by claude@ubuntu-01 on AW-7"), the pending suggestions with Accept and Reject, and the daily digest card in the Inbox.
- Files: the read-only folder tree of a task and a file viewer. The Inbox card "Fix a file" for a document that fails its schema, with "Open file" and "Restore last valid version".
- Main process: gate notifications with the actions of `architecture.md` 4.10.6 (code path; the unsigned build cannot show them), the menu bar Tray with the needs-you count and the changes not synced, Sync now before sleep, and the "Open at login" setting.
- Credentials page: list the names, add one (value from a password field, never shown again), remove one.
- awd: new read routes for the presence and the files of a task, and a route that restores the last valid version of a document. They are in one new route file.
- `@aw/client`: `@aw/client/desktop` (the schemas and `DesktopClient` of the new routes) and `@aw/client/views` (plain reply types for the renderer).

## Capabilities

### New Capabilities
- `desktop-devices`: the Devices & sync page, the Sync button, revoke, pairing, the recovery phrase screen, credentials, "Assign to another device…".
- `desktop-knowledge`: the knowledge trees, the file view, history with Undo, learned entries, suggestions, the digest card; the Files view and "Fix a file".
- `desktop-background`: the notifications, the Tray, Sync before sleep and the login item.

### Modified Capabilities
- `desktop-app`: "Navigation and layout" (the sidebar has Devices & sync, Knowledge, Credentials and Settings; Knowledge and Files are real screens).
- `local-api`: new routes (presence, task files, restore a document).

## Impact
- `desktop/`: main (calls, notifications, tray, prefs, index), shared contract, renderer screens and tests. New dependency `@aw/plugin-api` (workspace types only).
- `daemon/src/api/desktop-routes.ts` (new), one registration line in `app.ts`, 2 small getters in `service/workspace.ts`, `contracts/openapi.yaml` regenerated.
- `shared/client`: 2 new files and 2 export lines.
- Docs: `docs/phase-1.md` (desktop scope lines), `AGENTS.md` status line.
