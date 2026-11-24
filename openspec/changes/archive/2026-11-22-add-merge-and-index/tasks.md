## 1. Setup

- [x] 1.1 Add `sift` 17.1.4 to `@aw/core` and check the license, the types and the release date
- [x] 1.2 Create `packages/core/src/merge/` and `packages/core/src/index/` and export them from `@aw/core`

## 2. Merge core

- [x] 2.1 Event order (HLC, device, id) and device priority (role, `device_order`, slug)
- [x] 2.2 Source reader: find the log files and documents, read logs incrementally (offset, partial tail, truncation and replacement checks), drop duplicate ids
- [x] 2.3 HLC bound: hold far-future events, report `future_hlc`, release them when the local clock comes near
- [x] 2.4 Owner history in the fold: creating device and accepted claims; parents fold before subtasks
- [x] 2.5 Task fold: state events of the owner, gates and answers, comments, edits, assignment rule, sessions, approach, ready, pause, archive, rekey
- [x] 2.6 Workspace fold: queue order, slot leases, credential names
- [x] 2.7 Task keys: duplicate state, `rekey_by`, `nextFreeKey`
- [x] 2.8 View assembly: workspace, projects, tasks with subtasks and open dependencies, devices, issues; `toTaskDocument`
- [x] 2.9 Presence layer: receive times, 90 s offline, `device_offline` tasks
- [x] 2.10 `MergeEngine` with incremental update and saved fold state; `mergeWorkspace()`; `lastHlc()`; `taskOwner()`

## 3. Index

- [x] 3.1 `WorkspaceIndex` on `node:sqlite`: tables, full write, incremental write, `indexPath()`
- [x] 3.2 Query translator (scalar, `$eq`, `$in`, `$and` to SQL) and `sift` on each row; sort and limit

## 4. Fixtures

- [x] 4.1 Merge cases in `packages/schema/fixtures/merge/` with `case.json` and `files/`, and helpers in `@aw/schema/testing`
- [x] 4.2 Script `packages/core/scripts/merge-expected.ts`; write and read each `expected.json`

## 5. Tests

- [x] 5.1 Fixture cases equal `expected.json`; seeded permutations of the read order
- [x] 5.2 Unit tests per rule: claims, gates, keys, assignment, edits, HLC bound, unknown type, slots, presence, snapshot
- [x] 5.3 Incremental equals full rebuild after seeded random appends; truncation and replacement
- [x] 5.4 Index queries equal plain filters; incremental index rows equal rebuilt rows
- [x] 5.5 Speed test with 10,000 events; record the time

## 6. Docs and checks

- [x] 6.1 Update `docs/phase-1.md` 3.5, 3.6 and 9.6, `docs/architecture.md` 4.2.4 and `packages/schema/fixtures/README.md` (`docs/tech-stack.md` already names `sift` 17.1)
- [x] 6.2 `task check` passes; break each new test once
