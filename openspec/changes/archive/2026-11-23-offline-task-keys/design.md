## Context

`docs/architecture.md` 4.3.3 and `docs/phase-1.md` 3.6.2 give the task key rules. Each device takes the next number that it knows. On a collision, the task of the higher-priority creating device keeps the key, and the creating device of the other task writes `task.rekeyed`. The merge already does its part on both engines: `markDuplicateKeys` sets `key_state: duplicate` and `rekey_by`, and the fold applies a `task.rekeyed` of the creating device from the current key (`shared/core/src/merge/task.ts`, `android/shared` `TaskFold.kt`). The fixture `task-key-collision` tests it. No device writes the event (gap M14).

Writers: awd writes the events of computers through `WorkspaceFiles.writeEvent` in `WorkspaceService`. The phone writes through `PhoneActions` and its `EventWriter`. The phone creates tasks with keys (`PhoneActions.createTask`), and it has the lowest priority, so its tasks are often the duplicates.

## Goals / Non-Goals

**Goals:**
- The device of `rekey_by` writes one `task.rekeyed` per duplicate, with a free key.
- No second event after an awd restart, after a second merge, or when both devices merge at the same time.
- Each thread shows "AW-7 is now AW-9".
- awd and the phone compute the same plan from the same view.

**Non-Goals:**
- A change of the merge rules or of the event schema.
- The work branch of a session that started before the rekey (it keeps `aw/<old key>`).
- Queue order and the other gaps of the audit.

## Decisions

1. **One shared plan function.** `rekeyPlan(tasks, prefix, device)` returns `{task, from, to}` for each task with `key_state: duplicate` and `rekey_by: device`, in the order of the `task.created` events (HLC, device, id). The first `to` is `nextFreeKey`, and each next one adds 1. Kotlin has the same function in `Rules.kt`. The fixture `task-key-collision/rekeys.json` gives the plan of each device of the case, and both test suites check it. Alternative: compute the key in each writer. Rejected: the 2 engines could then give different keys for 2 own duplicates.
2. **awd writes after each merge.** `WorkspaceService.#refreshNow` merges, then runs `#rekeyDuplicates`. It writes the events of the plan (by `aw@<device>`) and merges again. A flag stops a nested rekey during that second merge. A write error goes to the log as a warning; the merge result stays. Alternative: a timer in the work loop. Rejected: the merge is the only point where the duplicate state changes, and the write queue already orders writes and merges.
3. **Durable idempotence on awd.** Before a write, awd reads the event rows of the task. When a `task.rekeyed` of this device from the current key is there (applied or not), awd writes nothing. After a restart, the event is on disk, so the merge applies it and no duplicate is left. Alternative: a memory set. Rejected: it does not hold after a restart with a rejected event.
4. **Both devices merge at the same time.** Only the device of `rekey_by` writes. `rekey_by` comes from the device priority (roles of `device.yaml`, then `device_order`, then the slug), which is the same on each device that has the same files. When the views are briefly different, 2 rekeys can happen; the next merge then finds a new collision and resolves it the same way, so the keys stay distinct.
5. **Phone writes after each refresh.** `PhoneActions.rekeyDuplicates()` writes the plan of the phone under the action lock and calls `afterWrite` (targeted scan, index refresh, model reload). It keeps a memory set of `(task, from)` for this process. After a restart, the index has the merged event, so no duplicate is left. The app collects the snapshot of each workspace graph and calls it.
6. **Thread text from the event.** The thread line of `task.rekeyed` is "AW-7 is now AW-9" on the desktop, the phone and in `aw thread`. No extra `comment.added`: the event is already in each thread.
7. **e2e isolation.** `e2e/src/compose.ts` reads `AW_E2E_PROJECT` for the compose project name, and `e2e/compose.yaml` reads `AW_E2E_IMAGE_TAG` for the image tag. The defaults stay `aw-sync-e2e` and `local`.

## Risks / Trade-offs

- [A device with a different view rekeys too] → The next merge resolves the new collision; the keys converge to distinct values with one more event.
- [The phone is closed for a long time] → Its duplicate task shows `duplicate` on each device until the phone app runs again. The CLI marks it with `*`.
- [A session started before the rekey keeps the branch `aw/<old key>`] → Open issue for the task move-paused-task (the D10 push of `aw/<key>`).
- [The phone writer runs only when the app has the workspace graph] → The graph exists while the app or its engine service runs.

## Migration Plan

No migration. Old duplicates get their rekey at the first merge after the update.

## Open Questions

None.
