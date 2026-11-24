## Why
The desktop task detail now shows the task as an issue: Activity, then a Session tab with each raw event (task-view-focus). The phone task detail still shows one long list with each claim, session line and input (principle 1: the phone and the desktop show the same task). Also a stopped or crashed session leaves no line in Activity, so a stop does not show its cause (principle 2, decision 37).

## What Changes
- A shared contract fixture `contracts/fixtures/activity/cases.json` holds the Activity decision for each contract event type and the cases of the Activity rule. The TypeScript table and the Kotlin table are tested against it, so the 2 tables cannot drift.
- Activity shows a `session.ended` with the reason `stopped` or `crashed`, with its cause and the next step, on the desktop and on the phone.
- The phone task detail gets the tabs Activity (default), Session, Terminal and Properties:
  - Activity: the open gate cards, the late answers and Assign first; the first message once as the description; then the rows of the Activity rule; an agent reply longer than 6 lines shows 6 lines and "Show more".
  - Session: the session summary, then each raw event of the thread window with "Show older" (principle 8).
  - Terminal: the newest terminal snapshot.
  - Properties: the fields, the approach versions and the artifacts.
  - Each tab except Activity shows "<n> items need you" with "Show in Activity" when a gate, Assign or a pause needs the person.
- On a large window, the third pane of a task is the Session view, and the tab row has no Session tab.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `desktop-app`: "Task activity" adds the session end with the reason `stopped` or `crashed`, and the shared fixture.
- `android-app`: "Phone screens" (task detail), "Adaptive layout" (the third pane is the Session view), "Phone thread window" (the Session view), and a new requirement "Phone task activity".

## Impact
- `contracts/fixtures/activity/` (new), `contracts/fixtures/README.md`.
- `desktop/src/renderer/src/activity-model.ts`, `components/Thread.tsx` and their tests.
- `android/control`: `Activity.kt` (new), `Thread.kt`, `WorkspaceModel.kt`, `Screens.kt` and tests.
- `android/app`: `TaskScreens.kt`, `AwApp.kt`.
- `docs/design.md` 8.6, `docs/phase-1.md` (phone task detail).
- No schema, API, file format, sync or merge change. No new library.
