# Shared fixtures

`workspace/` is a full AW folder (`docs/phase-1.md` 3.1) for the tests of all tasks. The Kotlin tests (android-shared) read the same files.

| Item | Value |
|---|---|
| Devices | `macbook-pro` (local), `ubuntu-01` (remote), `pixel-9` (mobile) |
| Project | `billing-api` |
| Task | `AW-7`, id `01a2038e-7f00-70eb-b429-fa86d481c263`, owner device `ubuntu-01` (claim epoch 1), stage `implement` |
| Task logs | 1 log per device: create (`macbook-pro`), assign and answer (`pixel-9`), the session events (`ubuntu-01`) |
| Other files | workspace logs (credential names, queue, test slot), heartbeats, health, bindings, knowledge files and change logs, `secure/test-servers.yaml` |

Rules:
1. The data is synthetic. The keys, the signatures and the sync device ids are placeholders, not real keys.
2. Each YAML document and each log line must be valid against its zod schema and its generated JSON Schema (`shared/schema/src/schemas.test.ts`).
3. `shared/core/src/files/workspace.test.ts` writes the folder through the files API and reads it back.
4. When you change the folder, keep each log in HLC order, and update `includes` in `task.yaml`.

TypeScript tests read the folder through `@aw/schema/testing` (`fixtureRoot`, `fixtureDocuments()`, `fixtureEvents()`).

The Kotlin tests (`android/shared/src/jvmTest`) read the folders directly: Gradle sets the system property `aw.schema.dir` to `contracts/`. They read `fixtures/workspace/`, `fixtures/merge/`, `test-vectors/hlc.json` and `samples/schema-samples.json` (the valid and invalid samples of `shared/schema/src/testing/samples.ts`, written by `pnpm schema:generate`).

## Merge cases

`merge/<case>/` holds one case of the merge (`shared/core/src/merge`). The Kotlin tests (android-shared) run the same cases.

| File | Content |
|---|---|
| `case.json` | `description`, `now` (the local time of the merge, ISO 8601), optional `max_skew_ms` |
| `files/` | Files that the case adds to `workspace/` or that replace a file of `workspace/` |
| `expected.json` | The expected `{view, presence}` at `now`, with sorted keys |
| `rekeys.json` | Only in `task-key-collision`: the expected rekey plan (`rekeyPlan`) of each device for the merged view, as `{prefix, plans: {<device>: [{task, from, to}]}}` |

| Case | What it shows |
|---|---|
| `base` | The fixture folder as it is. The `task.yaml` of AW-7 equals the snapshot of the merged task. |
| `gate-answered-twice` | 2 answers to one gate: the answer that the session device used wins, the other is a comment. An answer to an old version and a late answer are comments. |
| `task-key-collision` | 2 offline collisions: the higher-priority device keeps the key; a rekey of another device is ignored; an agent cannot set the assignee. |
| `claim-epochs` | A move by a human `task.assigned` with claim epochs: the state events of the old owner do not count, its comment merges, its later claim is `not_assignee_device`; a second claim with the same epoch is `stale_claim`. |
| `claim-not-assignee` | Claims only from the device of the assignee: no assignee, another device, an agent assignment, the old owner after a human move (wake comment), a gate of a former owner, and `moving_to` until the new claim. |
| `session-options` | Session options: a person sets them on `task.created` and `task.assigned` (the newest wins as a whole); `session.started` fills the session folder, branch and options; an agent assignment and an agent subtask do not set them; a stop request counts only from a person. |
| `device-offline` | ubuntu-01 stops its heartbeats: offline after 90 s, its running task shows `device_offline` and waits (no gate, no move). |
| `far-future-hlc` | A line 1 year ahead is held back and reported (`future_hlc`). |
| `truncated-log-line` | A cut line in the middle is a bad line; a last line with no newline is the partial tail. |
| `task-rules` | The task rules that the other cases do not use: newest edit per field, first message locked, rekey of another device or from a stale key, assignment with the project switch on and off, Confirm of an approach file from before the rename (also a number too large for a safe integer), end of an unknown session. |
| `workspace-rules` | The workspace log rules: lease from another device, stale fencing token, no such slot, no such lease, newest queue order, credential names added, imported and removed. |

Rules:
1. The `files/` of `truncated-log-line` contain bad lines on purpose. `.pre-commit-config.yaml` excludes them from `end-of-file-fixer`.
2. After a change of a case or of a merge rule, run `node shared/core/scripts/merge-expected.ts`. Then read each diff of `expected.json` before a commit.
3. TypeScript tests read the cases through `@aw/schema/testing` (`mergeCases()`, `materializeMergeCase()`, `expectedPath()`).
4. The Kotlin tests merge each case with `MergeEngine` of `android/shared` and compare the parsed JSON of `{view, presence}` with `expected.json` (numbers by value). Run them with `task android:check`. A change of a merge rule changes both engines in the same pull request.
5. A new merge rule gets a case here (or a line in `task-rules` or `workspace-rules`), so both languages test it. A test in `rules.test.ts` only tests TypeScript.

## Activity rule

`activity/cases.json` holds the Activity rule of the task detail (`docs/design.md` 8.6): which event of a thread shows in the Activity tab of the desktop and of the phone.

| Key | Content |
|---|---|
| `places` | One entry for each event type of `samples/schema-samples.json`: `activity` or `session` |
| `cases` | Thread rows (`type`, `dev`, `by`, `data`) with the expected `in_activity` and `line` (the text of the Activity row, or null for the usual text) |
| `clamp_lines`, `clamp` | The cut of a long agent message in Activity |

Rules:
1. The desktop (`desktop/src/renderer/src/activity-model.test.ts`) and the phone (`android/control/src/jvmTest/.../ActivityRuleTest.kt`) compare their table and their rule with this file.
2. A new event type in the contract needs an entry in `places` and in both tables, in the same pull request.
