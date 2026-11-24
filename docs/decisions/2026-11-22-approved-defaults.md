# Decision: approved defaults before phase 1

| Item | Value |
|---|---|
| Date | 2026-11-22 |
| Status | Accepted by the product owner. Updated on 2026-11-23 by `2026-11-23-manual-move.md` (no automatic move). |
| Related | `2026-11-22-task-model.md` §5, `2026-11-22-device-sync.md`, `../engineering-rules.md`, `../tech-stack.md` |

## Decision
1. **Release trigger.** semantic-release makes a release only for `feat` (minor), `fix`, `perf` and `revert` (patch) and breaking changes (major). Other merges make no release, because each release costs notarization, a store upload and a self-update on each device.
2. **Commit and PR title types.** `feat`, `fix`, `perf`, `revert`, `chore`, `docs`, `refactor`, `test`, `ci`, `build`. Add `!` for a breaking change.
3. **Android background sync.** One `specialUse` foreground service with a permanent notification runs the sync engine. Short `dataSync` bursts are the fallback if the Play review refuses the service.
4. **Default values.**
   | Item | Value |
   |---|---|
   | MCP port | 7433 (fallback range up to 7442) |
   | Reminder for "Assign task" | after 24 h |
   | Test-slot lease | 30 min, renewed by the holder |
   | "Approve command" | waits 120 s, then denies; a late "Allow" approves that request id once |
5. **Decision texts edited after the verification** are confirmed: the conflict-copy naming, `maxConflicts` of 10 or more, and the Undo history outside the AW folder.
6. **The answers in `2026-11-22-task-model.md` §5** are final. The marker "Proposed, to confirm" no longer applies to them.
7. **Removed on 2026-11-23:** the default "queued tasks move to the next device after an offline time". AW never moves a task by itself (`2026-11-23-manual-move.md`).
