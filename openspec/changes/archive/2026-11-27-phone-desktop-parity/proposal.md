## Why
The phone task page has the parts of the desktop, but it does not look like the desktop: Roboto text, yellow labels on each tab, dates instead of "2 min ago", 48 dp buttons next to 32 dp chips, and full-width buttons. The Tasks list has two bugs on a Fold or a tablet. The queue cause "starts soon" shows one letter per line, and the list shares the window with a "Select a task" pane that a task never fills.

## What Changes
- The phone uses the type of the desktop: Inter for text (bundled, with the features `cv11` and `ss01`), the desktop roles (`title-lg`, `title`, `title-sm`, `body-strong`, `meta`, `label`), and 14 sp body text. JetBrains Mono stays the phone monospace font.
- `pnpm --filter @aw/scripts tokens` writes `AwTokens.kt` from `@aw/ui/tokens`. A test of `@aw/scripts` fails when the file differs. `Theme.kt` reads the colors and radii from it.
- One button style: `Button`, `OutlinedButton` and `TextButton` of `Compact.kt` are 36 dp high, as on the desktop, with a 48 dp touch target. One-line text fields and select fields are 36 dp high. Chips stay 32 dp.
- Task page: the selected tab is `text` with a yellow line, and the other tabs are `text3`. Activity shows relative times ("2 min ago"), task lines without a dot, and the state chip on the author line. The proposal card and the main buttons are not full width. Send is below the message field, at the right.
- Tasks list: rows as the desktop list (status icon, key, title, chips, assignee and age), grey group headers, no empty groups, and "New task" in the title row "All tasks".
- Fix: the queue chip and its cause ("Queued · 1st for claude@macbook-pro · starts soon") wrap as text. No letter shows on its own line.
- From 600 dp, a tap on a task row opens the task page next to the Tasks list. "Open as page" shows the task page at the full width. Back returns to the list and the task. The "Select a task" text shows only when no task is open. On a compact window, a tap opens the task page as before.
- Decision `2026-11-25-task-page`: item 1 (no split on Android) and item 8 (the control height differs) change. A new decision record gives the new rules.
- Roborazzi screenshot tests of the task page and the Tasks list at 412, 840 and 1240 dp, run with `task android:screenshots`. They do not run in CI yet.
- No change to awd, the API, the events or the data.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `android-app`: "Phone screens" (the Tasks list rows and header, the task page look), "Adaptive layout" (the task next to the list from 600 dp, "Open as page"), "Queue on the phone" (the queue text wraps), "Phone task activity" (relative times, the author line, Send below the field), "New task button of the task list" (the button in the title row).
- `app-style`: "One palette on desktop and phone" (the phone colors come from the generated `AwTokens.kt`), "Compact phone components" (36 dp controls with 48 dp touch targets), and a new requirement "Phone type" (Inter and the desktop type roles).

## Impact
- Android: `android/app/.../ui/Theme.kt`, `Compact.kt`, `AwApp.kt`, `TaskScreens.kt`, `TaskPageParts.kt`, `Components.kt`, `QueueChip.kt`, `ListScreens.kt`, `ActivityParts.kt`, `ProposalView.kt`, `MarkdownText.kt`, `GateParts.kt`, the new `AwTokens.kt` and `res/font/inter*.ttf`; `android/control` (the Activity time text, the Tasks list groups, the split rule).
- Build: Roborazzi and Robolectric in `android/app` test dependencies (`libs.versions.toml`), a new `task android:screenshots`.
- Scripts: `scripts/tokens.ts` and `scripts/tokens.test.ts`; `@aw/ui` as a dependency of `@aw/scripts`.
- Notices: Inter (SIL Open Font License 1.1) in `THIRD_PARTY_NOTICES`.
- Docs: `docs/design.md` 3, 8.4, 8.6 and 8.20, `docs/tech-stack.md` (Roborazzi), a new decision `docs/decisions/2026-11-27-phone-desktop-parity.md`.
- The desktop does not change.
