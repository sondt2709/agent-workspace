## 1. Activity rule

- [x] 1.1 Add `desktop/src/renderer/src/activity-model.ts` with the table of each event type and `inActivity(row)`.
- [x] 1.2 Add `activity-model.test.ts`: each contract event type has an entry; the `message.human` source rule. Break it once.

## 2. Task detail

- [x] 2.1 Add the Activity view: `Description` in `TaskDetail.tsx` (Markdown, "Show raw"), and the mode `activity` of `Thread` in `Thread.tsx` (the rows of the rule, "Show older", the clamp of long agent text).
- [x] 2.2 Change `TaskDetail.tsx`: header with stage progress, tabs Activity, Session, Terminal, Files (and Properties when narrow), the layout by own width, the read-only properties, the session summary in Session, the message box at the bottom.
- [x] 2.3 Terminal tab: only the terminal cards, and one line "<n> items need you" with "Show in Activity".
- [x] 2.4 Files tab: export `TaskTree` and `FileText` from `Files.tsx` and use them.
- [x] 2.5 `TaskViews.tsx`: Back on the task route, Close in the split. `GateCard.tsx`: maximum height of the Markdown text.

## 3. Tests

- [x] 3.1 `TaskDetail.test.tsx`: Session shows a row for each contract event type and the unknown type; Activity shows the first message once and hides claim, session and repeated inputs; Show raw; Terminal one line; narrow layout gives Properties; Files tab. Break each once.
- [x] 3.2 Update `TerminalView.test.tsx`, `Queue.test.tsx`, `OfflinePause.test.tsx` and the other tests that use the old tabs.

## 4. Docs and checks

- [x] 4.1 Update `docs/design.md` 8.6 and `docs/phase-1.md` 10.13.
- [x] 4.2 `cd desktop && task check`; root `task check`; `task leakcheck` (on the final commit; results in the result handoff).
- [x] 4.3 After screenshots (dark, light, 400 px) and the e2e journey on the seeded test awd (on the final commit; evidence in `evidence/task-view-focus/`).
