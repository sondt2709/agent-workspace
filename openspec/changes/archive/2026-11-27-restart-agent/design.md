## Context

- `#startFailed` in `daemon/src/sessions/manager.ts` writes "The session did not start on <device>: <cause>. AW tries again in 60 s." once per cause, and `#claims` skips the task for `START_RETRY_MS`.
- A person `task.assigned` with the same assignee makes `#needsClaim` true, but the 60 s wait and the "same cause, no comment" rule stay.
- `comment.added` has only `text`. The task view has no start state; the desktop header shows the queue chip "Queued · 1st for <agent> · starts soon".

## Goals / Non-Goals

**Goals:**
- A person sees why the session did not start, on the task page of the desktop and the phone.
- One action starts the agent again at once, and the thread answers each try.

**Non-Goals:**
- No restart of a running session: "New session" stays for that.
- No new API route and no new CLI command.
- No start state in the task lists (Inbox, All tasks).

## Decisions

1. **A structured comment, not text matching.** `comment.added` gets an optional `kind: "start_failed"`. The UI never parses the comment text. An alternative was a new event type `session.start_failed`; a comment kind keeps the thread as it is and needs no new event handling in each reader.
2. **The fold owns the state.** `TaskFold` sets `start_failure {device, text, at, retrying: false}` on a `start_failed` comment from the assignee device. A later applied person `task.assigned` sets `retrying: true`. A later applied `task.claimed` or `session.started` clears it. The order is the HLC order of the fold, so all devices show the same state. The Kotlin fold does the same, and the shared merge fixtures check both.
3. **awd reads a newer person assignment as a restart.** In `#claims`, when the newest applied person `task.assigned` of the task is newer than the last start error, awd drops the wait and the "same cause" memory, so the next check tries at once and a new failure writes a new comment.
4. **"Restart agent" is an assignment.** The desktop and the phone send `task.assigned` with the current assignee and no `session_options` (the task keeps its options) and no `session_host` (the host choice stays). The action shows only with an assignee and no running session.

## Risks / Trade-offs

- [A person clicks often] → Each click gives one try and at most one comment; awd checks every 2 s, so the clicks of a person cannot make a loop.
- [An older awd writes no `kind`] → The header then shows the queue chip as today; the cause stays on the Session tab.
- [Each `expected.json` of the merge fixtures gets `start_failure: null`] → A script adds the field; one case gets the new events and its values by hand.
