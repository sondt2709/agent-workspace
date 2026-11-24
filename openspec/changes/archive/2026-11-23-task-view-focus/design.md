## Context

The task detail (`desktop/src/renderer/src/components/TaskDetail.tsx`) has the tabs Thread and Terminal and a Fields panel. The Thread shows each event of the task log (`Thread.tsx`), so a person sees claims, session lines, each input of the session and the first message 3 times. Review `ui-ux.md` 5.2 asks for an issue-style view (`docs/design.md` 8.6). The thread API (`useThread`, 500 events per page) stays the same.

## Goals / Non-Goals

**Goals:**
- Activity shows the task: gates, the description, the human and agent messages, the work products and the stage changes.
- Session keeps each raw event and message (principle 8), with a test for each contract event type.
- A layout by the width of the task detail, a stage progress bar, the message box at the bottom, Files in the task.

**Non-Goals:**
- Editable properties (a later journey, review 5.2 decision 4).
- The phone task detail (open item).
- A new API or a server-side filter.

## Decisions

1. **The Activity rule is a table in `activity-model.ts`**, `ACTIVITY: Record<string, "activity" | "session">`, one entry for each event type, plus the function `inActivity(row)` that adds the `message.human` source rule. A test reads `contracts/samples/schema-samples.json` `event_types` and fails when a type has no entry, so a new event type needs a decision. Alternative: a list of hidden types only; a new type would then show in Activity with no decision.
2. **`message.human` rule.** Show only source `typed` or `phone` with no `delivery_id`. Each other `message.human` repeats a text that Activity already has: `first` (the description), `answer` (the `gate.answered`), `notice` (AW text; the stage change shows), and a delivered message (the `message.sent`). A typed input with no delivery id is text that the person typed in the terminal and exists nowhere else.
3. **Filter in the renderer, on the same thread window.** Activity uses the same `useThread` pages and "Show older" as Session. No new query.
4. **Width by `ResizeObserver`** on the task detail box (break point 1,000 px). In a test (no `ResizeObserver` in jsdom) the hook falls back to the media query `lg`. Alternative: a prop from the board split; it fails when the person drags the split wider.
5. **Session tab = the old Thread component** with the session summary above it. `systemLine` stays the one text of each event type; Activity reuses the row parts of `Thread.tsx`.
6. **Terminal cards.** `NeedsYouCards` gets a `terminal` prop (with `onShowActivity`) that keeps a `take_over_terminal` gate and a `login_expired` pause; the other items count into one line with "Show in Activity".
7. **Files tab** reuses `TaskTree` and `FileText` of `Files.tsx` (exported). The Files screen of the project stays.
8. **Stage progress**: 6 segments (Backlog, Discuss, Ready, Implement, Review, Done) with the `run` color up to the current stage, `ok` for Done, and the stage name as text (color is not the only signal).

## Risks / Trade-offs

- [A person misses an event in Activity] → The Session tab is one click away and shows each event; the rule is one table with a test.
- [Parallel UX tasks change the same files] → Keep `Files.tsx` and `GateCard.tsx` changes to exports and one style line.
- [Long agent replies] → Clamp to 6 lines with "Show more"; Session shows the full text.
