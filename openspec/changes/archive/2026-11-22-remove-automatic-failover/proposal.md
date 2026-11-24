## Why

The product owner decided on 2026-11-23 that AW never changes the agent or the device of a task by itself. The docs and the merge still have an automatic failover: queued tasks move after 10 min offline, the gate "Continue on another device" opens by itself, and a claim from any device can take a task. The phase 1 prototype also has a "Close laptop" flow that suggests a move.

## What Changes

- New decision `docs/decisions/2026-11-23-manual-move.md` (accepted by the product owner). It replaces the failover text of `2026-11-22-approved-defaults.md` (default "queued tasks move after 10 min offline") and `2026-11-22-device-sync.md` (device roles item 3).
- Merge (`shared/core` and `android/shared`): a `task.claimed` counts only when its device is the device of the current assignee (`agent@device`) at that point in merge order. A claim from another device is ignored and reported with the reason `not_assignee_device`.
- **BREAKING** (file format, before the first release): the gate kind `continue_on_device` is removed from `@aw/schema`, so the merge has no gate that any device can open or resolve. Each gate now follows the owner rule.
- **BREAKING** (file format, before the first release): the event `task.moved` is removed. "Move to" is a human `task.assigned` to an agent on another device. `TaskView.moving_to` is now the device of the assignee while the accepted claim is on another device.
- Presence keeps `device_offline` for the claimed tasks of an offline owner. The flag `needs_human` (after 10 min) of `presence.offline_tasks` is removed, because no gate opens.
- The wake branch stays: a laptop that wakes after the human moved its task pushes its unpushed work as `aw/<key>-<device>-<time>` and writes a `comment.added`.
- Docs: `workflow.md`, `phase-1.md`, `architecture.md`, `prd.md`, `feasibility.md`, `feasibility-details.md` and the 2 older decisions. The desktop button is "Sync" (it syncs and shows the result); there is no "Close laptop" flow and no move suggestion.
- Fixtures: a new shared merge case `claim-not-assignee`; the changed cases get a new `expected.json`.
- Prototype (outside git): "Close laptop" becomes "Sync"; no automatic move; a paused task offers "Assign to another device…".

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `workspace-merge`: the claim rule (only from the device of the current assignee), the gate answer rule (no `continue_on_device`), the move (a human `task.assigned`, `moving_to` from the assignee) and presence (no `needs_human`).
- `workspace-schemas`: the event type list has no `task.moved`; the gate kind list has no `continue_on_device`.

## Impact

- Code: `shared/schema/src/common.ts`, `shared/schema/src/events.ts`, `shared/schema/src/testing/samples.ts`, `shared/core/src/merge/{task,presence,view,random-events}.ts` and tests; `android/shared/src/commonMain/.../merge/{TaskFold,Rules,View}.kt` and tests.
- Generated: `contracts/schemas/event.v1.schema.json`, `contracts/samples/schema-samples.json`, `android/shared/generated/kotlin/` (`pnpm schema:generate`).
- Fixtures: `contracts/fixtures/merge/*/expected.json`, `contracts/fixtures/merge/claim-epochs/files/` (it had a `task.moved` line), new `contracts/fixtures/merge/claim-not-assignee/`.
- Interfaces for later tasks: awd (task-loop, continuity) claims only for its own assignee device; the desktop and phone "Move to" writes a human `task.assigned`; no code opens `continue_on_device`.
- Data: no released data exists, so the 2 removals need no `event.v2`.
