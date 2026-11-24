## Context
- Desktop: Board and List open a task in a resizable split (`TaskViews.tsx`, default 55 % of the content). Inbox and the windows below 840 px already open the task route `/w/<ws>/tasks/<id>`. `GateBody` clamps the plan to 240 px; "Show more" opens a second scroll box of 50 vh. `DecisionList` shows the options as chips that do nothing.
- Android: `AwApp.kt` uses the Navigation 3 list-detail scene strategy. From 600 dp the task shares the window with the list, and from 1200 dp a third pane shows Session. The task screen limits its content to 720 dp without centring. The app draws edge to edge, so `adjustResize` has no effect, and only `FormScreens` uses `imePadding()`.
- Both apps show a typed `message.human` as raw text. Claude Code sends a subagent report to the `UserPromptSubmit` hook, so awd records it as text that a person typed.
- The prototype that the person approved: https://claude.ai/artifact/4cw9gUGZes5wZn4zUeUGLj. It uses one task page component for the desktop, the phone, the Fold and DeX.
- The open change `agent-pushes-updates` edits the same Activity files.

## Goals / Non-Goals

**Goals:**
- One task page with the same parts and the same width rules on both apps.
- The person reads the full plan and picks the decisions in place.
- Person messages and subagent reports read as Markdown in Activity.
- The phone keyboard never hides the message box, and the phone controls have one height.

**Non-Goals:**
- No Files tab on Android (a separate change). No live terminal on Android.
- No change to awd, the local API, the event schemas or the delivery of answers.
- No new source `subagent` in `message.human`.

## Decisions

1. **The task list is part of the task page, not a navigation pane.**
   - "Show list" renders a 300 px list inside the task page component on both apps. It shows only when the task page is 700 px or wider.
   - Alternative: keep the list-detail scene of Navigation 3 and a resizable split on the desktop. Rejected: the two apps would keep two layouts, and the split is the cause of the small detail.
   - The list has the tasks of the Inbox order (Needs you first), then the working tasks. A click replaces the task of the page.

2. **One width rule, measured on the task page.**
   - From 1,000 px (dp) of task page width, Properties is a right panel of 280 px, and the tab row has no Properties tab. Below this width, Properties is a tab.
   - The desktop already measures its own width (`useOwnWidth`). Android uses the width of the pane from `BoxWithConstraints`, not the window class.
   - The content of each tab has a maximum width of 840 and is centred. 840 keeps about 90 characters a line at 14 px.

3. **Need-you navigation uses the Inbox order.**
   - The header shows "<i> of <n> need you" with previous and next when the task is in the list. Otherwise it shows "<n> need you", and next opens the first.
   - With no task that needs the person, the header shows nothing.
   - The desktop takes the order from the Inbox model. Android takes it from `ScreenStates.inbox`.

4. **"Send my choices" is "Request changes" with a comment.**
   - `decisionsAnswer(decisions, picks)` in `shared/client/src/gates.ts` (Kotlin copy in `GateTexts.kt`) returns `null` when each pick is the recommended option. Both apps test it against `contracts/fixtures/gates/decisions-answer.json`.
   - Otherwise it returns `{ answer: "Request changes", comment }`, where the comment is:
     ```
     My choices for the decisions:
     - <question>: <picked option>
     Keep the recommended option of the other decisions.
     ```
   - The comment has one line for each changed decision. The last line shows only when some decisions keep the recommended option.
   - awd already adds the comment to the `[AW answer]` text, so the agent writes approach v2. awd needs no change.
   - The picks show only when the gate has the option "Request changes". Otherwise the decisions stay labels with "Recommended".
   - Alternative: "Confirm" with the decision lines. Rejected: the confirmed approach file would not agree with the picks.

5. **A message of another agent is a display rule, not a new event source.**
   - Claude Code sends a subagent report or a teammate message to the `UserPromptSubmit` hook as `<agent-message from="<id>">` … `</agent-message>`. awd records it as a typed `message.human`.
   - `agentMessage(text)` returns `null` unless the text has the open tag on its first line (or on the second line after one prefix line that ends in ":") and a later close tag. The text after the close tag (the note of the transcript form) is not part of the message.
   - A first inner line that starts with `[Subagent hand-back]` makes the kind `subagent_report`, and the body is the text after the line that ends with "The report follows:". Otherwise the kind is `agent_message`, and the body is the inner text. The common indent is removed.
   - Activity shows the row in the agent style, as Markdown, clamped to 6 lines, with the label "Subagent report" or "Agent message". The Session tab keeps the raw text (principle 8).
   - Both apps test the rule against `contracts/fixtures/activity/agent-message.json`. Its frame text is real Claude Code 2.1.331 text; the report bodies are synthetic.
   - Alternative: a new source `subagent` in awd. Rejected for now: it changes the event schema and the generated Kotlin. The person chose the display rule.

6. **The plan shows its start, then the full text in the page.**
   - `GateBody` keeps the 240 px start with the fade. "Show more" removes the limit, with no inner scroll.
   - The Android card does the same at 260 dp.

7. **Android keyboard.**
   - The content of the main `Scaffold` uses `consumeWindowInsets(padding)` and `imePadding()`.
   - While the IME shows on a compact window, `NavigationSuiteScaffold` uses `NavigationSuiteType.None`, so the bar does not sit between the content and the keyboard.
   - `FormScreens` keeps its own `imePadding()` only where the root `Scaffold` does not cover it.

8. **One Android control height.**
   - `ControlHeight = 48.dp` replaces `CompactButtonHeight = 36.dp`. It applies to buttons, outlined buttons, option buttons, decision rows, the message field and the select fields of New task.
   - A text field shows its label above the field and a placeholder inside, so it can be 48 dp high. A 56 dp `OutlinedTextField` with a floating label cannot be 48 dp.
   - Chips stay 32 dp: they are labels or filters, not form controls.

9. **Same Activity rows.** Android draws a message row as a line with a 2 dp coloured edge (agent and subagent report in the info colour, person messages in the outline colour), as the desktop does. It no longer draws a filled card.

10. **Desktop navigation.**
    - Board and List navigate to the task route. Back returns to the board with its search parameters.
    - Esc on the task page goes back, except in a text field.
    - The split code and its resize handle go away.

## Risks / Trade-offs
- [Back from a task loses the scroll position of a long board] → The board keeps its search parameters, and the "Show list" list switches tasks without leaving the task page.
- [Conflict with `agent-pushes-updates` in `activity-model.ts`, `Thread.tsx`, `TaskDetail.tsx`, `Activity.kt`, `cases.json`] → Keep the edits in these files small. The second change to merge resolves the conflict and runs both test sets.
- [A subagent report that Claude Code formats in another way shows as a normal person message] → The rule falls back to the person message as Markdown. A fixture with a real captured text guards the format.
- [The person picks other options and expects the work to start at once] → The status line under the decisions says that the agent writes approach v2 with the picks.
- [48 dp controls make the phone forms longer] → Only the height changes. The touch target was already 48 dp.

## Migration Plan
- UI only. No data migration. The release is a minor version (`feat`).
- Rollback: revert the commit. No stored state depends on the new layout.

## Open Questions
None.
