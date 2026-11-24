## Context

The data-model task made the schemas, the HLC and the `files` layer (`packages/schema`, `packages/core/src/files`). Each device appends to its own log files. No code turns these files into the board, the owner of a task or the open gates yet. awd (awd-api-cli), the task loop, continuity, the desktop app and the Kotlin port (android-shared) all need one merge that gives the same result on each device. The rules are in `docs/architecture.md` 4.3, `docs/decisions/2026-11-22-device-sync.md`, `docs/decisions/2026-11-22-task-model.md` §5, `docs/workflow.md` 3 and 4, and `docs/phase-1.md` 3.3 to 4 and 9.6.

## Goals / Non-Goals

**Goals:**
- A pure merge: the same files and the same local time give the same view, in any file read order.
- The ownership rules, claims with epochs, gate resolution, task keys and assignment rules.
- A bound for remote HLC values, so one bad line cannot move the clock of each reader far forward.
- An incremental update that gives the same view as a full rebuild.
- A SQLite index with MongoDB-style queries.
- Fixture cases with an expected JSON view for the Kotlin port.

**Non-Goals:**
- The awd service, the API, file watching and the log buffer (awd-api-cli).
- Writing events: the merge only reads. It tells which device must write `task.rekeyed`.
- Conflict copies of logs and snapshots (sync-syncthing). The reader removes duplicate event ids only.
- The knowledge logs and history (knowledge), signature checks of device records (identity-pairing).
- The thread view. The index keeps each task event, so a later task can page the thread from it.

## Decisions

1. **Modules.** `packages/core/src/merge/`: `order.ts` (event order), `priority.ts` (device priority), `source.ts` (file discovery and the incremental log reader), `task.ts` (the task fold), `workspace.ts` (workspace log fold), `keys.ts` (task keys), `presence.ts`, `view.ts` (types and assembly), `engine.ts` (`MergeEngine`, `mergeWorkspace()`). `packages/core/src/index/`: `sqlite.ts` (`WorkspaceIndex`) and `query.ts` (MongoDB query to SQL, then `sift`). The merge reads files with `node:fs` and parses them with `parseLogText` and `parseDocumentText` of the `files` layer, with the log scope of `classifyPath`. Reading needs no write guard.

2. **Order.** Events sort by HLC text, then device slug (`compareEventOrder`), then event id. The id breaks a tie that only a broken device can make (2 events with the same HLC). A second event with the same id is dropped and reported (`duplicate_event`), so a conflict copy that a later task reads cannot count twice. The order never depends on the file read order or the line order.

3. **Fold per task, with an owner history.** The fold of a task runs over its events in merge order and keeps an owner history: the device of the first `task.created`, then the device of each accepted `task.claimed`. A claim is accepted when `data.device` is its `dev` and its epoch is above each earlier accepted epoch; else it is `stale_claim`. 2 claims with the same epoch: the first in merge order wins on each device. So "only the state events of the owner at that point count" is the current owner of the fold. The assignment rule reads the owner of the parent at a point of the order from the history of the parent, so the engine folds parents before their subtasks, and folds the subtasks again when a parent changed.

4. **Event classes.** State events count only from the owner at that point: `task.stage_changed`, `task.paused`, `task.resumed`, `task.ready`, `task.progress`, `task.done`, `task.learned`, `task.released`, `gate.opened`, `gate.resolved`, `approach.proposed`, `result.posted`, `handoff.written`, `session.*`, `message.human`, `message.agent`. Events of any device: `gate.answered`, `comment.added`, `message.sent`, `artifact.added`, `task.edited`, `task.moved`, `task.archived` (a human action). With rules: `task.assigned` (decision 6), `task.rekeyed` (only the creating device), `task.created` (the first one in order; a second one is `duplicate_created`). A rejected event stays in the index with its reason and is an issue (`ignored`). With no `task.created`, no device owns the task, and only claims, comments, answers and edits apply.

5. **Gates.** `gate.opened` adds or replaces gate `G` with its version; the answers of an older version become comments. `gate.answered` for an open gate and its version is `pending`; for an older version, a resolved gate or an unknown gate it becomes a comment (`late_answer`). The owner's `gate.resolved` closes the gate. The answer that `answer_event` names is `used`, and each other pending answer becomes a comment. So the first answer that the session device received wins, also when another answer has an earlier HLC. The gate `continue_on_device` has no running session device (`workflow.md` 3.3): any device opens it, the first pending answer in merge order resolves it, and a `gate.resolved` of any device closes it.

