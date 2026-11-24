## Why

A task that waits for a session of its agent shows only "Backlog": the person does not see its position, its agent or the cause that blocks it (gaps M16, M16b, M16c; `prd.md` TSK-06, TSK-15, SYN-09). An agent subtask with no assignee gives a push on the phone but no desktop notification (gap M20), and a task that a person parked with no assignee gets a 24 h "Assign task" reminder that the spec does not allow (fix list 0-5, review finding L3).

## What Changes

- One queue rule from the merged files: for each `agent@device`, the tasks that wait for a session, in queue order, with the position (1st, 2nd, ...) and one cause ("2 sessions working", "ubuntu-01 offline", "the login of the agent ended", "5-hour usage at 93 %", "disk 96 % full", "waits for AW-3", "starts soon"). awd and the phone use the same rule, checked by one contract fixture.
- `health.yaml` gets the optional object `queue: {max_working, disk_full_percent, login_valid}`, so other devices know the limits of the device.
- New person route `GET /v1/workspaces/{ws}/queues`: the queues of each agent and the tasks with no assignee (`created_by`, `by_agent`). Client call `DesktopClient.queues`. New CLI command `aw queue`.
- Desktop: the List group "Queued", and "Queued · 2nd for claude@ubuntu-01" with the cause on the list row, the board card and the task detail.
- Desktop notification "AW-5 · Assign task" for a task with no assignee that an agent created.
- Phone: "Queued · 2nd for claude@ubuntu-01" with the cause on task rows and a "Queue" field in the task detail. The phone reads the queue order (`queue.reordered`) and the health files from its own index.
- The "Assign task" 24 h reminder push goes only to a task that an agent created.
- Docs: `docs/phase-1.md` 9.6.11, 9.6.14 and 10.13.

## Capabilities

### New Capabilities
- `agent-queue-view`: the queue rule from the merged files (members, order, position, cause and its text), the health `queue` object, and the contract fixture.

### Modified Capabilities
- `local-api`: the person route `GET /v1/workspaces/{ws}/queues`.
- `aw-cli`: the command `aw queue`.
- `desktop-app`: the List group "Queued" and the queue text on rows, cards and the task detail.
- `desktop-background`: the "Assign task" notification for an agent-created task.
- `android-app`: the queue text on phone task rows and the task detail.
- `task-loop`: the "Assign task" reminder only for an agent-created task.
- `session-continuity`: the session manager writes the `queue` object into `health.yaml`.

## Impact

- Code: new `daemon/src/continuity/queue-view.ts`, `daemon/src/service/queues.ts`, `daemon/src/api/queue-routes.ts`, `daemon/src/cli/queue.ts`, `shared/client/src/queues.ts`, `desktop/src/renderer/src/queue-model.ts`, `android/control/.../Queues.kt`; changes in `daemon/src/continuity/health.ts`, `daemon/src/sessions/manager.ts`, `daemon/src/loop/rules.ts`, `shared/schema/src/documents.ts`, the desktop List, Board, task detail and notifications, the phone screens.
- Contracts: `contracts/openapi.yaml` (new route), `contracts/schemas/health.v1.schema.json` and the Kotlin `HealthV1` (new optional field), new `contracts/fixtures/queue/cases.json`.
- No new dependency, event type or environment variable. No change of the merged task view or the merge fixtures.
