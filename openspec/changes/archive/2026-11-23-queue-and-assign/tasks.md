## 1. Current behavior

- [x] 1.1 Run the journey on the base (awd in a terminal, 4 tasks, `AW_MAX_WORKING=2`): keep `journey.log` (no `aw queue`, 404 for the route)
- [x] 1.2 Take desktop screenshots of the List, the Board, the task detail and the Inbox on the base build
- [x] 1.3 Write the L3 unit test in `daemon/src/loop/units.test.ts` and run it on the base: keep the failing log

## 2. Queue rule and health

- [x] 2.1 Add the optional `queue` object to `healthV1` in `shared/schema/src/documents.ts`; run `pnpm schema:generate`
- [x] 2.2 Write `queue` in `daemon/src/continuity/health.ts` and pass the settings and the sign-in state from `daemon/src/sessions/manager.ts`; test
- [x] 2.3 Add `contracts/fixtures/queue/cases.json` (members, order, reorder, dependencies, moves, each cause, ordinals)
- [x] 2.4 Add `daemon/src/continuity/queue-view.ts` (`queueTask`, `agentQueues`, `queueLabel`, `ordinal`) and its test that runs the fixture

## 3. Route, client and CLI

- [x] 3.1 Add the reply schema and `DesktopClient.queues` in `shared/client`
- [x] 3.2 Add `daemon/src/service/queues.ts` (`queuesView`) and `daemon/src/api/queue-routes.ts` (person route); register it in `app.ts`; route tests (reply, 403 for a session)
- [x] 3.3 Add `aw queue` (`daemon/src/cli/queue.ts`), register it in `run.ts`, refuse it in a session; format test
- [x] 3.4 Run `pnpm api:generate`

## 4. L3 fix

- [x] 4.1 `duePushes`: no `assign` schedule for a task that a person created; the test of 1.3 passes

## 5. Desktop

- [x] 5.1 Add the bridge call `queues` (`channels.ts`, `contract.ts`, `calls.ts`) and the query `useQueues` (10 s refetch)
- [x] 5.2 Add `desktop/src/renderer/src/queue-model.ts`; `listGroups` gets the group Queued; tests
- [x] 5.3 Show the label and the cause on the List row, the Board card and the task detail; component test
- [x] 5.4 Add `assignNotifications` in `desktop/src/main/notifications.ts` and read `unassigned` in the background load of `index.ts`; tests

## 6. Phone

- [x] 6.1 Add `android/control/.../Queues.kt` (`QueueRules`) and `QueuesTest` that runs the fixture
- [x] 6.2 `WorkspaceSnapshot` gets the queue orders and the health documents; `WorkspaceModel` reads them; `TaskRowState` gets the queue label and cause; "Queue" field in `fields`; tests
- [x] 6.3 Show the label and the cause in the Compose task rows

## 7. Docs

- [x] 7.1 `docs/phase-1.md` 5.10 (person routes), 9.1.6 (CLI refusal), 9.6.11, 9.6.14, 10.13; `docs/architecture.md` 4.6.8

## 8. Checks and evidence

- [x] 8.1 Break each new test once and restore the code
- [x] 8.2 `task check` in shared, daemon, desktop; `task android:check`; `openspec validate --strict`; `task leakcheck`
- [x] 8.3 Journey on the final code (awd in a terminal): positions, causes, a session ends, the next task starts, an agent subtask in `unassigned`
- [x] 8.4 Desktop screenshots after
- [x] 8.5 Phone on an Android emulator on the Linux test server: queued rows and the "Assign task" push