6. **Assignment.** The assignee of `task.created` and each `task.assigned` count when `by` is a human (`human@<device>`). An agent or `aw` assignment counts only when the project switch `assign_new_subtasks_to_default_device` is on, the task has a parent, and the event device owns the parent at that point. Else it is `assignment_not_allowed`. The newest accepted assignment wins. A task with no assignee, not done and not archived, gets the "Needs you" reason `assign`. Alternative: accept any assignee in `task.created`. Rejected: an agent could then assign its own subtasks, and the docs say AW never assigns a task alone.

7. **Edits.** `task.edited` sets `title`, `first_message` or `priority`; the newest edit wins per field. A `first_message` edit after the first accepted `session.started` is `first_message_locked`.

8. **Task keys.** The key of a task is the `to` of its last accepted `task.rekeyed` (from the creating device, with `from` equal to the current key), else the key of `task.created`. Tasks with the same key: the task of the creating device with the highest priority keeps it; a tie (the same device) goes to the earlier `task.created` in merge order. Each other task gets `key_state: "duplicate"` and `rekey_by: <creating device>` until it is rekeyed. `nextFreeKey(view, prefix)` gives the next number above each number that the view knows. The merge never writes the rekey: awd of the creating device does.

9. **Device priority.** local, then remote, then mobile (`device.yaml` `role`), then the position in `workspace.yaml` `device_order`, then the slug. A device with no record is last. The same function serves task keys and later the conflict resolver.

10. **HLC bound.** An event whose HLC time is more than `maxSkewMs` (default 24 h) after the local clock is held: it is not merged, not in the last-HLC value, and is an issue (`future_hlc`). Each update checks the held events again, and an event joins the merge when the local clock comes within the bound. Alternative: clamp the HLC. Rejected: a clamp depends on the receive time of each device, so the order would differ between devices. `lastHlc()` gives the highest merged HLC, for `HybridLogicalClock.observe()` and the `lastHlc` option of `openWorkspace()`.

11. **Presence is a separate layer.** The device view has the last heartbeat HLC, the boot time and the count. Presence adds `received_at` and `online`. The rule of `phase-1.md` 9.6.3 uses the receive time of this device. On the first read of a heartbeat source (a new engine or a rebuild), `received_at` is the minimum of the local time and the HLC time. On a later read, it is the local time of the read. A device is offline after 90 s with no new heartbeat. Presence also lists the tasks whose owner is offline and that are not done, archived or paused (`device_offline`), with "needs the human" after 10 min. Presence depends on local receive times, so the comparison of the incremental and the full path covers the view without the presence layer. Alternative: the heartbeat HLC time only. Rejected: a device clock that is 2 min late would always show offline.

12. **Incremental update.** Each log source keeps its byte offset, its line count, and 2 checks: the first 256 bytes and the last 256 bytes before the offset. An update stats the file. A file that is shorter than the offset, or whose check bytes changed, is read again from 0 (`truncated` or `replaced` issue, and a full refold). Else the reader reads only the bytes after the offset and keeps a part with no newline for the next update. Syncthing replaces a file with a rename at each change, so the inode is no check. A task with new events is folded again; when each new event sorts after its last folded event and its context (the documents and the parent owner) did not change, the fold continues from its saved state. A changed document folds each task again. The keys and the views are assembled from the task results each time (linear in the count of tasks).

13. **Task snapshot.** The merge reads the logs only. `toTaskDocument(task)` gives the `task.yaml` value of a task, with `includes` (the lines of each device up to the first held event). The test checks it against the fixture `task.yaml`. Using a snapshot as a start point is a later speed-up.

14. **Index tables.** One SQLite file per workspace (`indexPath(stateDir, workspaceId)` = `<stateDir>/index/<workspace id>.sqlite`), never synced. Tables: `meta`, `files` (path, lines, errors), `documents` (collection, id, path, JSON), `events` (id, task, HLC, device, type, applied, reason, JSON; no heartbeats), `tasks` (id, key, project, stage, assignee, owner, parent, archived, key state, "Needs you" lane, JSON), `projects`, `devices`, `queues`, `slots`, `credentials`, `issues` and `presence`. A full write replaces each table in one transaction. An incremental write replaces the rows of the changed tasks and their events, and the small tables. WAL mode, `synchronous=NORMAL`.

15. **Queries.** `index.find(collection, query, {sort, limit})` with the MongoDB syntax. The translator moves only exact conditions on indexed columns to SQL: a scalar, `$eq` and `$in` of scalars, in a top-level `$and`. Then `sift` checks each row against the full query, so the SQL part is only a filter for speed and never changes the result. `sort` and `limit` run in SQL when the full query went to SQL and the sort fields are columns; else after `sift`. Library: `sift` 17.1.4 (MIT, typed, `docs/tech-stack.md` 1.1).

