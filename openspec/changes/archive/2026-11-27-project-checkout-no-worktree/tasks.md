## 1. Failing tests on the base branch

- [x] 1.1 Add the e2e test "refuses a worktree for a checkout with no commit" (tmux, fake agent) in `daemon/src/sessions/sessions.e2e.test.ts`: one comment with "has no commit yet", no host call; then a first commit starts the session. Run it on `b5c537a` and keep the failure output.
- [x] 1.2 Add the same check with the fake Orca in `daemon/src/sessions/orca.e2e.test.ts`: no `worktree create` call. Keep the failure output.

## 2. Schema

- [x] 2.1 Add `switch_branch` (default `true`) to `sessionOptions` in `shared/schema/src/common.ts`, and a schema test for an old event.
- [x] 2.2 Add the optional `checkouts: [{project, has_commit}]` to `healthV1` in `shared/schema/src/documents.ts`, with a schema test.
- [x] 2.3 Run `pnpm schema:generate` and commit the generated schemas, samples and Kotlin classes.

## 3. Daemon

- [x] 3.1 Add the commit check to `#worktree` in `daemon/src/sessions/manager.ts`, before `#prepare` and the host call.
- [x] 3.2 Write `checkouts` with `has_commit` in `health.yaml` (`daemon/src/continuity/health.ts`, `#writeHealth`), with a unit test.
- [x] 3.3 Add `has_commit` to each checkout of the session-hosts route (`daemon/src/service/session-hosts.ts`) from the health of each device, and update `contracts/openapi.yaml` with `pnpm api:generate`.
- [x] 3.4 Apply `switch_branch: false` for `work_in: checkout` in `#folder`: the checkout with no branch and no `git switch`. Add an e2e test that the checkout keeps its branch.
- [x] 3.5 Let `#plainHost` use the host choice for `work_in: checkout`, so a checkout session runs in Orca. Add an e2e test with the fake Orca.

## 4. Orca host

- [x] 4.1 Make the fake Orca CLI answer `selector_not_found` for an unknown path (the capture of 2026-10-28) and open a terminal in the main folder of a known repo.
- [x] 4.2 In `open()` of `plugins/host-orca/src/orca.ts`, run `repo add --path <cwd>` once on `selector_not_found`, then `terminal create` again. Add unit tests for both answers of `repo add`.
- [x] 4.3 Fix the terminal note of the local API for an Orca session in the checkout: name the folder, not `aw-<task>`.

## 5. Desktop

- [x] 5.1 `session-options-model.ts`: `switchBranch` in the form and the events, `teams: true` in the New task and New session forms, labels with no "experimental".
- [x] 5.2 `SessionOptions.tsx`: the switch "Switch to the task branch" under "Project checkout", and the disabled "Separate worktree" with the hint when `has_commit` is false.
- [x] 5.3 `dialogs.tsx`: "Start the agent now" on by default, and the worktree rule in New task, New session and Assign. Update the tests of `dialogs.test.tsx`, `CreateFlows.test.tsx` and `TaskDetail.test.tsx`.

## 6. Android

- [x] 6.1 `SessionOptionsForm.kt`: `switchBranch`, `agentTeams = true` in the new forms, labels with no "experimental", and the worktree rule from the health of the device. Update the JVM tests.
- [x] 6.2 `SessionOptionsParts.kt` and `FormScreens.kt`: the switch, the disabled worktree chip with the hint, and "Start the agent now" on by default.

## 7. Checks and evidence

- [x] 7.1 Break the commit check once, see the test of 1.1 fail, then restore it.
- [x] 7.2 Run `task check` on the last commit and keep the output with the SHA.
- [x] 7.3 Take screenshots of New task on `local-desktop-seed` with a checkout with no commit, before and after.
- [x] 7.4 Update `README.md` "Status" and `docs/` text that says Project checkout always runs in tmux or always switches the branch.
