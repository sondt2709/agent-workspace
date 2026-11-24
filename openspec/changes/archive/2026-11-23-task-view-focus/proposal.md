## Why

The task detail shows each event of the Claude Code session: claims, session starts, each typed input, and the first message 3 times. People open a task to see the task, not the session (owner request, decision 36: "task is task"). Review `ui-ux.md` 5.2 (F-4, F-17, F-18, F-19, F-20, F-36) lists the fixes.

## What Changes

- The task detail gets the tabs Activity (default), Session, Terminal and Files. A narrow detail (below 1,000 px of its own width) also gets a Properties tab; a wide detail shows the properties in a 300 px right panel.
- Activity: the open gate cards, the first message once as the description (Markdown, with "Show raw"), and the key activity in a compact form. One table decides for each event type if it shows in Activity. The message box stays at the bottom of the main column.
- Session: the session summary (state, device, host, claim epoch, session id, branch, task id, Stop session) and the full raw thread with each event and message (principle 8).
- Terminal: the snapshot, with only the cards that act on the terminal ("Take over terminal", "Sign in") above it. Other open items show as one line with "Show in Activity".
- Files: the read-only folder of the task, in the task detail.
- Header: the key, the project, the state chips, a 6-segment stage progress bar, and the title. The task route shows Back; the board split shows Close.
- Properties are read-only and no longer hold the first message, the session or the task id.
- The Markdown text of a gate card has a maximum height with its own scroll.

## Capabilities

### New Capabilities

### Modified Capabilities
- `desktop-app`: the requirements "Task detail" and "Terminal tab" change (the tabs, the header, the Session tab, the Files tab, the terminal cards); a new requirement "Task activity" holds the Activity rule.

## Impact

- Code: `desktop/src/renderer/src/components/TaskDetail.tsx`, `Thread.tsx`, `TaskViews.tsx`, `Files.tsx` (exports), `GateCard.tsx`; new `activity-model.ts`; renderer tests and the fixture `fixtures/thread-aw-8.json`.
- No API, IPC, route, file format or schema change. The thread API stays the same.
- Docs: `docs/design.md` 8.6, `docs/phase-1.md` 10.13.
- The phone task detail is not changed (open item).
