## 1. Shared Activity rule

- [x] 1.1 Add `contracts/fixtures/activity/cases.json` (places, cases, clamp) and its section in `contracts/fixtures/README.md`
- [x] 1.2 Desktop: `session.ended` rule and `activityLine(row)` in `activity-model.ts`; test the table, the rule, the lines and the clamp against the fixture
- [x] 1.3 Desktop: the Activity row of `session.ended` uses `activityLine` in `Thread.tsx`; test it in `Thread.test.tsx`
- [x] 1.4 Kotlin: `ActivityRule` in `android/control/.../Activity.kt`; JVM test against the same fixture

## 2. Phone model

- [x] 2.1 `ThreadWindow.activity` (Activity rows) from the same rows as the Session rows; a test that each contract type has a Session row (principle 8)
- [x] 2.2 `TaskDetail.sessionSummary(task)` and the session rows out of `ScreenStates.fields`; `TaskDetail.needsYouLine(task)`; tests

## 3. Phone screens

- [x] 3.1 `TaskScreen` with the tabs Activity, Session, Terminal, Properties; the message box below Activity and Session; the "items need you" line with "Show in Activity"
- [x] 3.2 The third pane on a large window is the Session view; no Session tab while it shows

## 4. Docs and checks

- [x] 4.1 `docs/design.md` 8.6 and `docs/phase-1.md` phone task detail
- [x] 4.2 Break each new test once; `task android:check`; `cd desktop && task check`
- [x] 4.3 Phone journey on an Android emulator with a real awd (gate, messages, stopped session; each tab; large window) and desktop screenshot of the stopped-session line
- [x] 4.4 Root `task check` on the last commit; result handoff
