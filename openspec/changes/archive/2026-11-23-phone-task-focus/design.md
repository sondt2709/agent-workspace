## Context
- The desktop Activity rule is `ACTIVITY` and `inActivity(row)` in `desktop/src/renderer/src/activity-model.ts` (task-view-focus). Its test compares the table keys with the event types of `contracts/samples/schema-samples.json`.
- The phone task detail (`android/app/.../TaskScreens.kt`) is one `LazyColumn`: header, gate cards, Fields, Approach, Artifacts, Terminal, message box, then the raw thread (`ThreadItems` of `android/control/.../Thread.kt`). On a large window the thread is the third pane (`Route.Thread`).
- `session.ended` has the reasons `done`, `moved`, `stopped`, `crashed`, `replaced` (`shared/schema/src/events.ts`). awd writes `stopped` when the person stops the session, when the agent exits (`/exit`, logout) and when the device is revoked. No awd code writes `crashed` yet.
- After a stopped session AW starts no new session until a person starts one (`docs/workflow.md` 5 item 4).
- Repo rule: production code reads no file of `contracts/`; tests read it (TypeScript with `?raw`, Kotlin through the system property `aw.schema.dir`).

## Goals / Non-Goals
**Goals:**
- One Activity rule for both apps, with a test in each language against one fixture.
- Decision 37: Activity shows a stopped or crashed session end with its cause.
- The phone task detail shows the task: Activity first, the session detail in Session.

**Non-Goals:**
- Markdown on the phone (no renderer; a new library is out of scope).
- A phone "Stop session" action (the phone has no stop action yet).
- Editable properties.
- A Files tab on the phone (the phone has the artifacts, not the task folder).

## Decisions
1. **Fixture, not generated code.** `contracts/fixtures/activity/cases.json` has `places` (type → `activity` | `session`), `cases` (`type`, `dev`, `by`, `data`, `in_activity`, `line`) and `clamp` cases. Each language keeps its table in code and tests it against the fixture. Alternative: generate both tables from the zod schema (`pnpm schema:generate`). Rejected: the Activity rule is a UI decision, not a file format, and a generator adds a build step for 40 lines.
2. **`session.ended` rule.** The table entry is `activity`, and `inActivity` keeps it only for the reason `stopped` or `crashed`, as `message.human` keeps only typed inputs. `activityLine(row)` gives the line of the Activity row:
   - `stopped`: "Session stopped on <dev>: a person stopped it or ended the agent. AW starts no new session until a person starts one."
   - `crashed`: "Session crashed on <dev>: the agent process ended and AW did not restart it. AW starts no new session until a person starts one."
   The device is the event `dev` (the session device). The Session tab keeps its own raw line.
3. **Phone model.** `ThreadItem` gets the event `type`, and `ThreadWindow` gets `activity: List<ThreadItem>` next to `items` (the raw Session rows), from the same rows (`ThreadItems.activity`). `ThreadItems.of` now gives a row for each event, also `device.heartbeat` (principle 8). `ActivityRule` (Kotlin object) has `PLACES`, `inActivity(type, data)`, `line(type, dev, data)` and `clamp(text)`. Activity rows: `task.created` is "Created by <by>"; a typed `message.human` has the note "typed in the terminal"; an agent message has `clamped`; the other rows reuse the text of `ThreadItems`.
4. **Phone tabs.** `TaskTab` (in `:control`, with JVM tests) lists the tabs. A `PrimaryScrollableTabRow` with Activity, Session, Terminal, Properties; the selected tab is saved per task (`rememberSaveable(task.id)`), so another task opens on Activity. The message box sits below the list on Activity and Session. Each other tab shows the line "<n> items need you" with "Show in Activity" when `ScreenStates.gateCards`, Assign or the pause chip needs the person.
5. **Session summary on the phone.** `TaskDetail.sessionSummary(task)` (an own object: detekt allows 15 functions in `ScreenStates`) gives state, device, host, claim epoch, session id, branch and task id; `ScreenStates.fields` loses the session rows (Owner device, Moving to, Session, Branch) and keeps the properties. `TaskDetail.needsYouLine(task)` counts the open gates and Assign.
6. **Third pane.** On a large window the extra pane shows the Session view (summary and raw rows), and the tab row drops Session, as the desktop drops Properties when it has the right panel.

## Risks / Trade-offs
- [The 2 tables drift] → Both tests read the same fixture; a new contract type fails both tests until both tables have it.
- [The phone loads 500 events for Activity and filters] → Same as the desktop: "No activity in the newest <n> events. "Show older" loads more." when the page has rows but no Activity row.
- [`stopped` has more than one cause] → The line names both causes ("a person stopped it or ended the agent"); a revoked device also writes `stopped`, and that case shows the revoke in Devices.
- [`crashed` has no writer] → The unit tests and the fixture cover it; the journey covers `stopped`.

## Migration Plan
None. UI only; no stored data changes.

## Open Questions
None.
