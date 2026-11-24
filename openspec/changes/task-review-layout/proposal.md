## Why
The person reviews the plan of an agent in the task Activity, but the task detail is a side panel of the board. The plan shows in a 240 px box with a second scroll box, and on a Galaxy Fold the task is smaller than on the phone. The decisions look like choices but are only labels. A person message and a subagent report show raw Markdown. The phone layout differs from the desktop, the keyboard hides the message box, and the control heights differ.

## What Changes
- A task opens as its own task page on the desktop and on Android. The board split and the third Android pane go away.
- The task page is the same on both apps:
  - The header has Back, the key, the project, the state chip, "1 of 2 need you" with the previous and next arrows, "Show list", the actions menu, the title and the stage progress bar.
  - "Show list" shows a task list of 300 px on the left. It shows only when the task page is 700 px or wider.
  - From 1,000 px of task page width, Properties is a right panel. Below this width, Properties is a tab.
  - The content of the tabs has a maximum width of 840 px (dp) and is centred.
- The plan of a gate card shows its start and "Show more". "Show more" opens the full text in the page, with no second scroll box.
- The decisions of a gate card are radio groups. The recommended options are picked first. When a pick is not the recommended option, the main button is "Send my choices". It sends "Request changes" with one line for each changed decision.
- Activity shows a person message as Markdown, with 6 lines and "Show more", as an agent message. A typed `message.human` that starts with `<agent-message` shows as "Subagent report", with the report as Markdown. The Session tab keeps the raw text.
- Android:
  - The keyboard does not hide the message box.
  - The bottom bar hides while the keyboard is open.
  - Buttons, text fields, select fields and decision rows are 48 dp high.
  - Activity rows are lines with a coloured edge, as on the desktop.
- Removed (UI only): the board split of the desktop and the third pane of Android (Session). No API, data or event change, so the release is a minor version.
- Not in this change: the Files tab on Android, and a live terminal on Android. A separate change adds the Files tab.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `desktop-app`: "Navigation and layout" (a task opens as a page), "Task detail" (header, task list, Properties width rule, no gate text scroll box), "Gate cards with the full context" (decision picks), "Task activity" (person messages as Markdown, subagent reports).
- `android-app`: "Phone screens" (the task page header and tabs), "Adaptive layout" (a task in one pane, no Session pane, list on request, keyboard), "Phone gate cards with the full context" (decision picks), "Phone task activity" (person messages as Markdown, subagent reports, line rows).
- `app-style`: "Compact phone components" (one control height of 48 dp), "Markdown for Claude output" (person messages and subagent reports in Activity).

## Impact
- Desktop: `desktop/src/renderer/src/components/TaskViews.tsx`, `TaskDetail.tsx`, `GateCard.tsx`, `GateParts.tsx`, `Thread.tsx`, `activity-model.ts`, `model.ts`.
- Android: `android/app/.../ui/AwApp.kt`, `TaskScreens.kt`, `TaskDetailParts.kt`, `Components.kt`, `Compact.kt`, `GateParts.kt`, `android/control` (`TaskTab`, `ActivityRule`, `GateTexts`, the need-you order).
- Shared: `shared/client/src/gates.ts` (`decisionsAnswer`), a new fixture `contracts/fixtures/activity/agent-message.json` for both apps.
- No change to awd, the API, the event schemas or the data. The answer of "Send my choices" uses the existing gate answer with a comment.
- Docs: `docs/design.md` (task detail and adaptive layout).
- Conflict: the open change `agent-pushes-updates` also edits `activity-model.ts`, `Thread.tsx`, `TaskDetail.tsx`, the Android `Activity.kt` and `contracts/fixtures/activity/cases.json`. The second change to merge resolves the conflicts.
