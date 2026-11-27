## Context
The phone task page (openspec `task-review-layout`, `proposal-and-discussion`) has the parts of the desktop task page, but its look comes from Material 3 defaults: Roboto, `PrimaryScrollableTabRow` colors (each tab label is `primary`), full-width 48 dp buttons (`ControlHeight` in `Compact.kt`) and absolute times. The colors in `Theme.kt` are a hand copy of `@aw/ui/tokens`. The Tasks list is a list pane of the Navigation3 `ListDetailSceneStrategy` with the placeholder "Select a task", but `Route.Task` has no pane metadata since `task-review-layout`, so a task never shows in that pane. `QueueChipView` puts an `AssistChip` and the cause `Text` in one `Row` with no weight, so a long chip leaves the cause about one character of width.

The approved prototype (a design canvas, not in the repo) shows the target: the phone at 390 dp, the Tasks list with the task next to it at 840 dp, and the task opened as a page.

## Goals / Non-Goals

**Goals:**
- The phone Tasks list and task page use the desktop type, colors, radii, tab style, Activity rows, proposal card and message box.
- One button style for the whole phone app: 36 dp visible, 48 dp touch target.
- From 600 dp, a task opens next to the Tasks list, with "Open as page".
- Fix the queue text and the empty "Select a task" pane.
- The phone colors cannot drift from `@aw/ui/tokens`.

**Non-Goals:**
- Any desktop change.
- The Files tab and a live terminal on Android.
- Home, Inbox, Devices and New task layouts. They get the new button height and fonts only.
- Roborazzi in CI.

## Decisions

1. **Restyle the Compose screens. Do not share UI code with the desktop.** The phone reads its own Room index and has no awd and no preload bridge. Rejected: a WebView with the desktop renderer (a Kotlin bridge for each call, worse keyboard and back gesture), React Native (replaces the app and the native engine modules), Compose Multiplatform on the desktop (replaces 23k lines of React).

2. **Generate `AwTokens.kt` from `@aw/ui/tokens`.** `scripts/tokens.ts` writes `android/app/src/main/kotlin/com/agentworkspace/android/ui/AwTokens.kt` with the dark and light colors and the radii. `scripts/tokens.test.ts` compares the file with the script output, as `icons.test.ts` does for the icons. `task check` runs it, so CI needs no new step. Rejected: Style Dictionary (`tokens.ts` would become generated output too), a hand copy (it drifted: `hover`, `selected`, `wait`, `textDisabled` and `term` are missing).

3. **Bundle Inter as a variable font.** `res/font/inter.ttf` is `InterVariable.ttf` of the `rsms/inter` release 4.1, sha256 in `THIRD_PARTY_NOTICES`. Each weight is a `Font` with `FontVariation.weight` (400, 510, 590). The text styles set `fontFeatureSettings = "cv11, ss01"`. JetBrains Mono stays the monospace font: a Compose `FontFamily` has no per-glyph fallback, and Geist Mono has no box drawing characters. Rejected: Downloadable Google Fonts (network and Play services; `design.md` 3.1 says no network font).

4. **One control height of 36 dp with a 48 dp touch target.** `ControlHeight` becomes 36 dp in `Compact.kt`. `Button`, `OutlinedButton`, `TextButton`, `ControlField` and the select field use it. The touch area stays 48 dp with `Modifier.minimumInteractiveComponentSize()`. Chips stay 32 dp. A question option with two lines keeps the height of its content. No screen may import a Material 3 button directly; a detekt `ForbiddenImport` rule checks it. Rejected: 40 dp, the Material 3 default (still taller than the desktop and the chips).

5. **The task next to the Tasks list from 600 dp.** `Route.Task` gets `ListDetailSceneStrategy.detailPane()`, so it shows next to the Tasks list pane. The list pane is 320 dp. A new route `Route.TaskPage(id)` has no pane metadata and shows the task page at the full width. "Open as page" pushes `Route.TaskPage`; Back pops it. "Open task" of an Inbox item pushes `Route.TaskPage`, so the Inbox does not pair with a task. In the pane, the task page hides "Show list". The Properties panel keeps its rule of 1,000 dp of the page width. The selected row of the list has the `selected` fill and a 2 dp accent mark.

6. **Tasks list rows.** One row design at each width: the status icon of the stage group, the key (mono, `text3`), the title (`body-strong`, one line), then one wrapping line with the chips, the queue text and "assignee · age". A `FlowRow` holds that line, so a long text wraps as a whole word and never gets a width of one letter. Empty stage groups do not show. "Archived" stays the last group, closed at the start.

7. **Times in Activity.** Activity rows show the relative time of the desktop rule `ago` ("12 s ago", "5 min ago", "3 h ago", "2 days ago"). `SyncRules.ago` changes "2 d ago" to "2 days ago". A shared fixture `contracts/fixtures/time/ago.json` tests the desktop `ago` and the phone rule.

8. **Message box.** The label is above the field, the field is 2 lines high, and the hint and Send are on one line below the field, with Send at the right. This is the desktop layout.

9. **Roborazzi for screenshot tests.** Roborazzi with Robolectric renders the Compose screens on the JVM. `task android:screenshots` records or compares the task page and the Tasks list at 412, 840 and 1240 dp, dark scheme. The golden PNG files are in `android/app/src/test/screenshots/`. CI does not run them yet: the CI Android job builds no `:app` tests. Rejected: Paparazzi (cannot run with Robolectric), Compose Preview Screenshot Testing (alpha, its plugin moves into AGP test suites).

## Risks / Trade-offs
- [A 36 dp button is harder to tap] → The touch target stays 48 dp. A Compose UI test checks the touch bounds of `Button` and `ControlField`.
- [Robolectric draws text a little differently from a device] → The golden files are only for regressions on one host. The PR evidence uses emulator screenshots.
- [The split adds a second route for the task page] → One `TaskScreen` composable serves both routes. A test of the back stack checks fold, unfold, "Open as page" and Back.
- [Inter adds about 860 KB to the APK] → Accepted: the APK is 86 MB with the engine.
- [The generated `AwTokens.kt` must stay current] → The scripts test fails when it differs; `pnpm --filter @aw/scripts tokens` writes it again.

## Migration Plan
No data or API change. A phone gets the new look with the next app update. Rollback: revert the PR.

## Open Questions
None.
