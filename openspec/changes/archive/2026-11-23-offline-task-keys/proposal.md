## Why

Two devices that are offline from each other can create tasks with the same key, for example AW-7. The merge marks the second task as `duplicate` and names the device that must write `task.rekeyed` (`rekey_by`), but no device writes it (gap M14, `docs/prd.md` TSK-16). So the key stays duplicate forever, and `aw task show AW-7` fails with `ambiguous`.

## What Changes

- Add the shared rule `rekeyPlan`: the list of `{task, from, to}` that one device must rekey, with `to` keys from the next free number up. TypeScript (`shared/core`) and Kotlin (`android/shared`) give the same plan.
- awd writes `task.rekeyed` (by `aw@<device>`) after each merge for each item of the plan of its device. It writes one event per duplicate, also after a restart and when both devices merge at the same time.
- The phone writes `task.rekeyed` for its own duplicate tasks after each index refresh.
- The thread shows "AW-7 is now AW-9" for `task.rekeyed` on the desktop, on the phone and in `aw thread` (`docs/architecture.md` 4.3.3 item 3).
- Add the contract fixture `contracts/fixtures/merge/task-key-collision/rekeys.json` with the plan of each device.
- The e2e harness reads `AW_E2E_PROJECT` (compose project name) and `AW_E2E_IMAGE_TAG` (image tag), so parallel runs do not collide.

## Capabilities

### New Capabilities
- `task-key-rekey`: the device of a duplicate task key writes `task.rekeyed` with the next free key, once, and each thread shows the old and the new key.

### Modified Capabilities
(none)

## Impact

- Code: `shared/core/src/merge/keys.ts`, `daemon/src/service/workspace.ts`, `daemon/src/cli/format.ts`, `desktop/src/renderer/src/components/Thread.tsx`, `android/shared` `Rules.kt`, `android/control` `PhoneActions.kt` and `Thread.kt`, `android/app` `AppGraph.kt`.
- Contracts: a new fixture file `rekeys.json`. No schema, event or API change.
- Tests: unit tests in each package, and the Docker e2e test `e2e/src/task-keys.docker.test.ts`.
