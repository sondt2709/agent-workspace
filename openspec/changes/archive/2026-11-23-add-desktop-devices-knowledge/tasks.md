## 1. awd routes and client

- [x] 1.1 `shared/client/src/views.ts` (plain reply types) and `shared/client/src/desktop.ts` (schemas, `DesktopClient`), with the 2 exports
- [x] 1.2 `WorkspaceService.presence()` and `lastValidDocument(path)`; `daemon/src/service/task-files.ts` (list, read, restore)
- [x] 1.3 `daemon/src/api/desktop-routes.ts` with one registration line; route tests; `contracts/openapi.yaml` regenerated

## 2. Bridge and main process

- [x] 2.1 New calls in `channels.ts`, `contract.ts` and `calls.ts` (sync, identity, pairing, credentials, presence, knowledge, issues, files, prefs, login item, open file); call tests
- [x] 2.2 `main/prefs.ts` (phrase confirmations) and `main/files.ts` (safe open path) with tests
- [x] 2.3 `main/notifications.ts` (spec, diff, actions) with tests
- [x] 2.4 `main/tray.ts` (model) with tests; `index.ts` wiring: Tray, notifications refresh, "Sync now" menu item on `CmdOrCtrl+R`, `powerMonitor` suspend, open-task command

## 3. Renderer screens

- [x] 3.1 Queries and keys; event invalidation of the new keys; sidebar entries and routes
- [x] 3.2 Sync dialog and header Sync button; Devices & sync page with revoke confirmation
- [x] 3.3 Pairing dialog; recovery phrase screen
- [x] 3.4 "Assign to another device…" on the paused card
- [x] 3.5 Knowledge page (trees, file view, history with Undo, suggestions) and the Inbox digest card
- [x] 3.6 Files page and the Inbox "Fix a file" card
- [x] 3.7 Credentials page and Settings page (Open at login)
- [x] 3.8 Component tests of the new screens

## 4. Docs and checks

- [x] 4.1 `docs/phase-1.md` desktop lines and `AGENTS.md` status
- [x] 4.2 `task check` green
