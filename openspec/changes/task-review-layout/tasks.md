## 1. Evidence before the change

- [x] 1.1 Desktop on the base commit, with the seeded awd (`/tmp/awui`, fake agent, synthetic data): screenshots of the board split, the clamped plan, the decision chips and the raw subagent report
- [x] 1.2 Android on the base commit, on the `nuc-android` emulator (lock the server first): screenshots of the phone with the keyboard open, a 840 dp foldable window, a 1440 dp window, and the control heights of New task

## 2. Shared rules and fixtures

- [x] 2.1 Capture a real subagent report from a Claude Code session transcript. Remove ids, paths and host names. Write `contracts/fixtures/activity/agent-message.json` with the source and the capture date, and add synthetic edge cases (no "The report follows:" line, not closed, a person text that starts with "<agent")
- [x] 2.2 Add `agentMessage(text)` and `decisionsAnswer(decisions, picks)` to `shared/client/src/gates.ts`, with Vitest tests against the fixture and the cases of the spec
- [x] 2.3 Add the Kotlin copies to `android/control` (`GateTexts.decisionsAnswer`, `ActivityRule.agentMessage`), with JVM tests against the same fixture and the same decision cases

## 3. Desktop

- [x] 3.1 Board and List open the task route; remove the split, the resize handle and Close; Back keeps the search parameters; Esc on the task page goes back (`TaskViews.tsx`)
- [x] 3.2 Task page header: Back, need-you navigation in the Inbox order, "Show list" from 700 px with the 300 px task list, Properties panel of 280 px from 1,000 px, content 840 px and centred (`TaskDetail.tsx`, `model.ts`)
- [x] 3.3 `GateBody`: "Show more" shows the full text in the page, with no scroll box
- [x] 3.4 Decisions as radio groups with the picks in `AnswerCard`; "Send my choices" with the status line; labels only for a gate with no "Request changes" (`GateParts.tsx`, `GateCard.tsx`)
- [x] 3.5 Activity: person messages as Markdown with the 6-line clamp; the subagent report row (`Thread.tsx`)
- [x] 3.6 Component tests for 3.1 to 3.5 (routes, need-you navigation, width rule, decision picks and the sent answer, subagent row)

## 4. Android

- [x] 4.1 Task route in one pane at each width; remove the Session extra pane and the list-detail metadata of the task; keep one back stack (`AwApp.kt`, `Routes`)
- [x] 4.2 Task page header as on the desktop: Back, key, project, state chip, need-you navigation, "Show list" from 700 dp with the task list, actions, title, stage bar (`TaskScreens.kt`, `control` need-you order)
- [x] 4.3 Properties panel from 1,000 dp of task page width and the Properties tab below it; content 840 dp and centred (`TaskTab`, `Components.kt` `MaxContentWidth`)
- [x] 4.4 Keyboard: `consumeWindowInsets` and `imePadding()` on the root content; hide the bottom bar while the IME shows on a compact window
- [x] 4.5 One control height of 48 dp: buttons, option buttons, decision rows, the message field with its label above and Send, the select fields of New task (`Compact.kt`, `Components.kt`, `FormScreens.kt`, `GateParts.kt`)
- [x] 4.6 Gate card: "Show more" in the list, decision radio groups and "Send my choices" (`TaskDetailParts.kt`, `Components.kt`)
- [x] 4.7 Activity rows as lines with a coloured edge; person messages and subagent reports as Markdown (`TaskScreens.kt`)
- [x] 4.8 JVM tests for the logic of 4.1 to 4.7 in `android/control` (tabs and width rule, need-you navigation, decision picks)

## 5. Docs

- [x] 5.1 Update `docs/design.md` (task page, adaptive layout, control height) and the screens of `docs/phase-1.md` that name the board split or the Session pane

## 6. Checks and evidence

- [x] 6.1 Break each new test once, see it fail, and restore the code
- [ ] 6.2 Run `task check` and `task leakcheck`
- [x] 6.3 Desktop after screenshots on the seeded awd (dark, light, 400 px): task page, Show list, Show more, decisions picked, the subagent report; answer with "Send my choices" and read the `[AW answer]` text in `aw thread`
- [x] 6.4 Android after screenshots on the `nuc-android` emulator: phone with the keyboard open, 840 dp foldable, 1440 dp window, New task heights
