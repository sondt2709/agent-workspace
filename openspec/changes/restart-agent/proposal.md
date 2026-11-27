## Why

When the session of a task cannot start, the person sees "Queued · starts soon", and the cause is only on the Session tab. "New session" sends a new assignment, but awd still waits up to 60 s and writes no comment for the same cause, so the person gets no answer. The person needs one action that starts the agent again at once, and a visible cause.

## What Changes

- awd marks the comment of a failed start with `kind: "start_failed"`.
- The merged task view gets `start_failure {device, text, at, retrying}`. A newer person assignment sets `retrying`; a newer claim clears it.
- After a newer person assignment, awd tries the start at the next check (no 60 s wait), and writes the start comment again when it fails again.
- The desktop task header and the phone task screen show "Did not start on <device>: <cause>" with the action "Restart agent" in place of the queue chip. "Restart agent" sends a person `task.assigned` with the same assignee and no new options. It shows only when no session of the task runs.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `workspace-schemas`: the optional `kind` of `comment.added`.
- `workspace-merge`: the field `start_failure` of the task view.
- `agent-sessions`: the start try after a person assignment, and the comment of each failed start after it.
- `task-actions`: the action "Restart agent" on the desktop and the phone.

## Impact

- `shared/schema/src/events.ts`, `shared/core/src/merge/task.ts`, `shared/core/src/merge/view.ts`, the merge fixtures in `contracts/fixtures/merge/`, the Kotlin merge in `android/shared/`.
- `daemon/src/sessions/manager.ts`.
- Desktop: the task header (`common.tsx`, `TaskDetail.tsx`). Android: the task screen and its logic in `android/control/`.
- No new API route: "Restart agent" uses the assign route. The CLI equivalent is `aw task assign <task> <same agent>`.
