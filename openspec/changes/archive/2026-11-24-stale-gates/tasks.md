## 1. Failing test first
- [x] 1.1 Write the fake agent e2e "stop with 2 open gates" (approve_command and question, then a phone-style answer) and run it on the base `8804745`; keep the failing output in the evidence folder.

## 2. Close rule
- [x] 2.1 Add `staleGates()` in `daemon/src/loop/stale-gates.ts` with unit cases: each kind and end reason, a new turn, another request after the timeout, parallel requests, a pending answer of a running session, a crash and resume, a move to a new session.
- [x] 2.2 Add the tick part "session gates" to `TaskLoop.tick()`, and the permission timeout to `LoopHost` (`daemon/src/sessions/manager.ts`).
- [x] 2.3 Fake agent e2e: a permission timeout, then a new message closes the gate with "Denied after 2 s"; the existing late-Allow and question-after-move tests stay green.

## 3. Late answers
- [x] 3.1 Add `answer_event` to the `gate_not_open` details (`daemon/src/service/workspace.ts`), with a test.
- [x] 3.2 Desktop `answerNotice` and `refusedNotice` (`desktop/src/renderer/src/model.ts`) name a close by AW, with unit tests.
- [x] 3.3 Phone `LateAnswers` (`android/control`) names a close by AW, with a JVM test.

## 4. Docs
- [x] 4.1 Update `docs/workflow.md` 3 (gate table row "Approve command" and the numbered rules) and `docs/phase-1.md` 9.5.2.

## 5. Evidence
- [x] 5.1 Break each new test once and see it fail.
- [x] 5.2 Real Claude Code with haiku on a Linux test server (ubuntu-01): stuck gates of a base run close when the fixed awd starts on the same state; a stop with open gates closes them; a late phone answer is a comment.
- [x] 5.3 Desktop Needs you before and after, and the late-answer notice (CDP 9727). Phone Needs you and the late card on the AVD `aw-sg`.
- [x] 5.4 Root `task check`, `task leakcheck`, `openspec validate --strict` on the last commit.
