## Why
In a trial on a MacBook Pro, 3 "Approve command" gates stayed in Needs you after the person stopped the session. The answers from the phone then stayed "pending answer from human@<phone>" forever. Nothing closes a gate that no session can use: the hook denies at 120 s but keeps the gate open by design, and only a running session resolves an answer (fix list ux-5).

## What Changes
- The owner device closes each open gate that no session can use. It writes `gate.resolved` with `answer_event: null`:
  - "Session ended" for an `approve_command` gate when its session ended for any reason, and for a `question`, `reply`, `confirm_approach`, `custom` or `continue_after_limit` gate when its session ended with `stopped` or `done`.
  - "Denied after 120 s" for an `approve_command` gate when its session started a new turn, or opened another permission request more than 120 s after it.
- Gates that stay open: `approve_result`, `take_over_terminal`, `approve_knowledge`, `approve_device`, `assign`, `fix_file`. At `moved` and `replaced`, the next session still gets the open questions.
- The rule reads only the merged log. So the first check after an update closes the gates that are stuck now. No migration.
- The `gate_not_open` error details get `answer_event`.
- The desktop notice of a late answer says that AW closed the gate, and names the close answer. The phone late-answer card gets the same case.
- The hook still denies at 120 s, and a late "Allow" still works while the agent waits on the gate.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `task-loop`: a new requirement "Gates with no session": the owner device closes them.
- `agent-sessions`: the permission gate ends after a new turn, another request after 120 s, or the end of its session.
- `local-api`: the `gate_not_open` details have `answer_event`.
- `desktop-app`: the answer notices name a close by AW.
- `android-app`: the late-answer card names a close by AW.

## Impact
- Code: `daemon/src/loop/` (new rule module and a tick part), `daemon/src/sessions/manager.ts` (the loop host gets the permission timeout), `daemon/src/service/workspace.ts`, `desktop/src/renderer/src/model.ts`, `android/control` (`LateAnswers`).
- Docs: `docs/workflow.md` 3 (gate table and rules), `docs/phase-1.md` 9.5.2.
- Data: new `gate.resolved` events by `aw@<owner device>`. No schema change: the event and `answer_event: null` exist.
