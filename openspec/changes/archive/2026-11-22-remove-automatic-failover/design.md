## Context

The merge-index task added a failover: after 10 min offline, the highest-priority online device claimed the queued tasks of the offline device, and any device could open and resolve the gate `continue_on_device`. Review round 1 of merge-index made the failover "claim only": the assignee stayed, and a claim of any device moved the task. The product owner rejected the automatic failover on 2026-11-23 (`<ph>/README.md` decision 0b). The rule must change in both merge ports (`shared/core` TypeScript and `android/shared` Kotlin), because `contracts/fixtures/merge/*/expected.json` is the contract for both.

Current state of the code:
- `TaskFold` accepts a `task.claimed` when `data.device == dev` and the epoch is above the accepted epoch. It does not read the assignee.
- `NO_SESSION_GATE = "continue_on_device"`: any device can open or resolve it, and the first answer in merge order resolves it.
- `task.moved {to}` sets `moving_to`; a claim clears it.
- `presenceOf()` gives `offline_tasks` with `needs_human` after 10 min (`NEEDS_HUMAN_AFTER_MS`).

## Goals / Non-Goals

**Goals:**
- A claim counts only from the device of the current assignee. A claim from another device is ignored and reported.
- No gate or field that exists only for an automatic move.
- The human moves a task with one action: a human `task.assigned` to `agent@<other device>`.
- Same rule, same fixtures, same `expected.json` in TypeScript and Kotlin.
- Docs, decisions, main specs and the prototype say the same.

**Non-Goals:**
- The awd claim loop, the session stop on a move, the wake branch push, the "Sync" button and the "Assign to another device…" action in the real apps. These are later tasks (task-loop, continuity, desktop-devices-kb, android-ui). This change gives their rules in the docs.
- An `event.v2` schema. No data exists before the first release.

## Decisions

1. **Claim rule: `dev` must be the device of the assignee at that point in merge order.** The fold reads its own `assignee` (the newest accepted assignment before the claim). The device is the text after `@` of `agent@device`. With no assignee, no claim counts. The check order is: `claim_device_mismatch`, then `not_assignee_device`, then `stale_claim`. Reason: the assignee is the human's choice (task-model §5.1); a claim is only the start of a session on that choice. Alternative: the device of the assignee at read time (the newest assignee). Rejected: the view would depend on later events in a way that an incremental fold cannot continue, and a valid claim before a reassignment would become invalid after it.
2. **A rejected claim does not change the owner.** The owner stays the device of the last accepted claim, else the creating device. So a woken laptop that is no longer the assignee cannot take its task back, also with a higher epoch.
3. **Remove the gate kind `continue_on_device`** from `gateKind`. Each gate now counts only from the owner (`gate.opened`, `gate.resolved`), and each answer waits for the owner's `gate.resolved`. Alternative: keep the kind and treat it as a normal gate. Rejected: a kind that no code opens is dead text, and the old meaning ("any device resolves") is the automatic path that the owner removed.
4. **Remove the event `task.moved`.** "Move to" and "Assign to another device…" write one human `task.assigned`. `TaskView.moving_to` is the device of the assignee when a claim exists and the claim device differs from it, else null. The old owner sees the new assignee, stops its session, pushes and writes `task.released`; the new device claims after `task.released`, or at once when the old owner is offline. Alternative: keep `task.moved` next to `task.assigned`. Rejected: 2 events for 1 action can disagree (a `task.moved` without a new assignee would show "moving" forever, because the target can never claim).
5. **Remove `needs_human` from `presence.offline_tasks` and `NEEDS_HUMAN_AFTER_MS`.** A task of an offline device waits; nothing opens after 10 min. The pause state `device_offline` stays. The pause table: "Needs the human: No; Push: No". Reason: the owner said that a laptop closed without a sync is the user's own mistake; a push after 1 h would be a move suggestion.
6. **New shared merge case `claim-not-assignee`.** It has: a claim from a device that was never the assignee, a reassignment by a human and a claim of the new device, a later claim of the old device with a higher epoch (woken laptop), a claim before any assignment, and an agent `task.assigned` that is refused. Both languages run it with 40 read orders.
7. **Changed fixtures.** `claim-epochs` had a `task.moved` line from `pixel-9`; it becomes a human `task.assigned`. Each case whose claims do not come from the assignee device gets a human assignment before the claim, or a changed `expected.json` when the rejection is the point. `expected.json` is written by `shared/core/scripts/merge-expected.ts` and read by both ports.

## Risks / Trade-offs

- [A claim of a task with no assignee is ignored] → The daemon claims only after an assignment (`workflow.md` 4.2.1 already says so). The fixture cases and tests that claimed with no assignee get a human assignment.
- [A task of an offline laptop waits until the human acts] → This is the owner's decision. The task shows "Paused: <device> offline" with the action "Assign to another device…", and "Sync" before a close prevents most cases.
- [The removal of an event type and a gate kind changes the v1 contract] → No data exists before the first release. A `task.moved` line is now an unknown type (kept, not applied, issue `unknown_type`), and a `gate.opened` with `continue_on_device` is a schema error (issue `bad_line`). Both are reported, not dropped in silence.
- [Kotlin and TypeScript drift] → The same `expected.json` files and the mutation runs in both languages.

## Migration Plan

No migration: there is no released data. Rollback: revert the commit.

## Open Questions

(none)
