## 1. Interfaces and the files layer

- [x] 1.1 Add `shared/plugin-api/src/sync.ts` (`SyncTransport`, `PeerStatus`, `SyncResult`, `SyncEvent`, `FolderSpec`, `PeerRecord`) and export it
- [x] 1.2 Add the `onWrite` hook to `WorkspaceFiles` and call it after each write, append and removal
- [x] 1.3 Add `shared/core/src/files/conflicts.ts` (`parseConflictCopy`) and `WorkspaceFiles.resolveConflictCopy`, `mergeLogCopy`, with tests (guard refusals included)

## 2. Engine pins

- [x] 2.1 Add `plugins/sync-syncthing/engine/engine.json` with the v2.1.7 pins and the release key fingerprint
- [x] 2.2 Add `src/pins.ts` (platform map, download, sha256 check, extract, signed-sum parse and compare, gpg check) and `scripts/engine.ts` (`fetch`, `verify-pins`)
- [x] 2.3 Unit tests on a captured `sha256sum.txt.asc`; a test helper that fetches the engine into the cache
- [x] 2.4 CI step "Engine pins match the signed release"

## 3. Engine control

- [x] 3.1 `src/config.ts`: the template and the first-start steps (generate, device id, write config.xml)
- [x] 3.2 `src/rest.ts`: the REST adapter on the Unix socket (axios), typed replies for the used endpoints
- [x] 3.3 `src/supervisor.ts`: spawn, ping loop, restart with backoff, pids, stale engine, stop
- [x] 3.4 Tests with the real engine: first start with 0 discovery/relay/NAT log lines, restart after SIGKILL, stop leaves no process

## 4. Transport

- [x] 4.1 `src/peers.ts`, `src/transport.ts`: folders (diff before PUT), ignores, peers, pairing interval, community switch, wrote, pause, resume
- [x] 4.2 `src/status.ts`: Sync now rule, status per peer and folder, route, status text
- [x] 4.3 Events: long poll of the engine events and the disk events, cursor reset after a restart
- [x] 4.4 `src/journal.ts` and `src/resolver.ts`: journal, election, priority rule, device-owned copies, history copy, sweeps
- [x] 4.5 Tests with 2 real engines in one process: pairing, task log sync, Sync now (1 and 200 files, offline peer), knowledge conflict in both orders, log copy merge

## 5. awd wiring

- [x] 5.1 Settings `AW_SYNC_ENGINE`, `AW_SYNC_LISTEN`, `AW_SYNC_COMMUNITY`
- [x] 5.2 `daemon/src/service/sync.ts`: start, stop, folders per workspace, write hook to `wrote` and the journal
- [x] 5.3 `/readyz` engine state; routes `/v1/sync…` in `daemon/src/api/sync-routes.ts`; client schemas and methods; `pnpm api:generate`
- [x] 5.4 `aw sync now|status|pause|resume`, `aw sync peer add|remove`, text output and exit codes
- [x] 5.5 Daemon tests: no engine → `not_installed`; with the engine: start, folders, stop with no process left

## 6. E2E and docs

- [x] 6.1 `e2e/docker/Dockerfile`, `e2e/compose.yaml`, `e2e/src/sync.docker.test.ts`, `task e2e`
- [x] 6.2 Docs: `docs/phase-1.md` 6.1 and 6.2, `docs/architecture.md` 6.1, `docs/tech-stack.md` 1.2, `AGENTS.md`
- [x] 6.3 `task check` passes; break each new test once
- [x] 6.4 Run the test plan in Docker and once with the Linux test server; keep the evidence outside git
