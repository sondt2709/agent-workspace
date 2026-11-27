## 1. Failing tests of the two bugs (on main, before any fix)

- [x] 1.1 Add Robolectric and Roborazzi to the `android/app` test dependencies (`libs.versions.toml`, newest release at least 7 days old), and the task `task android:screenshots`.
- [x] 1.2 Add a Compose test: `QueueChipView("Queued · 1st for claude@mac-mini-lab", "starts soon")` in a 280 dp box (a Fold cover screen) shows "starts soon" at least 40 dp wide. Run it on main, see it fail, and keep the output.
- [x] 1.3 Move the pane of each route from `AwApp.kt` to the rule `Route.pane()` of `:control` with no behavior change, and add `PanesTest`: a task of the Tasks list is a detail pane. Run it, see it fail, and keep the output.

## 2. Tokens and type

- [x] 2.1 Write `scripts/tokens.ts` (`pnpm --filter @aw/scripts tokens`): it writes `AwTokens.kt` from `@aw/ui/tokens` (dark and light colors, radii).
- [x] 2.2 Write `scripts/tokens.test.ts`: it fails when `AwTokens.kt` differs from the script output. Break the file once and see the test fail.
- [x] 2.3 Change `Theme.kt` to read the colors and radii from `AwTokens.kt`. Remove the hand copy.
- [x] 2.4 Add `res/font/inter.ttf` (Inter 4.1 `InterVariable.ttf`, sha256 checked) and its notice in `THIRD_PARTY_NOTICES`.
- [x] 2.5 Map the type roles of `design.md` 3 to the phone `Typography` and `AwType` (Inter, `cv11`, `ss01`, the weights 400, 510, 590).

## 3. One control height

- [x] 3.1 Set `ControlHeight` to 36 dp in `Compact.kt` for `Button`, `OutlinedButton`, `TextButton`, `ControlField` and the select field, with a 48 dp touch target.
- [x] 3.2 Keep the question option buttons at least 48 dp high with two lines.
- [x] 3.3 Add the detekt rule `ForbiddenImport` for the Material 3 buttons in `android/app`. See it fail once with a direct import.
- [x] 3.4 Add a Compose test: a `Button` is 36 dp high and its touch bounds are 48 dp.

## 4. Tasks list

- [x] 4.1 Change the row (`Components.kt` `TaskRow`): status icon, key in mono, title on one line, and a `FlowRow` with the chips, the queue text and "assignee · age".
- [x] 4.2 Fix `QueueChipView`: the chip and the cause wrap as whole words (the test of 1.2 passes).
- [x] 4.3 Hide the empty stage groups; keep "Archived" last and closed (`android/control` rule with a JVM test).
- [x] 4.4 Put "All tasks <n>" and "New task" on one title line, above the project tabs.

## 5. The task next to the list

- [x] 5.1 Give `Route.Task` the `ListDetailSceneStrategy.detailPane()` metadata, with a 320 dp list pane.
- [x] 5.2 Add `Route.TaskPage(id)` for the full-width task page; "Open as page" pushes it; Back pops it.
- [x] 5.3 Open `Route.TaskPage` from "Open task" of an Inbox item and from a push notification.
- [x] 5.4 Hide "Show list" on the task page in the pane; mark the selected row (`selected` fill, 2 dp accent mark).
- [x] 5.5 Add JVM tests of `Navigator`: "Open as page" and Back keep AW-1 selected; Home, Inbox and a push open the task page. The test of 1.3 passes. The emulator check (9.2) covers the unfold.

## 6. Task page look

- [x] 6.1 Tabs: the selected tab in `text` with the accent line, the other tabs in `text3`.
- [x] 6.2 Add `contracts/fixtures/time/ago.json`; test the desktop `ago` and the phone rule with it; change "2 d ago" to "2 days ago".
- [x] 6.3 Activity rows: relative times, no dot on task lines, the state chip on the author line.
- [x] 6.4 Proposal card: the desktop radius 12 dp, "Approve proposal" with the width of its label, the hint next to it.
- [x] 6.5 Message box: the label, the field, then the hint and Send at the right on one line.
- [x] 6.6 Inline code in `MarkdownText.kt`: monospace 12.5 sp, a 6 % fill and a 4 dp radius, as on the desktop.
- [x] 6.7 The reason of a task with no assignee is "Assign task", as on the desktop (`ScreenStates.reasonOf`).
- [x] 6.8 The session option chips ("Skips permissions", "Agent teams") are state chips of 24 dp, not Material chips.
- [x] 6.9 A row that scrolls back keeps its height: `KeptTexts` keeps the proposal texts and the gate text heights, so the list does not jump on a scroll up (`ScrollBackTest`).
- [x] 6.10 "Running" shows only when the agent works: not on a task that waits for the person or is paused, as the desktop "working" rule.
- [x] 6.11 Next to the Tasks list: the list pane has its own bar (workspace, Sync now) and no app bar spans both panes. Activity gets the height: the header scrolls away, the tab row (with "Open as page" and the actions menu) stays at the top, the message box is one row and one hint line, the description shows about 3 lines and "Show more"; the tab rows show each tab at the width of its label (`AwTabRow`).

## 7. Screenshot tests

- [x] 7.1 Record the golden files of the Tasks list (412 and 840 dp) and the task page (412 dp, 520 dp next to the list, 1240 dp) with `task android:screenshots:record`.
- [x] 7.2 Break the tab colors once, see the compare fail, and restore.

## 8. Docs

- [x] 8.1 Write `docs/decisions/2026-11-27-phone-desktop-parity.md` (items 1 and 8 of `2026-11-25-task-page` change).
- [x] 8.2 Update `docs/design.md` 3, 8.4, 8.6 item 10 and 8.20, and `docs/tech-stack.md` (Roborazzi, Robolectric, Inter).

## 9. Checks and evidence

- [x] 9.1 Run `task check` and `task leakcheck`.
- [x] 9.2 Build the APK on the nuc. Take emulator screenshots at 392 and 840 dp, before (main) and after (this branch).
- [x] 9.3 Run the test plan again on the last commit and write the SHA in each result.
