## 1. Interfaces and schemas

- [x] 1.1 Add the optional `SessionHost` members `readsScreen`, `worktree()`, `find()`, `submit()` and `PaneRef.instance` in `shared/plugin-api`
- [x] 1.2 Add `use_orca` and the checkout `session_host` to `bindings.v1`, and the optional `session_host` to `task.created` and `task.assigned`, with schema tests
- [x] 1.3 Run `pnpm schema:generate` and keep the generated files

## 2. The Orca host plugin

- [x] 2.1 Write the Orca CLI adapter (`orca-cli.ts`): exec-form calls with `execa`, JSON reply parsing, `OrcaError` with the code, the message and the request id
- [x] 2.2 Write `orcaCandidates()` and `detect()` (path order, version, `status --json`, minimum 1.4.257)
- [x] 2.3 Write `worktree()` (reuse, `repo add`, `worktree create`, close the first terminal), `open()` (the `exec env` command), `find()`, `alive()`, `list()`, `capture()`
- [x] 2.4 Write `submit()` with the retry request id, and `paste()`/`keys()` that throw
- [x] 2.5 Write `stop()` and `close()` with the copied process table helpers, and `removeWorktree()`/`forgetRepo()`
- [x] 2.6 Save the captured replies as fixtures (paths, host names and ids removed, with the source and the date)
- [x] 2.7 Write the fake Orca CLI (`src/testing/fake-orca.ts`, `testing/bin/orca`) on a private tmux server
- [x] 2.8 Write the unit tests of the host against the fake CLI and the fixtures

## 3. awd wiring

- [x] 3.1 Add the setting `AW_ORCA` (`settings.sessions.orca`)
- [x] 3.2 Make the Orca host in `daemon/src/sessions/plugins.ts`, and give `SessionTools` the hosts by name
- [x] 3.3 Add `record.host`; pick the host of a new session (task, checkout, `use_orca`), with the fallback comment and the 60 s detect cache
- [x] 3.4 Use the host of the record for open, find, stop, close, capture and delivery; the delivery rule for a host that does not read the screen; the terminal hint of comments; the host in `session.started`
- [x] 3.5 Add `session_host` to the create and assign bodies of the local API and the service, and `--host` to `aw task create|assign`; run `pnpm api:generate`
- [x] 3.6 Extend `startSessionDaemon` with an Orca mode (fake or real), and write `daemon/src/sessions/orca.e2e.test.ts`

## 4. Docs and checks

- [x] 4.1 Update `docs/phase-1.md` 9.9 (steps, minimum version, restart result), `docs/tech-stack.md` 1.3, `docs/prd.md` AGT-19 and `AGENTS.md` status
- [x] 4.2 Run `task check`
- [x] 4.3 Run the e2e test against the real Orca on the Linux remote device (private runtime), with the Orca restart, and clean up
- [x] 4.4 Break each new test once and see it fail

## 5. Review fixes

- [x] 5.1 Run an Orca session only with a covered Claude Code version, else tmux and one comment
- [x] 5.2 Deliver to a host that does not read the screen only after the SessionStart of the current pane (`record.ready_pane`); one comment when no SessionStart comes in time
- [x] 5.3 Parse each Orca reply with a declared zod schema
- [x] 5.4 Keep the request id after `terminal_not_writable`; refuse a text over 100 KiB; inject the wall clock of the Orca host
- [x] 5.5 A host that does not answer: a 5 s limit for `terminal show`, one comment after 120 s and one when it answers again, 503 `not_ready` for a stop; close a handle of another incarnation with no signal
- [x] 5.6 Host choice: the newest event that names a host; tests for the task, the checkout and `use_orca`
- [x] 5.7 `SessionInfo.host` defaults to `tmux` in the client schema
- [x] 5.8 Add the exception row for the text in the argv of `terminal send` to `docs/engineering-rules.md` 12

## 6. Review fixes, round 2

- [x] 6.1 Keep the Orca host off until a maintainer approves the text in the argv (`AW_ORCA_ALLOW_TEXT_IN_ARGV=1` turns it on); reword the exception row
- [x] 6.2 Keep the branch and the folder of a task when it changes host (tmux in the folder that has the branch; Orca refuses a branch of another folder with `branch_in_use`); make the fake Orca reuse a free branch as the real one does
- [x] 6.3 A stop whose `terminal close` fails after the signals still stops the session
- [x] 6.4 Read the Orca version at the start of the first line; a 15 s limit for `terminal send`
- [x] 6.5 Clear the fallback notice when Orca is chosen; count the "does not answer" comment only after the write; name terminals by their worktree folder, not the title

## 7. Review fixes, round 3

- [x] 7.1 Start no new session of a task while a running session of that task did not stop (Orca does not answer); one comment "The new session waits"
- [x] 7.2 A stop maps only a host that does not answer to "does not answer"; a failure of the signals keeps its cause
- [x] 7.3 Refuse a reused Orca worktree on another branch (`branch_changed`); close the first terminal of a new worktree at the next start when its close failed
