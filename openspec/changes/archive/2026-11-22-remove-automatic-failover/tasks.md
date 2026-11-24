## 1. Decision and docs

- [x] 1.1 Add `docs/decisions/2026-11-23-manual-move.md` (7 items of the handoff) and link it in `docs/README.md`
- [x] 1.2 Remove the default "queued tasks move after 10 min offline" from `2026-11-22-approved-defaults.md`, with a pointer to the new decision
- [x] 1.3 Change device roles item 3 of `2026-11-22-device-sync.md` and its "Sync now" item, with a pointer to the new decision
- [x] 1.4 Update `docs/workflow.md` (Paused text, gate table, gate rule 3, claim rule 4.2.1, continuity table, sync before sleep)
- [x] 1.5 Update `docs/architecture.md` (2.2, event table, 4.3.4, pause table, runtime view 5.2)
- [x] 1.6 Update `docs/phase-1.md` 9.6 and `docs/prd.md` (glossary, journey, AGT-06/07, ownership row, DEV-05, D10), and the old texts in `feasibility*.md`

## 2. Schema

- [x] 2.1 Remove `continue_on_device` from `gateKind` and `task.moved` from the events in `shared/schema/src`
- [x] 2.2 Update the schema samples and add tests for the 2 removals
- [x] 2.3 Run `pnpm schema:generate` (JSON Schemas, samples, Kotlin classes)

## 3. TypeScript merge

- [x] 3.1 `task.ts`: claim rule `not_assignee_device`; remove `NO_SESSION_GATE`; `moving_to` from the assignee
- [x] 3.2 `presence.ts`, `view.ts`: remove `needs_human` of offline tasks and `NEEDS_HUMAN_AFTER_MS`
- [x] 3.3 `random-events.ts`: no `continue_on_device`
- [x] 3.4 `rules.test.ts`, `cases.test.ts`: change the failover tests to the new rules; add tests for the claim rule and `moving_to`

## 4. Fixtures

- [x] 4.1 Change `claim-epochs` (`task.moved` → human `task.assigned`) and each case whose claims need a human assignment
- [x] 4.2 Add the case `claim-not-assignee` with `case.json` and its files
- [x] 4.3 Write each `expected.json` with `merge-expected.ts`, read the diffs, and update `contracts/fixtures/README.md`

## 5. Kotlin merge

- [x] 5.1 `TaskFold.kt`: the same claim rule, no `NO_SESSION_GATE`, `movingTo` from the assignee
- [x] 5.2 `Rules.kt`, `View.kt`: remove `needsHuman` of offline tasks and `NEEDS_HUMAN_AFTER_MS`
- [x] 5.3 `RandomEvents.kt` and the Kotlin tests: no `continue_on_device`; `MergeCasesTest` runs the new case

## 6. Specs and checks

- [x] 6.1 Update the main specs that state the old rules (through the archive)
- [x] 6.2 Run `task check` and the old-rule grep; break the new rule once in each language

## 7. Prototype (outside git)

- [x] 7.1 Rename "Close laptop" to "Sync" (sync, show the result, no sleep, no move suggestion)
- [x] 7.2 Remove the automatic move and the automatic "Continue on another device"; add "Assign to another device…" on a paused task
- [x] 7.3 Build the local prototype (outside git) and test in a new chrome-devtools page
