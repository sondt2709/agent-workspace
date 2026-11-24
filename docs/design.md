# Agent Workspace — Desktop design system

| Item | Value |
|---|---|
| Document | The look and the components of the desktop app and the phone app |
| Version | 0.2 (2026-11-24, owner request: one style, the palette of the prototype, on the desktop and the phone) |
| Readers | People who change a desktop screen, reviewers |
| Source of truth | `principles.md`. This file wins over the look of older screenshots. The prototype wins for the content and the order of each screen. |
| Code | `shared/ui/src/index.ts` (`createAppTheme()`, `tokens`), `desktop/src/renderer/src/components/AppShell.tsx`, `android/app/.../ui/Theme.kt` and `Compact.kt` |
| Status | Built: the tokens, the theme, the fonts, the icons, the window and the look of the sidebar and the top bar (openspec `design-system`); the task view of 8.6 on the desktop (openspec `task-view-focus`) and on the phone (openspec `phone-task-focus`); the pages of 8.16, the loading rows of 8.13.2 and Appearance (openspec `screens-align`); the create flows of 8.17 and the empty states of 8.13.1 (openspec `create-flows`); the session options of 8.18 (openspec `session-options`); the New projects setting of 8.16.8, the New task layout of 8.18.1 and the phone New task bar of 8.18.7 (openspec `permissions-default`); the sidebar and switcher of 8.2, the top bar of 8.3, the project tabs, All tasks, the Inbox list and detail, the List of 8.4, the Board of 8.5, the command menu of 8.9 and the screen keys of 9 (openspec `navigation-prototype`). |

Color reference: the palette of the AW prototype (local only, not in the repository). Its surfaces, text colors and status colors are the tokens of section 2, and its yellow is the one accent. The desktop and the phone use the same values (openspec `polish-prototype-style`).

Layout sources: the public DESIGN.md analyses at https://github.com/voltagent/awesome-design-md/blob/main/design-md%2Flinear.app%2FDESIGN.md (MIT) and https://getdesign.md/linear.app/design-md. AW took ideas, not text. The app shows no name, logo or color set of another product.

## 1. Principles
1. **The content is the interface.** The task list, the gate and the agent text carry each screen. The chrome stays quiet: neutral grays, thin lines, no decoration.
2. **One accent: the prototype yellow.** The primary action of a view, the focus ring, links and the selected item mark use the yellow of the prototype, the same color as "Needs you": the next action of the person is yellow. Other colors are status colors only. No second accent (no indigo, no wallpaper color on the phone).
3. **Color means status.** Amber means "Needs you". Blue means "Running". Green means "Done" or "Allowed". Red means an error or a destructive action. Gray means "Waiting" or "Paused". Never use a status color for decoration.
4. **Depth from surfaces, not shadows.** A raised item gets a lighter surface and a hairline. Only menus, popovers and dialogs get a shadow.
5. **Dense, but readable.** The base text is 13 px. A list row is 36 px high. Each screen shows the most important data without scroll at 1280 × 800 px.
6. **Keyboard first.** Each action has a keyboard path. The focus ring is always visible. Shortcuts show next to their menu items and buttons.
7. **A native Mac window.** The traffic lights sit in the sidebar. The top area moves the window. The app follows the system light or dark setting.
8. **Evidence first** (principle 7). Show the terminal line, the test report or the artifact, not a decorative status.

## 2. Color tokens
The tokens live in `@aw/ui/tokens` (`shared/ui/src/tokens.ts`). Screens use only the MUI palette: the MUI names (`text.secondary`, `warning.main`) or the group `aw` (`aw.canvas`, CSS `--mui-palette-aw-canvas`). Never write a hex value in a component.

