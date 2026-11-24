## Context
The design system (`docs/design.md`, openspec `design-system`) gave the app its tokens, type, icons and window. Six screens still have the old content and layout (review `ui-ux.md` 5.7: F-27 to F-31, F-34). The prototype gives the content and the order of each screen; `docs/design.md` gives the look. Two other journeys run in parallel: task-view-focus-check (task detail) and keys-backup (the recovery phrase part of Settings).

## Goals / Non-Goals
**Goals:**
- Show the prototype content of Devices & sync, Knowledge, Files, Credentials, Settings and Project settings with the data that awd gives today.
- Add "Appearance: System, Light, Dark" as a desktop preference.
- Explain the session host in Project settings (fix list ux-1).
- Skeleton rows instead of "Loading …" lines (F-34).

**Non-Goals:**
- No new awd route. The health of another device (uptime, disk, Claude sign-in, MCP) needs a read route of `health.yaml`; a later task adds it.
- No "Work in" choice for sessions (task 16f), no folder picker (task 16d), no sidebar or top bar change (task 16e).
- No phone change.

## Decisions
1. **Device cards from current routes.** Each card reads the devices, presence, sync, queues, session-hosts and bindings routes. The rows are pure functions in `devices-model.ts` (`deviceRows()`), so unit tests cover them without React. Alternative: a new health route — rejected for this task (public API change, medium risk).
2. **One property row component.** `PropertyRow` (label in `text3` on the left, value on the right; stacked below 600 px) in `common.tsx` serves Devices, the knowledge file view and Settings. Alternative: an MUI `Table` per card — rejected: the rows have mixed content (chips, switches).
3. **Knowledge in one tree.** `groupFiles()` already groups by Rules, Knowledge and Learned. The project page passes the project files and the shared files together; a row of a shared file shows the tag "shared". The first file of the tree opens in the detail pane when the window is wide and no file or view is selected; the URL does not change, so Back still works.
4. **Files rows.** The task list shows `AW-7 · Export invoices as CSV` and the stage as the meta line. The tree root shows the task folder as one mono line with an ellipsis and a tooltip. `TaskTree` and `FileText` keep their props (task-view-focus uses them).
5. **Settings as one page with sections.** 5 short sections fit at 1280 × 800. A category pane would also move the phrase reminder, which keys-backup changes now. The phone keeps its category pane (`phase-1.md` 10.7.8).
6. **Appearance through `nativeTheme.themeSource`.** Main reads `appearance` from `aw-desktop.json` before it makes the window and sets `nativeTheme.themeSource`. Electron then changes `prefers-color-scheme` in the renderer (the theme uses `colorSchemeSelector: "media"`), `shouldUseDarkColors` (the window background follows through `followScheme()`), and the native menus. Alternative: a renderer-only color scheme with `useColorScheme()` — rejected: the window background and the menus would not follow, and the renderer would need the preference before the first paint.
7. **Project settings sections.** The synced settings stay one form with one Save (one `editProject` call), in 3 titled sections. "This device" keeps its own saves (bindings). The test servers field becomes an `Autocomplete` with chips and free entry (no route lists the names). The help line under the session host: "Each session works in its own git worktree on the branch aw/<key>. With tmux, the worktree is in ~/.aw/worktrees/<task id>. With Orca, Orca makes the worktree in its own folder."
8. **Loading rows.** `LoadingRows` shows MUI `Skeleton` rows of 36 px after 300 ms and nothing before (design.md 8.13.2).
9. **No type sizes in screen code.** Code blocks use the `body2` variant (12 px) with the mono family; `MarkdownText` uses `subtitle1` for h1 and h2 and `fontWeightBold` for h3 to h6.

## Risks / Trade-offs
- [Settings merge with keys-backup] → The phrase reminder keeps its place and code; only the sections around it change.
- [`themeSource` set before the first window] → `prefs.appearance()` runs in `whenReady` before `createWindow()`; a broken file gives "system".
- [Devices card shows less than the prototype] → The card says nothing about the missing health data; the open item names the route.
- [First-file auto-open hides "Waits for approval"] → Pending suggestions still open first when there are any (current rule).

## Migration Plan
None. `aw-desktop.json` gets an optional key with the default "system". Rollback: revert the commit; the key is ignored by older builds (`looseObject`).

## Open Questions
None for this task. Later: a device health route; Appearance on the phone.