16. **Fixtures.** `packages/schema/fixtures/merge/<case>/` has `case.json` (description, local time `now`, optional `max_skew_ms`), `files/` (files added to or replacing files of `fixtures/workspace/`) and `expected.json` (the full view at `now`, with presence and issues, JSON with sorted keys). Cases: `base`, `gate-answered-twice`, `task-key-collision`, `claim-epochs`, `device-offline`, `far-future-hlc`, `truncated-log-line`. `@aw/schema/testing` gets `mergeCases()` and `materializeMergeCase()`. `packages/core/scripts/merge-expected.ts` writes the expected files; a person reads each diff before a commit, and a unit test per case checks the main rule by hand.

17. **Property tests with an own seeded generator.** The tests need only seeded shuffles and random append points. A 10-line `mulberry32` generator does this and keeps the test reproducible from one seed. Alternative: `fast-check`. Rejected for now: a new library row for a job of 10 lines; shrinking is not needed for these inputs.

## Risks / Trade-offs

- [The fold of a large task runs again after an out-of-order event] → Only that task folds again; 10,000 events merge and index in less than 2 s (test plan 4).
- [A held far-future event hides a real event of a device with a wrong clock] → The issue names the device and the event, so the Inbox can show "Sync problem"; the event joins when the time comes.
- [The presence layer differs between an incremental reader and a rebuild for up to one heartbeat interval] → A rebuild uses the HLC time, bounded by the local time; the next heartbeat sets the receive time.
- [`node:sqlite` prints an ExperimentalWarning on Node 24] → The API is stable in use; the warning does not stop awd. awd can filter the warning later.
- [A document that fails its schema] → The engine keeps the last valid value, also through `rebuild()`. At start, awd gives `WorkspaceIndex.documents()` to the engine (`lastValid`), so the value also stays after a restart (rule 7.3.5). Only a device that never read a valid version has none; it shows the same `bad_document` issue. (Changed after the review.)

## Review fixes

- A failed index write sets the index back to "fresh", so the next write replaces each table (`#written` can hold rows that the rollback removed).
- The last merged HLC comes from the winners of duplicate ids only, after the read. A task line that replaces a workspace line with the same id makes the workspace log fold again. The random rounds now put the id of an earlier event on another event in another file.
- Only a change of a project document folds all tasks again, and only a change of a bindings document folds the workspace log again.
- The failover of a queued task is a claim only: an automatic `task.assigned` stays refused (task-model §5.1). `docs/workflow.md` 5 now says so, as `phase-1.md` 9.6.3 did.
- The wake-up message of a former owner is a `comment.added` (architecture.md 4.3.4.3, phase-1.md 9.6.5, task-model §5.5), because a `message.*` event counts only from the owner.
- `Object.hasOwn` for the column checks of `find()`.

Review round 2:

- An update is all or nothing. When a read fails (for example `EIO`), the engine forgets each read event and document text, and the next update reads all files again. Alternative: undo the offsets of the sources. Rejected: the documents, the held lines and the duplicates also change during a read, and a full read is always correct.
- `update()` and `rebuild()` run one at a time on a stored promise, so 2 overlapping calls never read the same bytes. The same line read twice is no duplicate (a second guard).
- An open gate of a done or archived task stays in `needs_you` and `gates`, but it is no "Needs you" reason.
- Heartbeat lines go through the duplicate-id rule: the line with the smaller place wins, and the count and the last heartbeat use only the winners.
- `rebuild()` forgets the presence receipts, as `phase-1.md` 9.6.3 and decision 11 say.
- `view.slots` keeps a lease until `slot.released` or `slot.revoked`. The view does not read the clock, so each reader checks `expires_at` (spec "Projections").
- `find()` refuses a `limit` that is not an integer of 0 or more.
- The approach rule (`gate.resolved` answer that starts with "confirm") is in the spec, so that the Kotlin port copies it.
- `docs/workflow.md` 4.2.1: a daemon claims only a task with no accepted claim, or with a newer human assignment, so a woken laptop does not take back a task after a failover. The device that runs the task is the claim device. `docs/prd.md` CNT-27 and `docs/feasibility-details.md` name the wake-up comment.

## Migration Plan

No data exists yet. The index rebuilds from the files at any time, so a later change of a table only needs a version number in `meta` and a rebuild.

## Open Questions

None for this change. Later tasks: conflict copies of logs (sync-syncthing), revoked devices (identity-pairing), the thread view and the snapshot speed-up (awd-api-cli).
