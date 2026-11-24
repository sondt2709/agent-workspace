## 1. Shared plan

- [x] 1.1 Add `rekeyPlan` to `shared/core/src/merge/keys.ts` and export it from `@aw/core`, with unit tests
- [x] 1.2 Add `contracts/fixtures/merge/task-key-collision/rekeys.json` and a TypeScript test that compares the plan of each device with it; update `contracts/fixtures/README.md`
- [x] 1.3 Add `rekeyPlan` to `android/shared` `Rules.kt` and a JVM test that reads `rekeys.json`

## 2. awd writer

- [x] 2.1 Add `#rekeyDuplicates` to `WorkspaceService` after the merge in `#refreshNow`, with the nested-rekey flag and the log check
- [x] 2.2 Add `daemon/src/service/rekey.test.ts`: the rekeying device, the other device, restart, a duplicate at the open, 2 own duplicates
- [x] 2.3 Show `task.rekeyed` as "<from> is now <to>" in `aw thread` (`daemon/src/cli/format.ts`), with a test

## 3. Phone writer and thread texts

- [x] 3.1 Add `PhoneActions.rekeyDuplicates()` with a JVM test (1 event, then none)
- [x] 3.2 Call it from the workspace graph of `android/app` after each snapshot change
- [x] 3.3 Change the phone thread text (`Thread.kt`) and the desktop thread text (`Thread.tsx`) to "<from> is now <to>", with tests

## 4. End-to-end and evidence

- [x] 4.1 Let `AW_E2E_PROJECT` and `AW_E2E_IMAGE_TAG` select the compose project and the image tag
- [x] 4.2 Add `e2e/src/task-keys.docker.test.ts` (2 devices offline, same key, sync, 1 rekey, restart)
- [x] 4.3 Run the e2e test on the base code (fails) and on the final commit (passes); keep the logs in the evidence folder
- [x] 4.4 Break each new test once and keep the failing output
- [x] 4.5 Run `task check` in each changed folder and the leak check