### 2.1 Surfaces and lines
| Token | Dark | Light | Use |
|---|---|---|---|
| `canvas` | `#08090A` | `#F7F7F8` | The window, the sidebar, the title area |
| `surface` | `#0F1011` | `#FFFFFF` | The main content area, lists, the task view, inputs |
| `raised` | `#141517` | `#F4F4F5` | Cards, the gate card, code blocks |
| `overlay` | `#1B1C1F` | `#FFFFFF` | Menus, popovers, dialogs |
| `overlayHover` | `#232428` | `#F1F1F3` | A hovered item in a menu or a dialog |
| `hover` | `rgba(255,255,255,.04)` | `rgba(0,0,0,.035)` | Row hover on any surface |
| `selected` | `rgba(255,255,255,.07)` | `rgba(0,0,0,.06)` | The selected row and the active nav item |
| `line` | `rgba(255,255,255,.08)` | `rgba(0,0,0,.08)` | Dividers, card borders |
| `lineStrong` | `rgba(255,255,255,.14)` | `rgba(0,0,0,.15)` | Input borders, the border of a hovered card |
| `scrim` | `rgba(0,0,0,.6)` | `rgba(0,0,0,.24)` | The backdrop of a dialog |

### 2.2 Text
| Token | Dark | Light | Use | Minimum contrast |
|---|---|---|---|---|
| `text` | `#F7F8F8` | `#171717` | Titles, body | 4.5:1 on `surface` and `raised` |
| `text2` | `#C9CDD3` | `#3F3F46` | Secondary body, values in a properties panel | 4.5:1 |
| `text3` | `#8A8F98` | `#5E5E66` | Labels, meta, timestamps, placeholders | 4.5:1 on `surface` |
| `textDisabled` | `#62666D` | `#A1A1AA` | Disabled controls only | none |

### 2.3 Accent and status
| Token | Dark | Light | Use |
|---|---|---|---|
| `accent` | `#F0B429` | `#8F5200` | The fill of the primary button and of the main answer of a gate |
| `onAccent` | `#1A1200` | `#FFFFFF` | Text on `accent` (4.5:1) |
| `accentText` | `#F0B429` | `#8F5200` | Links, the selected tab mark |
| `focus` | `#F0B429` | `#8F5200` | The focus ring (3:1 on `canvas` and `surface`) |
| `run` | `#4EA7FC` | `#1D6FD6` | Running work, stages Discuss to Review |
| `you` | `#F0B429` | `#8F5200` | "Needs you", the gate card, the gate action button |
| `onYou` | `#1A1200` | `#FFFFFF` | Text on a `you` fill |
| `wait` | `#9AA0A9` | `#5E5E66` | Waiting, paused, queued |
| `ok` | `#4CB782` | `#14804F` | Done, allowed, synced |
| `err` | `#EB5757` | `#C93434` | Errors, Deny, Revoke, Stop |
| `term`, `termFg` | `#0A0B0C`, `#C9CDD3` | `#16171A`, `#D5D8DD` | The terminal snapshot (dark in both schemes) |

Each status color has a tint for chips and banners: the color at 12 % to 14 % opacity, and a line at 32 % to 40 %.

## 3. Typography
1. Font: Inter (variable) for all text, Geist Mono (variable) for task keys, paths, commands and the terminal. Both are bundled in the app from maintained npm packages. The app loads no font from the network (CSP `font-src 'self'`).
2. Turn on the Inter features `cv11` (single-story a) and `ss01` (open digits), and `tnum` for counts and times.
3. Use sentence case for all labels. Do not use uppercase section labels.

| Role | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| `title-lg` | 22 / 30 | 590 | -0.015em | The task title in the task view |
| `title` | 18 / 26 | 590 | -0.01em | The page title |
| `title-sm` | 14 / 20 | 590 | 0 | A card title, a section title (a dialog title is 15 px) |
| `body-strong` | 13 / 20 | 510 | 0 | A row title, a button label, a nav item |
| `body` | 13 / 20 | 400 | 0 | Default text, the thread |
| `meta` | 12 / 16 | 400 | 0 | Meta lines, helper text, chips |
| `label` | 12 / 16 | 510 | 0 | Section labels in `text3`, property names |
| `micro` | 11 / 14 | 510 | 0.01em | Counts in badges, key hints |
| `mono` | 12 / 18 | 400 | 0 | Task keys, paths, commands |

## 4. Spacing, density and size
1. The base unit is 4 px. Use 4, 8, 12, 16, 24, 32 and 48 px. MUI `spacing(1)` is 4 px.
2. Heights:

| Item | Height |
|---|---|
| Title area and top bar (macOS) | 44 px |
| Sidebar item | 28 px |
| List row | 36 px (one line) |
| Board card | content height, 10 px padding |
| Button | 28 px (`small` 24 px) |
| Input and select | 32 px |
| Chip | 20 px |
| Tab | 32 px |
| Dialog | width 480, 560 or 720 px; padding 20 px |

