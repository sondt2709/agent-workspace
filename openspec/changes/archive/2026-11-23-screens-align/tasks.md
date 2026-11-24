## 1. Shared parts

- [x] 1.1 `common.tsx`: `LoadingRows` (skeleton rows after 300 ms), `PropertyRow`, `PageHeader`, `Section`; `MarkdownText` with no type sizes (dsc-10)
- [x] 1.2 Use `LoadingRows` in Devices, Knowledge, Files, TaskDetail, TaskViews and Inbox (F-34)

## 2. Appearance

- [x] 2.1 `prefs.ts`: `appearance()` and `setAppearance()` (default `system`, unknown value is `system`), with tests
- [x] 2.2 `channels.ts`, `contract.ts`, `calls.ts`: `appearance` in `AppSettings` and the `setAppearance` call, with tests
- [x] 2.3 `index.ts`: set `nativeTheme.themeSource` before the first window and after each change

## 3. Screens

- [x] 3.1 Devices & sync: device cards with property rows (`deviceRows()` in `devices-model.ts`), the sync block; tests (F-27)
- [x] 3.2 Knowledge: one group tree with the shared tag, the first file opens on a wide window, the last change row; tests (F-29)
- [x] 3.3 Files: task rows with key, title and stage; the one-line folder root; keep `TaskTree` and `FileText`; tests (F-28)
- [x] 3.4 Credentials: rows, the empty state with "Add a credential"; tests
- [x] 3.5 Settings: sections Appearance, Startup, Notifications, Sync across networks, Setup check; tests (F-31, dsc-11)
- [x] 3.6 Project settings: sections, test server chips, the session host help line; tests (F-30, ux-1)

## 4. Docs and checks

- [x] 4.1 `docs/design.md` (status, 8.16 page layouts) and `docs/phase-1.md` 10.13 (Appearance)
- [x] 4.2 Break each new test once; `cd desktop && task check`
- [x] 4.3 Real app: after captures (1280 dark, 1280 light, 400 dark) and the Appearance run with restart
- [x] 4.4 Root `task check` on the final commit
