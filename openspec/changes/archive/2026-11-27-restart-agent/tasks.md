## 1. Failing test first

- [x] 1.1 Add the e2e test "starts again at once after a person assignment, and comments each failure" in `daemon/src/sessions/sessions.e2e.test.ts` (a checkout with no commit, then `aw task assign` to the same agent). Run it on `7ebcbd5` and keep the failure output.

## 2. Schema and merge

- [x] 2.1 Add the optional `kind: "start_failed"` to `comment.added` in `shared/schema/src/events.ts`, with samples. Run `pnpm schema:generate`.
- [x] 2.2 Add `start_failure` to the task view and the fold (`shared/core/src/merge/view.ts`, `task.ts`), with unit tests.
- [x] 2.3 Add `"start_failure": null` to each task of each `contracts/fixtures/merge/*/expected.json`, and the events of a failed start, a restart and a claim to one case with its values.
- [x] 2.4 Port the field to the Kotlin fold (`android/shared/.../merge/TaskFold.kt`, `View.kt`) and pass the shared merge cases.

## 3. Daemon

- [x] 3.1 Write the start failure comment with `kind: "start_failed"` in `#startFailed`.
- [x] 3.2 In `#claims`, drop the start retry wait and the "same cause" memory when a newer person `task.assigned` exists.

## 4. Desktop

- [x] 4.1 Show "Did not start on <device>: <cause>" or "Starting again on <device>…" in the task header in place of the queue chip, from `start_failure`.
- [x] 4.2 Add "Restart agent" (no running session, an assignee): it calls the assign route with the same assignee and no options. Add tests.

## 5. Android

- [x] 5.1 Add the same state text and "Restart agent" to the task screen and its logic in `android/control/`, with JVM tests.

## 6. Checks and evidence

- [x] 6.1 Break the new daemon rule once, see the test of 1.1 fail, then restore it.
- [x] 6.2 Run `task check` on the last commit and keep the output with the SHA.
- [x] 6.3 Take screenshots of the task page on `local-desktop-seed`, before and after a click on "Restart agent".
- [x] 6.4 Update `docs/` where the start retry and the task page are described.