3. Page content has a maximum width of 960 px for forms and settings. Lists and the board use the full width.
4. The sidebar is 240 px wide from 1200 px, an 80 px rail from 600 px (the traffic lights of macOS 26 reach x 76), and a drawer below 600 px.

## 5. Radius, borders and elevation
| Token | Value | Use |
|---|---|---|
| `r-xs` | 4 px | Chips, badges, key hints |
| `r-sm` | 6 px | Buttons, inputs, rows, nav items |
| `r-md` | 8 px | Cards, code blocks, the gate card |
| `r-lg` | 12 px | Dialogs, menus, popovers |
| `r-full` | 9999 px | Status dots, avatars |

1. Borders are 1 px `line`. An input uses `lineStrong`. A selected card uses `lineStrong`, not a color.
2. Elevation: level 0 is `surface`, level 1 is `raised` with a `line` border, level 2 is `overlay` with a `line` border and a shadow (dark: `0 8px 24px rgba(0,0,0,.5)`; light: `0 8px 24px rgba(0,0,0,.12)`).
3. Do not use the MUI elevation overlay. Paper has elevation 0 and the `overlay` color in menus and dialogs.

## 6. Motion
1. Durations: 100 ms for hover and press, 150 ms for menus and tabs, 200 ms for dialogs and panels.
2. Easing: ease-out to enter, ease-in to leave. A leave is shorter than an enter.
3. Animate only opacity and transform. Do not animate width or height.
4. With `prefers-reduced-motion: reduce`, use no transition longer than 100 ms and no movement.
5. Turn off the MUI ripple. Show the press state with the `selected` color.

## 7. Icons
1. Use one outline icon set: the `Outlined` variants of `@mui/icons-material`. Do not mix filled and outline icons.
2. Sizes: 16 px in rows, chips and buttons; 18 px in the sidebar.
3. Icons have the `text3` color. An active nav item has the `text` color.
4. An icon-only button has an `aria-label` and a tooltip with the shortcut.
5. Do not use emoji as icons.

## 8. Components
### 8.1 Window and title area (macOS)
1. The window uses the hidden inset title bar (`titleBarStyle: "hiddenInset"`). The traffic lights sit at x 16, y 14, inside the 44 px top row of the sidebar. When the sidebar is a drawer (below 600 px), the top bar starts 80 px from the left.
2. The top 44 px of the sidebar and of the main area move the window (CSS class `aw-drag`). Buttons, links and inputs in that row do not. Menus, dialogs, popovers and the drawer do not move the window: Electron finds drag regions by CSS, not by the element on top, so the theme makes the roots of the MUI overlays `no-drag`.
3. A double-click on the title area zooms the window (the system setting).
4. The window background is the `canvas` of the system scheme at the start (`backgroundColor`), so no white frame shows.
5. AW uses no vibrancy in phase 1: solid colors keep the contrast of the tokens.

### 8.2 Sidebar
1. Order from the top: the workspace switcher; Inbox (with the count of the rows of its "Needs you" tab); All tasks; the section "Projects" with the "+" of Add a project and one row per project; the section "Workspace" (Shared knowledge, Credentials); the section "This device" (Devices & sync, Settings); at the bottom, the device name, the sync state and Sync. The sidebar shows only the current workspace.
2. A project row has the letter tile of the project, the name and its counts "needs you · working". A click opens its Board. The project tabs (Board, List, Knowledge, Files, Settings) show in the page header (`ProjectFrame`), not in the sidebar. The letter tile is neutral: `project.yaml` has no color, and color means status (principle 3).
3. The workspace switcher shows the letter tile and the name, and opens a menu: each workspace with its folder and a check mark on the current one, "Add a project…", "Add a workspace…", "Rename…", "Remove from this device…". "Join with a pairing code" is only on the first-run screen: a device with a workspace already has its identity.
4. Items are 28 px high, with an 18 px icon, a 13 px label (510) and a right-aligned count in `text3`. The active item has the `selected` fill. The Inbox count is the number of "Needs you" rows of the Inbox (tasks in the lane, tasks with an answer notice and files to fix, not open gates) in the `you` color. All tasks counts the active tasks that are not done.
5. The rail (600 to 1199 px) has the same items as icons with tooltips: the switcher as the letter tile, the projects as letter tiles, a divider in place of each section label, and Sync with a status dot.
6. The sync state is a dot in the status color and a short text: "Synced 12 s ago" (`ok`), "Syncing" (`run`), "3 changes not synced", "Sync is off", "No other device" (`wait`), "Sync failed" (`err`). Only a connected device that is not in sync makes "Syncing". An offline device with no change to get does not change the state. It opens Devices & sync. It reads the sync status again every 10 s.

