# Decision: the phone looks like the desktop, and a task opens next to the Tasks list

| Item | Value |
|---|---|
| Date | 2026-11-27 |
| Status | Accepted by the product owner |
| Changes | Decision `2026-11-25-task-page` items 1 and 8; `design.md` 3, 8.4, 8.6 and 8.20; `tech-stack.md` (Roborazzi, Robolectric, Inter) |

## Request
The phone task page has the parts of the desktop, but it looks different: other fonts, yellow labels on each tab, dates instead of "2 min ago", and 48 dp buttons next to 32 dp chips. On a Fold, the Tasks list shares the window with a "Select a task" pane that a task never fills, and a long queue chip shows its cause one letter per line. The product owner approved a prototype and asked for one default button style in the phone app.

## Decision
1. The phone uses the desktop type (Inter, the type roles of `design.md` 3) and the desktop tokens. `AwTokens.kt` is generated from `@aw/ui/tokens`; JetBrains Mono stays the phone monospace font.
2. One control height on both apps: buttons, one-line fields and select fields are 36 dp (px) high. On the phone, each control keeps a 48 dp touch target. Chips stay 32 dp. Item 8 of `2026-11-25-task-page` no longer lists the control height as a platform difference.
3. From 600 dp, a tap on a task row opens the task page next to the Tasks list (a 320 dp list pane). "Open as page" opens the same task page at the full width, and Back returns to the list with the task selected. This replaces item 1 of `2026-11-25-task-page` for the Android Tasks list. A compact window, an Inbox item and a push notification still open the full-width task page.
4. The Tasks list has the desktop rows and shows no empty stage group.
5. Roborazzi screenshot tests of the phone run with `task android:screenshots`. They are not in CI yet.

## Reasons
- One look on both apps means the person reads one screen, not two.
- A 36 dp button next to a 32 dp chip lines up; the 48 dp touch target keeps the tap size of the Material guidelines.
- On a Fold, the list next to the task gives the fast switch between tasks, and "Open as page" gives the width for a long plan.
- A generated token file cannot drift from the desktop.

## Not in this decision
- A desktop change.
- Home, Inbox, Devices and New task layouts (they get the new fonts and the control height only).
- The Files tab and a live terminal on Android.
