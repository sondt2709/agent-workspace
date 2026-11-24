## Why

Each device writes only its own log files. awd, the desktop app and the phone must turn these files into one view of the workspace: the same board, the same owner of each task and the same open gates on each device. The data-model review also found that one log line with a far-future HLC can move the clock of each reader forward for a long time.

## What Changes

- `packages/core` `merge`: reads each `log/<device>.jsonl` file of the workspace, of each task and of each device heartbeat folder. It orders the events by HLC, then device slug, then event id, and applies the ownership rules of `docs/architecture.md` 4.3:
  - Task state only from the owner device at that point in the order (the highest accepted `task.claimed` epoch; before a claim, the creating device).
  - Gate answers from any device; the owner's `gate.resolved` decides; each other answer becomes a comment. "Continue on another device" takes the first answer in merge order.
  - Comments are append only. `task.edited` fields: the newest edit wins per field; `first_message` only until the first session starts.
  - Assignment only from the creating device in `task.created` or from a human `task.assigned`; an agent assignment only with the project switch on, from the owner device of the parent.
  - Claims with epochs: a claim counts only when its epoch is above each earlier accepted epoch.
  - Task keys: on a collision the task of the higher-priority device (local > remote in list order > mobile) keeps the key. The other task shows "duplicate" until its creating device writes `task.rekeyed`.
  - Unknown event types are kept and not applied.
- A bound for remote HLC values: an event more than 24 h ahead of the local clock is held back and reported. It joins the merge when the local clock reaches it.
- Projections: workspace, projects, tasks (fields, stage, pause, open gates, "Needs you" reasons, subtasks, dependencies, key state), devices (role, priority, presence from heartbeats: offline after 90 s), queue order per agent, test slot leases. An incremental update reads only the new bytes of a grown file and rebuilds a file that became shorter or was replaced.
- `packages/core` `index`: a local SQLite index (`node:sqlite`) of the projections and the events, never synced. Queries use the MongoDB syntax: simple fields go to SQL first, then `sift` checks each row.
- Fixtures: merge cases next to the shared fixture folder, each with the expected projection as JSON for the Kotlin port.
- New library: `sift` 17.1.4 (already chosen in `docs/tech-stack.md` 1.1 "Index").
- Docs: `docs/phase-1.md` 3.5 and 3.6 get the HLC bound, the presence receipt rule and the index tables. After the review: `docs/engineering-rules.md` 5.6 (the event id tie-break), `docs/workflow.md` 5 (failover by claim only), the wake-up comment (`architecture.md` 4.3.4, `phase-1.md` 9.6.5, task-model §5.5) and the last valid document (`phase-1.md` 6.6). After review round 2: `docs/workflow.md` 4.2.1 (claim only without an accepted claim or after a newer assignment), and the wake-up comment in `docs/prd.md` CNT-27 and `docs/feasibility-details.md`.

## Capabilities

### New Capabilities
- `workspace-merge`: the merge of the device logs into one deterministic view, the ownership rules, claims, task keys, the HLC bound, presence and the incremental update.
- `workspace-index`: the local SQLite index of the merged view, its rebuild and the MongoDB-style queries.

### Modified Capabilities
- `workspace-schemas`: the shared fixtures get merge cases with an expected projection for each case.

## Impact

- Code: `packages/core/src/merge/`, `packages/core/src/index/`, `packages/core/src/index.ts`, `packages/schema/fixtures/merge/`, `packages/schema/src/testing/fixtures.ts`.
- Dependencies: `sift` 17.1.4 in `@aw/core` (a row in `docs/tech-stack.md` 2.1). `prettier` 3.10.1 as a dev dependency of `@aw/core`, for `scripts/merge-expected.ts`.
- Build config: `.pre-commit-config.yaml` excludes `packages/schema/fixtures/merge/truncated-log-line/files/` from `end-of-file-fixer`, because that case keeps a last line with no newline on purpose. To undo: remove the 2 lines.
- Interfaces: `MergeEngine`, `mergeWorkspace()`, the projection types and `WorkspaceIndex` are used by awd-api-cli, task-loop, continuity and the apps. The fixture cases and expected JSON files are a contract for android-shared.
- Out of scope: the awd service and API, file watching, the sync engine, sessions, the knowledge history, conflict copies of logs (the reader removes duplicate event ids only).