### 8.3 Top bar
1. Left: the breadcrumb (workspace › screen; workspace › project › tab; or workspace › project › task key). The earlier parts are links. Right: the "Needs you" count (it opens the Inbox), the sync state (from 1200 px), "Sync now", "New session" and "New task" with its key hint.
2. "New task" is the only primary (accent) button of the top bar.
3. Below 840 px "Sync now" and "New session" show icons only. Below 600 px the breadcrumb shows its last part only, and each button shows an icon only, with a tooltip.

### 8.3.1 Inbox
1. A list and a detail with the tabs "Needs you" and "Updates". The tab and the selected row are in the route (`?tab=updates`, `?item=`).
2. "Needs you": one row per task in the lane (the reason in `you`, the title, the key and the project) and per file to fix; then the groups "Working now", "Paused" and "Queued", which open the task. A task with an answer notice keeps its row until the person closes the notice.
3. "Updates": the knowledge of today and each device that is offline with changes of this workspace not synced.
4. The detail of a task has the key, the project, the assignee, "Open task", the title and the gate cards. From 840 px the first row shows when no row is selected, or when the selected row left the list (an answered gate). Below 840 px the detail replaces the list, with Back.
5. With no project or no active task, the Inbox shows its empty state (8.13.1) with the "Fix a file" cards and the "Knowledge today" card under it.

### 8.4 Lists
1. A row is one line, 36 px: status icon (the icon of its group), task key (mono, `text3`), title (`body-strong`), then right-aligned chips, the assignee and the age. Below 840 px the assignee hides; below 600 px the chips hide.
2. A group header is 32 px with a collapse arrow, the group name and the count, on the `canvas` color. A click collapses or opens the group. The last group "Archived" holds the archived tasks; it is closed at the start, and each row has "Unarchive" at the right. The Board shows no archived task.
3. Hover uses `hover`. The selected row uses `selected` and a 2 px accent mark at the left.
4. Up and Down arrows move the focus between the rows. Enter opens. Esc closes the detail, except in a text field.

### 8.5 Board
1. One column per stage with the stage name, the count and a short description (`STAGE_HINT`). The columns share the width with a minimum of 160 px, so all 6 show at 1280 px with the 240 px sidebar; below that the board scrolls sideways.
2. "Needs you" is a row (a swimlane) across the stage columns, so a card keeps its stage. Under it, the row "Everything else". With no task in "Needs you", the board has one row and no row labels. Each column is one region that spans the rows (CSS subgrid), and the row labels stay at the left in a side scroll.
3. A card is `raised`, `r-md`, with the key, the project tile and name, the title (2 lines at most), one state chip (Needs you, Paused, Queued or Moving; the column shows the stage), the assignee and the age. A "Needs you" card has a `you` line at 40 %, not a full amber fill.
4. An empty column shows "No tasks" in `text3` in its last row.

