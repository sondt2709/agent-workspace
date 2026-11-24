## Context

The session manager of each device starts the tasks of its agent in queue order (`daemon/src/continuity/queue.ts`: `queueOrder`, `isWorking`, `startBlock`). A task that waits has no event (`docs/phase-1.md` 9.6.11), so no screen shows its position or its cause. The desktop reads the merged view through awd; the phone reads its own Room index of the same files. The device limits (`AW_MAX_WORKING`, `AW_DISK_FULL_PERCENT`) and the sign-in state exist only in the memory of the device that runs the agent. `health.yaml` already has the usage windows, the login end and the disk use.

## Goals / Non-Goals

**Goals:**
- One rule gives the members, the order, the position and the cause of each agent queue, from the merged files only. awd (TypeScript) and the phone (Kotlin) give the same result.
- The desktop and the phone show "Queued · 2nd for claude@ubuntu-01" and the cause.
- A desktop notification for "Assign task" with the push rule of the gate table.
- The 24 h reminder only for an agent-created task.

**Non-Goals:**
- Queue reorder (N2), the groups "Waiting for sync" and "Waiting for test slot" (N29), the cost limit of automatic subtasks (fix list 0-4).
- A change of the merged task view or of the merge fixtures.

## Decisions

1. **The rule reads the files, not the live block of the session manager.** The desktop of another device and the phone see only files. The manager keeps its own `startBlock`; the new rule copies its checks and order. Alternative: the manager writes its block into a file. Rejected: the block changes at each start, and `health.yaml` is written at most once per 60 s.
2. **`health.yaml` gets `queue: {max_working, disk_full_percent, login_valid}`** (optional). The session manager writes it with its settings and the result of `claude auth status`. A reader with no `queue` object uses 2, 95 and "not known". The other fields of the cause come from the existing health fields: the newest `five_hour` window whose reset time is in the future, and `disk.used_percentage`.
3. **Members.** A task is queued when it was created, is not archived and not done, has an `agent@device` assignee, and has no claim on the device of the assignee (no claim, or a claim of another device after a move). A task with open dependencies is a member with no position.
4. **Order.** `queueOrder` (newest `queue.reordered` of the agent, then the creation order by HLC). The tasks with a position come first, then the tasks with open dependencies in the same order.
5. **Cause of the task at index `i` (from 0) among the tasks with a position**, in this order (the order of `startBlock`, with the presence first):
   1. the device is revoked: `device_revoked`, "ubuntu-01 was revoked";
   2. the presence of the device is offline: `device_offline`, "ubuntu-01 offline";
   3. `working + i >= max_working`: `max_working`, "N sessions working", with `N = max(working, min(working + i, max_working))` (the count of working sessions when the task is next; "1 session working" for 1);
   4. `login_valid` is false: `login_ended`, "login of claude ended";
   5. the 5-hour window is above 90 %: `usage_limit`, "5-hour usage at 93 %";
   6. the disk use is at the limit or above: `disk_full`, "disk 96 % full";
   7. else `starting`, "starts soon".
   A task with open dependencies: `dependencies`, "waits for AW-3, AW-4" (the key, else the first 8 characters of the id).
   `working` counts the tasks of the agent whose session runs on the device, with no open gate and no pause (`isWorking`).
6. **Texts.** The label is "Queued · 2nd for claude@ubuntu-01" (English ordinals: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st), and "Queued for claude@ubuntu-01" with no position. awd puts the label and the cause text into the route reply, so the desktop needs no copy of the rule.
7. **One contract fixture.** `contracts/fixtures/queue/cases.json` has cases with the rule input (task fields, orders, devices with presence and the raw health object, the time) and the expected queues. `daemon/src/continuity/queue-view.test.ts` and `android/control` `QueuesTest` run each case.
8. **Route.** `GET /v1/workspaces/{ws}/queues` is a person route (`config: { access: "person" }`): `{device, agents: [{agent, device, max_working, working, tasks: [{task, key, title, position, text, cause: {code, text}}]}], unassigned: [{task, key, title, created_by, by_agent}]}`. `unassigned` lists the active tasks with no assignee; `created_by` is the `by` of `task.created`, and `by_agent` is true when `by` is set and does not start with `human@` (the rule of the push loop). One service function `queuesView(ws)` serves the route; the CLI calls the route.
9. **CLI `aw queue`.** No document names a command. `aw task list` stays as it is. The CLI refuses `aw queue` in a session, as the other person commands.
10. **Desktop.** The renderer reads the queues with its own query (refetch every 10 s, because the presence changes with no file change). `listGroups` gets the queued ids: the group order is Needs you, Running, Paused, Queued, Backlog, Done. The chip text is the label; the cause shows next to it. The main process reads `unassigned` in its background load and shows "AW-5 · Assign task" only for `by_agent`. The code goes into new functions (`assignNotifications`, `queue-model.ts`), so the merge with revoke-device stays simple.
11. **Phone.** `WorkspaceModel` reads the applied `queue.reordered` events (`WorkspaceIndex.workspaceEvents`, the newest per agent wins) and each `health.yaml` from the index. `QueueRules` (Kotlin) is the port of decision 5. The row shows the label and the cause; the detail has the field "Queue". No Room schema change. The phone push "Assign task" already comes from awd.
12. **L3.** `duePushes` schedules no `assign` item for a task that a person created.

## Risks / Trade-offs

- [The health file is at most 60 s old] → the cause can lag (for example the usage text). The positions and the working count come from the task views and are current.
- [A reassignment to another agent on the same device after a claim] → the manager claims it again, but the rule does not list it as queued. It is rare, and the task shows its session state.
- [Generated files also change in revoke-device] → run `pnpm schema:generate` and `pnpm api:generate` again after the merge.
- [Macos notifications need the signed app] → the notification code is unit tested with a fake factory (README decision 3).
