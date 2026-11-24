## Why

awd keeps the files of a workspace on one computer only. Principle 5 and `decisions/2026-11-22-device-sync.md` need the person's own devices to sync the AW folder directly, with the built-in Syncthing engine that AW owns and that the user never sees. The later tasks (pairing, the task loop on 2 devices, the desktop "Sync" button) need this transport first.

## What Changes

- New plugin `plugins/sync-syncthing` (`@aw/sync-syncthing`) that implements the `SyncTransport` interface of `docs/architecture.md` 6.1:
  - Engine pins: one version file (`engine/engine.json`) with the tag, the sha256 of each platform archive and the fingerprint of the Syncthing release key. A script (`pnpm engine:fetch`, `pnpm engine:verify-pins`) downloads an archive, checks its sha256 and extracts it, and checks the pins against the PGP-signed `sha256sum.txt.asc` of the release.
  - First start: `syncthing generate`, then awd writes `config.xml` from its template before the first `serve`: no global discovery, local discovery, relays, NAT traversal, usage reports, crash reports or upgrades; the AW device slug as the name; the REST API on the Unix socket `~/.aw/run/sync.sock` (mode 0600) with a random API key. After that, awd uses only the REST API.
  - Supervision: health check every 10 s, restart with backoff, the pids of the engine processes, stop with SIGTERM then SIGKILL, and the removal of a stale engine of an earlier awd.
  - 3 folders per workspace (`aw-<id>-tasks`, `-knowledge`, `-secure`; `secure` only with computers), the ignore `*.aw-tmp` set through REST on each device, `maxConflicts` 10, `fsWatcherDelayS` 1, simple file versioning in `~/.aw/sync-versions/<folder id>` (computers).
  - Peers: add and remove a peer by its sync device id (the API that identity-pairing calls), full mesh, reconnect interval 5 s while a new peer is not connected yet, then 60 s.
  - `wrote(paths)`: a targeted scan of each written path. `syncNow()`: a scan of each folder, then per peer `connected`, `needItems` 0 and `remoteState` `valid`, never the total completion. `status()`: per peer and per folder, with the text "Synced 12 s ago" and "3 changes not synced to ubuntu-01 (offline)".
  - Conflict resolver: a sha256 journal of the own writes (files layer and local changes that the engine reports), the priority local > remote (device order) > mobile, only the highest-priority connected device resolves, the copy is removed, and the losing version goes to the history store. A conflict copy of a device-owned log is merged by event id by its owner device (the duplicate-id rule), then removed.
- `shared/plugin-api`: the `SyncTransport`, `PeerStatus`, `SyncResult` and `SyncEvent` types.
- `shared/core` files layer: an `onWrite` hook for each write, `parseConflictCopy()`, `resolveConflictCopy()` (keep the original or restore the copy, then remove the copy) and `mergeLogCopy()` for a log copy of this device.
- awd wiring: the engine starts and stops with awd when the engine binary exists (`AW_SYNC_ENGINE` or `~/.aw/engine/syncthing`); each write of the files layer gives a targeted scan; `/readyz` reports the `sync_engine` state; new local API routes under `/v1/sync`; new commands `aw sync now|status|pause|resume` and `aw sync peer add|remove`.
- E2E: `e2e/compose.yaml` with 2 awd containers with the engine on a private network, community servers off, and a Docker suite (`task e2e`) for the test plan. `pnpm test` of `e2e/` stays offline.
- CI: a step "Engine pins match the signed release".

## Capabilities

### New Capabilities
- `sync-engine`: the engine pins and the fetch script, the first-start config, the supervision, the folders, the peers and the pairing reconnect interval.
- `sync-transport`: targeted scans, Sync now, the peer and folder status with its text, the engine events.
- `sync-conflicts`: the write journal, the priority rule for shared files, the resolver election, the log and snapshot copies, the history copy of the losing version.

### Modified Capabilities
- `local-api`: `/readyz` reports the real sync engine state; new `/v1/sync` routes.
- `aw-cli`: new `aw sync` commands.
- `awd-service`: awd starts, supervises and stops the sync engine and adds the 3 folders of each workspace.
- `workspace-files`: the write hook and the 2 conflict-copy operations (a narrow second delete of the files layer).

## Impact

- Code: `plugins/sync-syncthing/` (new code), `shared/plugin-api/src/sync.ts` (new), `shared/core/src/files/` (hook and conflict copies), `shared/client` (sync schemas and methods), `daemon/src/service/sync.ts` (new wiring), small changes in `daemon/src/service/daemon.ts`, `workspace.ts`, `settings.ts`, `api/app.ts`, `cli/run.ts`, `cli/format.ts`.
- Contracts: `contracts/openapi.yaml` (generated: `/readyz` and `/v1/sync`), the `aw sync` commands. The engine REST contract is pinned to Syncthing v2.1.7 by tests that run the real binary.
- Dependencies: `axios` 1.21.1 and `p-queue` 10.0.0 (already in the stack) in the plugin; `execa` 10.2.1 (already in the stack) for the engine process. No new library.
- Tests: the plugin tests run the real pinned engine. The first run downloads it (network once; the sha256 is checked) into `node_modules/.cache/`.
- CI and config (low risk, easy to undo): `.github/workflows/ci.yaml` gets one step; the root `Taskfile.yaml` gets `task e2e`.
- Docs: `docs/phase-1.md` 6.1, 6.2 (API key in `config.xml`, the Unix socket, local discovery off until the switch), `docs/architecture.md` 6.1 (route `internet`), `docs/tech-stack.md` 1.2 (pins), `AGENTS.md` (status, commands).
- Test servers: Docker on this Mac (`local-compose`), one real run with a remote Linux test server.