### 8.6 Task view (issue style)
1. Header: the key, the project, the state chips (and "Archived") and the stage progress (6 segments, with the stage name as text); then the title in `title-lg`. The task route has Back; the board split has Close. Before Close, the icon button "Task actions" (⋯) opens a menu (openspec task-actions): "Stop session…" while a session runs on any device, "Archive task…" (`err` text) or "Unarchive task". Stop and Archive open a confirm dialog (8.8) that names the session device; with a running session, Archive says that AW stops the session first ("Stop and archive").
2. Tabs: Activity (default), Session, Terminal, Files. The tab bar scrolls at 400 px.
3. Activity: the open gate cards first; then the first message once as the description (Markdown with its single line breaks, and a "Show raw" switch for the exact text); then the activity in a compact form. An agent message longer than 6 lines shows 6 lines and "Show more".
4. The Activity rule is one table with an entry for each event type of the contract (`desktop/src/renderer/src/activity-model.ts`). Activity shows the task changes (created, assigned, rekeyed, edited, stage, pause and resume, done, archived, learned), the messages (agent messages with the source `tool` or no source, person, comments), the gates and their answers, the approach versions, the results and the artifacts. A session input (`message.human`) shows only when the person typed it in the terminal (source `typed` or `phone` with no delivery id); the other inputs repeat a text that Activity has. The text of an agent turn (`message.agent` source `turn`) and a nudge notice (`message.sent` kind `nudge`) show only in Session (`decisions/2026-11-25-agent-pushes-updates.md`). A session end (`session.ended`) shows only when the session stopped or crashed, with its cause and the next step (principle 2, decision 37): "Session stopped on ubuntu-01: a person stopped it or ended the agent. AW starts no new session until a person starts one." The phone uses the same rule (`android/control` `ActivityRule`); both apps test their rule against `contracts/fixtures/activity/cases.json`.
5. Session: the session summary (state, device, host, claim epoch, session id, branch, task id, and the link: the Claude session id and name, the terminal and the pid; "Stop session" is in the header menu), then each raw event and message of the thread, "Show older" and the original conversation (principle 8). Nothing in Session is hidden.
   Each tab except Activity shows one line "<n> items need you" with "Show in Activity" when a gate, Assign or a pause needs the person. A gate never hides behind a tab.
