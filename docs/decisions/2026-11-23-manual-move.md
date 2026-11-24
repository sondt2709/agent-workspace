# Decision: manual move, no automatic failover

| Item | Value |
|---|---|
| Date | 2026-11-23 |
| Status | Accepted by the product owner |
| Replaces | The failover of `2026-11-22-device-sync.md` (device roles item 3), the default "Queued tasks move to the next device after 10 min offline" of `2026-11-22-approved-defaults.md`, the gate "Continue on another device", the event `task.moved` and the failover by claim of the merge-index review |
| Related | `2026-11-22-task-model.md` §5.1 and §5.5, `../workflow.md` 4.2 and 5, `../architecture.md` 4.3.4 |

## Context
Product decision (2026-11-23): AW never changes the agent or the device of a task by itself; the person does it. When the person closes the laptop with no warning, the task waits. The button is `Sync` (or a similar name), not `Close laptop`.

## Decision
1. AW never changes the agent or the device of a task by itself.
2. When the device of a task sleeps or goes offline, the task shows "Paused: <device> offline" and waits. No gate "Continue on another device" opens by itself, and queued tasks do not move.
3. The human moves a task by hand: a human `task.assigned` to another `agent@device` ("Move to", or "Assign to another device…" on a paused task). Only then does that device claim the task and start a session, with the handoff from the last pushed step.
4. A claim counts only from the device of the current assignee. The merge ignores a claim from another device and reports it with the reason `not_assignee_device`.
5. When a laptop wakes after the human moved its task, AW pushes the unpushed work of the laptop as `aw/<key>-<device>-<time>` and writes a system comment (`comment.added`) with the branch name. AW never drops the work.
6. A laptop closed without a sync is the user's own mistake. The desktop button is "Sync" (the menu item is "Sync now"). It syncs and shows the result. There is no "Close laptop" flow and no move suggestion.
7. The default "queued tasks move to the next device after 10 min offline" is removed from `2026-11-22-approved-defaults.md`, and device roles item 3 of `2026-11-22-device-sync.md` points to this decision.

## Consequences
1. The file format has no `task.moved` event and no gate kind `continue_on_device`. A move is one human `task.assigned`. `TaskView.moving_to` is the device of the assignee while the accepted claim is on another device.
2. The merge view has no "needs the human after 10 min" flag for an offline device. The pause cause `device_offline` needs no human and sends no push.
3. A task of a laptop-only user waits while the laptop sleeps. "Sync" before a close, and an optional remote device, are the answers.
