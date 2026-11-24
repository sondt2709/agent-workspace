## Context
- The PermissionRequest hook waits 120 s on awd, then denies with `interrupt: true` (`daemon/src/sessions/permissions.ts`). The gate "Approve command" stays open, so a late "Allow" becomes a one-time approval (`docs/phase-1.md` 9.5.2).
- Only the session check of a running session resolves a gate with an answer (`#resolveGates` in `daemon/src/sessions/manager.ts`). A gate of a stopped session keeps its answer `pending` forever.
- The owner device writes the session events (`session.ended`, `task.released`). The work loop `tick()` runs a pass over the owned tasks (parent notices, knowledge gates, pushes).
- `gate.resolved {answer_event: null}` exists: `aw approach` and `aw result` use it for a replaced version. The TypeScript and Kotlin folds accept it, and each pending answer then becomes a `late_answer` comment.
- Real Claude Code 2.1.331 with haiku on a Linux test server (base `8804745`): the hook reply came after 120,087 ms, the agent showed "Interrupted", a late "Allow once" gave "Approved: run it again" and the retry ran. After `aw session stop`, the open gate and the later phone answer stayed (the evidence of the pull request).

## Goals / Non-Goals
**Goals:**
- No gate in Needs you that no session can use, on the desktop and the phone.
- A late answer to such a gate gets the late-answer notice, and no answer stays `pending`.
- The gates that are stuck now close after the update.

**Non-Goals:**
- A change to the 120 s hook wait or to the late "Allow" while the agent waits.
- `approve_result` with no session: its answer still waits for the next session (open item).
- A change of the gate card layout (gate-context works on the cards).

## Decisions
1. **Keep the gate open after the 120 s deny while the agent waits on it.** After the interrupt, the agent waits for input. With no gate, the task would stop with no cause in Needs you (principles 2 and 4). The late "Allow" is one tap from the phone (principle 1). Alternative: close the gate at 120 s. Rejected: the task then stalls with no visible cause, and the person must write a message to get the same result.
2. **The gate closes when the wait has no use.** An `approve_command` gate of session S closes with "Denied after <n> s" when S starts a new turn after the gate opened (a `message.human` of S that is not the delivery of an `approve_command` gate), or when S opens another `approve_command` gate more than the timeout after it. Parallel requests of one turn stay open together.
3. **The session of a gate comes from the log order.** It is the session of the newest applied `session.started` or `session.resumed` before the `gate.opened`. No new field: old logs work, and the Kotlin fold does not change. A session ended when its newest session event is `session.ended`, or when the task shows another session (a move writes no `session.ended` for the old session on the new owner).
4. **Kinds per end reason.** `approve_command`: each reason, because the tool call ended with the process. `question`, `reply`, `confirm_approach`, `custom`, `continue_after_limit`: only `stopped` and `done`. At `moved` and `replaced` the next session gets them in its SessionStart context (existing test "Answer after a new session"). At `crashed`, "Resume again" resumes the same session. A gate of a session that another session replaced (no `session.ended`) counts as `replaced`, except `approve_command`.
5. **One writer: the owner device, in the work loop tick.** It runs after the session check in the same queue, so a pending answer of a running session is used first. The rule skips a gate with a pending answer of the current version while its session runs. The pure rule is `staleGates()` in `daemon/src/loop/stale-gates.ts`, with unit cases.
6. **Answers:** `Session ended` and `Denied after <n> s` (n = the permission timeout in seconds). No `[AW answer]` goes to a session: the delivery skips a close with no answer event and no answer, and a session that ended gets no delivery.
7. **Late-answer notices.** The desktop `answerNotice` and `refusedNotice` say "AW closed this gate (“<answer>”) before your answer arrived" when the gate has no answer event. The API adds `answer_event` to the `gate_not_open` details for that. The phone `LateAnswers` adds the case "a gate that AW closed with `Session ended` or `Denied after …`", with the text "Your answer “X” came after AW closed the gate: <answer>. It is a comment now." The phone keeps no card for a replaced version (the earlier rule).

## Risks / Trade-offs
- [A wrong rule closes a gate that a person still needs] → unit cases for each kind and reason; the existing tests of the late "Allow" and of a question after a new session stay green.
- [The owner device is offline] → the gate stays open until it is back; the same as every owner write.
- [A person answers in the terminal and the hook wait ends later] → the gate closes at the next turn of the session.

## Migration Plan
None. The rule reads the merged log at each check. After an update, the first check closes the stuck gates. Rollback: an older awd leaves the closed gates closed (the events stay valid).

## Open Questions
None.