6. Terminal: the snapshot. Above it only the cards that act on the terminal ("Take over terminal", "Sign in"); other open items are one line with "Show in Activity".
7. Files: the read-only folder of the task.
8. Properties (from 1,000 px of the task detail's own width, a 300 px right panel; else a Properties tab): stage, assignee, project, approach versions, test server, credentials, queue, parent and subtasks, dependencies, progress. Read-only in phase 1; editable values come later.
9. The message box is at the bottom of the Activity and Session tabs, outside the scroll area.
10. Phone (openspec phone-task-focus): the same tabs with Properties in place of Files (the phone has the artifacts, not the task folder). The description is Markdown, with "Show raw" on the desktop. The pause chip stays in the header above the tabs. The header has the same "⋯" menu as the desktop; "New session" stays below the chips. The Tasks list ends with the group "Archived". The header scrolls with the list and the tab row stays at the top, so a short window (landscape, the keyboard open) keeps the list. On a large window the third pane is the Session view, and the tab row has no Session tab.

### 8.7 Gate card
1. `raised` fill, a 1 px `you` line at 40 %, `r-md`, 16 px padding.
2. Header: the gate kind with its icon in `you`, the author and the time on the right.
3. Body: the question as the title; the details or the result text above the options (a long text shows its start and "Show more"), the evidence (artifacts as tiles), the options. An option shows its description under its label. A question or reply gate with no details shows "Context": the agent messages since the last person event before the gate. A gate with several questions, or a multiSelect question, shows each question with its header and its options as choices, and "Send answers". The phone shows the details as Markdown too.
4. Actions: the main answer is an `accent` filled button; other answers are outline buttons; a destructive answer (Deny) uses `err` text. A question or reply gate shows one full-width button per option, stacked, with the label and the description under it: the recommended option (the first label with "(Recommended)", else the first option) is filled, the others are outlined. A question list shows each option as a full-width toggle with a check mark and an `accent` line when picked, then "Send answers".
5. Below the actions: one `meta` line that says what happens after the answer.

### 8.8 Dialogs
1. `overlay` fill, `r-lg`, a `line` border and the level 2 shadow. The backdrop is `scrim`.
2. Title (`title-sm`) and an optional `meta` line under it. A close button at the top right.
3. Fields have their label above the input (not a floating label), and helper text below.
4. Footer: a `meta` status text on the left; Cancel (text button) and the primary button on the right. Below 600 px the status text takes its own row above the buttons (`DialogStatus`). ⌘↵ submits. Esc closes.

### 8.9 Command menu
1. ⌘K opens a search field with the actions and the objects: the actions "New task", "New session", "Sync now" and "Add a project"; the screens; the projects (their Board); the tasks of the workspace by key and title. Each word of the search must match. When the search text is a task key, that task is the first row. With no search text the menu shows 8 tasks.
2. It is a dialog at the top third of the window, 640 px wide, with 36 px rows grouped by kind and the shortcut of each action. Enter runs the highlighted row. Esc closes the menu.
3. The renderer reads ⌘K and ⌘1 to ⌘4 (Ctrl on other systems); the app menu keeps ⌘N and ⌘R. On macOS, Ctrl+K stays "delete to the end of the line" in a text field. The keys do nothing while another dialog is open.

### 8.10 Chips and badges
1. A state chip is 20 px, `r-xs`, a 12 px label, a 12 px icon, and the status tint as fill. No outline chips.
2. A count badge is `micro`, `r-full`, 16 px high.
3. A key hint is `micro` mono in a 16 px box with a `lineStrong` border.

### 8.11 Buttons
| Kind | Fill | Text | Use |
|---|---|---|---|
| Primary | `accent` | `onAccent` | One per view: New task, Create, Save |
| Gate | `accent` (= `you`) | `onAccent` | The main answer of a gate |
| Secondary | `raised` + `line` border | `text` | Other actions |
| Text | none | `text2` | Cancel, low-priority actions |
| Destructive | `raised` + `line` border | `err` | Revoke, Stop session, Remove |

All buttons have `r-sm`, a 13 px label (510), no uppercase and no elevation.

### 8.12 Inputs
1. 32 px high, `surface` fill (so it stands out on a raised card and on a dialog), `lineStrong` border, `r-sm`, 6 × 10 px padding.
2. Focus: a 2 px `focus` ring outside the border. No color change of the fill.
3. An error shows a red border and the error text under the field.

### 8.13 Empty states and loading
1. An empty screen has one line that says what is missing, and one button for the next step ("Add a project", "New task"). Use `Empty` of `common.tsx` with its `action`. The Inbox of a workspace with no project shows "No projects yet" and "Add a project"; with a project and no task, "No tasks yet" and "New task". The Board and the List of a project with no task show "No tasks yet" and "New task". An empty Board column shows the line "No tasks" in `text3`.
2. Loading shows skeleton rows of the final size after 300 ms. Do not show a spinner for less than 300 ms.

### 8.14 Banners and notices
1. A banner is a full-width row at the top of the content, 36 px, with the status tint and one action.
2. Do not stack more than 2 banners. Put other notices in the Inbox.

### 8.15 Terminal and code
1. The terminal snapshot uses `term` and `termFg` in both schemes, `mono`, `r-md`.
2. A code block in Markdown uses `raised`, `mono` 12 px and `r-sm`.

### 8.16 Pages: devices, knowledge, files, credentials, settings
1. A page starts with the title (`h2` variant), one `meta` description line and the actions on the right (`PageHeader` in `common.tsx`). The page padding is 24 px (16 px below 600 px).
2. Forms and settings have a maximum width of 960 px. They are titled sections (`Section`: `title-sm`, an optional `meta` line) with a `line` divider between them. Do not put each section in a card.
3. A property row (`PropertyRow`) has the label in `text3` on the left (96 px to 128 px) and the value on the right; below 600 px the value goes under the label. Devices & sync, the knowledge file view and the Sync block use it.
4. Devices & sync: a grid of device cards (`raised`, at least 360 px wide). A card has the device icon with a presence dot (`ok` or `wait`), the name, the role line with the slug, Revoke (destructive), and property rows: presence, the workspace folder (this device only), sync, route, folders, agent, sessions, test slots, session hosts, "Use Orca" and the projects with their host.
5. Knowledge: one tree with the groups Rules, Knowledge and Learned; on a project page, a shared file has the tag "shared". From 840 px the first file opens. The file view has the path (mono), the apply chip, the rows "Last change" and "On devices", and the tabs Content and History.
6. Files: a task row is "<key> · <title>" with the stage as the meta line. A task id shows only in the tooltip of the folder line.
7. A code block of a page (a file, a diff, a suggestion) is `CodeBlock`: `raised`, `mono` 12 px, `r-sm`.
8. Settings has the sections New projects, Appearance (System, Light, Dark), Startup, Notifications, Sync across networks, Workspaces on this computer (the name and the folder of each workspace) and Setup check. New projects has one menu "Default permissions for new projects" for each workspace (with the workspace name when there are 2 or more). It saves at once and shows the `err` alert for "Skip permissions" (openspec permissions-default). Appearance sets `nativeTheme.themeSource`, so the window, the page and the menus follow it.

### 8.17 Create flows
1. From an empty app, the person makes a workspace, a project and a first task in 3 short steps: "Create the Personal workspace", "Add a project", "New task".
2. Before the first workspace, the top bar shows no action: the first-run screen has the next step.
3. A folder field has "Choose…" on its right (`FolderField` of `ProjectCreate.tsx`). It opens the native folder dialog of the main process. The path shows in `mono`.
4. "Add a project" opens from the "+" next to the workspace name in the navigation, the workspace menu, the empty Inbox, and New task with no project. The dialog lives in the dialog provider, so a narrow window does not close it. The workspace dialogs (Add a workspace, Rename, Remove from this device) live there too (npc-11). "Add a workspace" and "Join with a pairing code" have a Location field with "Choose…" (placeholder `~/AW`): the folder that holds the workspace folder. A Location of "Add a workspace" that is a workspace folder that another device synced registers that workspace. When awd uses `<name>-aw1` or registers a folder, "Add a workspace" shows the note and "Open the workspace"; the Join dialog shows the folder under the check code.
5. "Add a project" asks for the checkout folder first. The name and the slug come from the folder name, and the person can change them. A folder inside the workspace folder blocks the add. A folder with no `.git` shows a warning. The add writes the project and the checkout of this device in one step. After the add, the Board of the project opens.
6. New task with no open project shows "Add a project first" and one button. After the add, New task opens with the new project.
7. In New task, an empty select shows its empty value ("None"). "Start the agent now" assigns the default agent of the project on its first device; the default stays "None". Credentials are chips from the credential list. The footer status line says what happens on "Create task".
8. New session starts with the task of the page. It shows where the session works (the checkout folder of this device, or whether another device has a checkout) and links to the project settings when Orca is off on this device.
9. The Assign card has one filled button "Assign to <agent>" for the default agent on the first device. Other agents are outline buttons. The free-text agent field shows only after "Other agent…".

### 8.18 Session options
1. New task, New session and "Assign to another device…" have one "Session" block (`SessionOptionsFields` of `SessionOptions.tsx`): "Permissions" (Project default · <mode>, Default, Accept edits, Skip permissions) with one help line, the switch "Agent teams · experimental", and "Work in" (Separate worktree, Project checkout, Other folder…). The phone has the same block. In New task, "Permissions" (`PermissionsField`) is in the row of "Assignee", below the row of "Title" and "Project", so it shows with no scroll. Its Session block has only "Agent teams" and "Work in" (openspec permissions-default).
2. "Skip permissions" shows an `err` alert; "Project checkout" shows a `warn` alert "This changes the branch and the files of your checkout. One session at a time works there."; "Other folder…" shows a folder field with "Choose…" (the native dialog of this computer) and blocks the dialog until the folder is an absolute path.
3. New session and "Assign to another device…" start with the options of the task and send them only when the person changes them.
4. The task header shows a chip "Skips permissions" in `err` (an icon and the label, 8.5) and a chip "Agent teams" when they apply to the running session, else to the next one.
5. Properties show "Permissions", "Agent teams" and "Works in <folder> · branch aw/<key>" in `mono`, with Copy, and Open when the session runs on this device (main opens the folder that awd names; the renderer sends no path).
6. Project Settings have a "Sessions" section with the default permission mode of the project. A new project gets the mode of Settings → New projects (default "Skip permissions"). New task preselects "Skip permissions" on the desktop and the phone (openspec polish-skip-default); "Project default · <mode>" stays a choice.
7. Phone New task: the form scrolls above a pinned action bar with "Cancel" and "Create task" (a Material 3 surface with tonal elevation 3 dp, above the keyboard). The phone task list header keeps "New task" at its end, outside the scrolling project chips. The phone form has each field of the desktop New task (openspec polish-skip-default): first message, title, project, assignee and "Start the agent now", test server, parent task, credentials (chips of the names that the tasks of the workspace use, and a field for another name: the phone has no `secure/` folder), and the Session block (Project default and the 3 modes, agent teams, Works in, the folder of the session device).

### 8.19 Markdown
1. Claude output is Markdown on the desktop and the phone: the gate details, the Context of a gate, the agent messages in Activity, the approach versions and the first message. The Session view shows the raw text (principle 8).
2. Desktop: `MarkdownText` of `common.tsx` (`react-markdown` with `remark-gfm`). Phone: `MarkdownText.kt` (`multiplatform-markdown-renderer-m3`). Headings stay at `title-sm` size inside a card.
3. No raw HTML, no script, no remote image. A link opens in the system browser only when it starts with `https://`.

### 8.20 Phone sizes
1. The phone uses the compact components of `Compact.kt`: buttons 36 dp high with 6 dp corners, text fields about 50 dp high (13 sp text, a 48 dp minimum), and a type scale with 14 sp body text (`CompactTypography` of `Theme.kt`).
2. Each control keeps a touch target of at least 48 dp.
3. The phone uses the same tokens as the desktop, as a fixed Material 3 color scheme (`DarkScheme`, `LightScheme`), with no dynamic color.

### 8.21 App icon
1. The AW mark: a rounded square with a square opening, split on the diagonal into a light half (`text`) and a gray half (`text3`). It is an AW drawing of the logo of the prototype. The one source is `shared/ui/icons/aw-mark.svg`.
2. `pnpm icons:generate` (`scripts/icons.ts`, with `sharp`) makes each icon from it: the macOS app icon (`desktop/resources/icon.png`, a dark tile on the macOS icon grid; electron-builder makes the `.icns`), the menu bar template image (`desktop/src/main/tray-icon.ts`) and the Android adaptive icon (foreground, monochrome and the dark background). Do not edit these files by hand: a test of `@aw/scripts` compares them with the output of the script.

## 9. Keyboard
| Key | Action |
|---|---|
| ⌘N | New task |
| ⌘⇧N | New session |
| ⌘R | Sync now |
| ⌘K | Command menu |
| ⌘F | Search in the current list |
| ⌘1 … ⌘4 | Inbox, All tasks, Devices & sync, Settings |
| ↑ ↓ | Move the selection in a list |
| Enter | Open the selection |
| Esc | Close the dialog or the detail |
| ⌘↵ | Send the message or submit the dialog |

## 10. Accessibility
1. Text meets 4.5:1 on its surface. A test of `shared/ui` checks the token pairs of 2.2 and 2.3.
2. Each control shows the focus ring on keyboard focus (`:focus-visible`).
3. Do not show state with color alone: each chip has a label and an icon.
4. Each icon-only control has an accessible name.
5. Respect `prefers-reduced-motion` (6.4).

## 11. Copy
1. Use ASD-STE100 (`AGENTS.md`, "Writing") and the terms of `prd.md` section 6.
2. Buttons are verbs: "Approve result", "Assign", "Sync now".
3. An error says what happened and what to do: "awd is not reachable. AW tries again in 5 s."

## 12. Map to the code
1. `tokens.dark` and `tokens.light` in `@aw/ui/tokens` hold section 2. `createAppTheme()` maps them to the MUI palette (`primary` is `accent`; `background.default` and `background.paper` are `surface`; `text.secondary` is `text3`) and to the palette group `aw`. The CSS variable of a token is `--mui-palette-aw-<token>`; the mono stack is `--aw-font-mono`. `awVar()`, `mainVar()` and `tint()` of `@aw/ui` write these values.
2. Type roles and MUI variants: `h1` = `title-lg`, `h2` = `title` (page titles), `subtitle1` = `title-sm`, `subtitle2` and `overline` = `label`, `body1` = `body`, `body2` and `caption` = `meta`. `body-strong` is `body1` with weight 510. The `h2` variant renders an `h1` element: the page title is the first heading of its page. Labels in the sidebar are not headings.
3. `createAppTheme()` sets the typography of section 3, the shape of section 5, the motion of section 6 and the component defaults of section 8 (`MuiButton`, `MuiChip`, `MuiDialog`, `MuiTextField`, `MuiListItemButton`, `MuiTab`, `MuiTooltip`, `MuiMenu`).
4. A Typography `color` prop takes a palette path: `text.secondary`, `warning.main` or `aw.text2`. MUI 9 has no system props, so the theme variants of `createAppTheme()` map these paths (`typographyColors()` lists them). Other components take a color only in `sx`: on a `Box`, `color="text.secondary"` becomes an HTML attribute.
5. Screens do not set their own colors, sizes or radii. They use the palette, the typography variants and the theme spacing (`engineering-rules.md` 5.18).
