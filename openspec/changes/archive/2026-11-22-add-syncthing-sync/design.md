## Context

awd (daemon/) opens each workspace, merges the device logs and serves the local API. `/readyz` reports `sync_engine: not_configured`. `plugins/sync-syncthing` and `shared/plugin-api` are placeholders. The docs fix the engine behavior: `docs/phase-1.md` 6.1 to 6.6 and 6.8, `docs/architecture.md` 4.3.2, 4.4 and 6.1, `docs/tech-stack.md` 1.2, `decisions/2026-11-22-device-sync.md`. The verification of 2026-11-22 measured the engine on a Mac and a Linux device (copy name = winner, `maxConflicts` 0 loses data, scans before Sync now, 2 processes).

Facts checked on the pinned binary (v2.1.7, 2026-11-23) before this design:
1. `syncthing generate` writes the OS host name and turns on global discovery, relays, NAT, usage and crash reports. So awd must replace `config.xml` before the first `serve`.
2. A plain path in `<gui><address>` makes the REST API listen on a Unix socket. The path must be shorter than about 104 bytes (`bind: invalid argument` with a longer path). `unix://` as a prefix fails.
3. `serve --no-restart` runs one process (no monitor child).
4. `/rest/events/disk` gives `LocalChangeDetected` and `RemoteChangeDetected` with the folder and the path, also for a new conflict copy.
5. A paused or disconnected peer gives `remoteState: "unknown"` and `needItems > 0` after a local change.
6. The conflict copy name has the short id of the winner (`t.sync-conflict-20261123-032921-5NRSCRM.md` held the content of the other device).
7. `sha256sum.txt.asc` of the release has a good signature from the key `FBA2E162F2F44657B38F0309E5665F9BD5970C47` (`https://syncthing.net/release-key.txt`).

## Goals / Non-Goals

**Goals:**
- awd owns the engine: a config with no third-party traffic before the first start, REST only after that, supervision and restart.
- The 3 folders of each workspace sync between the person's computers, with the targeted scan, Sync now, the status per peer and the conflict resolver.
- A peer API that identity-pairing calls, and a test command that adds a peer by its device id and address.
- An e2e setup with 2 awd containers that later tasks reuse.

**Non-Goals:**
- Pairing codes, device keys, signed device records, revoke (identity-pairing). This change adds and removes peers only.
- The phone engine (android-engine), the desktop UI (desktop-devices-kb), sync before sleep (desktop app and logind).
- The knowledge history UI and Undo (knowledge task). This change only copies the losing version of a conflict to the history store.
- Shipping the binary in an installer and `THIRD_PARTY_NOTICES` (release-pipeline).

## Decisions

1. **Package layout.**
   ```
   plugins/sync-syncthing/
     engine/engine.json      tag, sha256 per platform, release key fingerprint
     scripts/engine.ts       fetch | verify-pins (CLI of src/pins.ts)
     src/pins.ts             read pins, platform map, download, sha256 check, extract, signed-sum check
     src/config.ts           the config.xml template and the first-start steps
     src/rest.ts             the engine REST adapter (axios on the Unix socket); one module for the engine
     src/supervisor.ts       spawn (execa), ping, restart with backoff, pids, stop
     src/transport.ts        SyncthingTransport implements SyncTransport
     src/status.ts           peer and folder status, Sync now rule, the status text
     src/journal.ts          sha256 journal of own writes
     src/resolver.ts         conflict decisions and the executor
     src/peers.ts            the peer list file
   ```
   The plugin depends on `@aw/plugin-api`, `@aw/core` (conflict-copy names, files-layer operations, clock) and `@aw/schema` (types). It never imports `daemon/`. awd uses the plugin through one wiring file, `daemon/src/service/sync.ts` (parallel note 1).

2. **The engine binary.** awd uses `AW_SYNC_ENGINE` (a path) or `<AW_HOME>/engine/syncthing`. When neither exists, sync is off and `/readyz` reports `sync_engine: "not_installed"`. Reason: the daemon tests and a person who runs awd without an engine keep working; the installer (release-pipeline) puts the binary at the default path. The fetch script writes to a cache (`node_modules/.cache/aw-syncthing/<tag>/<platform>/`) for the tests, and to any `--dest` for the Docker image and the Linux test server run. macOS uses the universal zip for arm64 and x64.

3. **Pins and the CI check.** `engine/engine.json` holds the tag, the archive name and sha256 of each platform, the release key fingerprint and the key URL. `fetch` refuses an archive whose sha256 differs. `verify-pins` downloads `sha256sum.txt.asc` and the release key, imports the key into a temporary GnuPG home, requires `VALIDSIG <pinned fingerprint>` in the gpg status output, and compares each pinned sha256 with the signed file. CI runs `verify-pins` (network). The unit tests run the parse and the compare on a captured copy of the signed file. The repo stores the fingerprint, not the key file (the key file has an e-mail address).

4. **First start** (`docs/phase-1.md` 6.1):
   1. `syncthing generate --home <AW_HOME>/sync --no-port-probing` (only when `config.xml` is missing).
   2. Read the device id with `syncthing device-id --home …` and the config version from the generated file. Write `config.xml` from the template: the device with the AW slug as its name, the GUI on `<AW_HOME>/run/sync.sock` with `unixSocketPermissions 0600` and a new random API key (32 bytes, base64url), listen address `AW_SYNC_LISTEN` (default `tcp://0.0.0.0:22300`, TCP only, so no QUIC and no STUN), global discovery, local discovery, relays and NAT off, `urAccepted -1`, crash reports off, `autoUpgradeIntervalH 0`, `startBrowser false`, `reconnectionIntervalS 60`. The XML values are escaped.
   3. `syncthing serve --home … --no-browser --no-upgrade --no-restart --log-file <AW_HOME>/logs/sync-engine.log --log-max-size 10485760 --log-max-old-files 3`, env `STNOUPGRADE=1`, `HOME` unchanged. Wait for `GET /rest/system/ping` (p-retry, delays from the clock module).
   4. At each start, read the API key from `config.xml`, then apply the switch by REST: `localAnnounceEnabled true`; `globalAnnounceEnabled` and `relaysEnabled` = `AW_SYNC_COMMUNITY` (default on, decision D18); NAT stays off. Also set the name and the listen address again when they changed.
   Alternative for the key: the OS keystore. Rejected for now: Syncthing keeps the key in plain text in `config.xml` (mode 0600) anyway, and a keystore needs a session bus on a headless Linux device. The doc text changes in `docs/phase-1.md` 6.2.

5. **Supervision.** One supervisor per awd. It records the pid of the engine and of each child (`ps -A -o pid=,ppid=`, exact pids, never a name match) in `<AW_HOME>/sync/aw-engine.pid`. At start, a pid in that file whose command name is `syncthing` is a stale engine of an earlier awd: awd stops it first, so the home lock and the socket are free. Health check: `/rest/system/ping` every 10 s; 3 failed pings in a row or a process exit start a restart. Backoff: 1 s, 2 s, 4 s … up to 60 s, and back to 1 s after 60 s of good health. Stop: SIGTERM to each recorded pid, then SIGKILL after 10 s. Each restart increments a generation number; the event readers reset `since` to 0 for a new generation (`docs/phase-1.md` 6.5.1). States: `not_installed`, `starting`, `running`, `restarting`, `stopped`, `failed` (10 restarts with no good minute).

6. **Folders.** `addFolder({workspace, kind, path, ignore})` makes the folder `aw-<workspace>-<kind>` with label `<kind>`, type `sendreceive`, the devices (this device and each peer; `secure` only with computers), `fsWatcherEnabled`, `fsWatcherDelayS 1`, `rescanIntervalS 3600`, `maxConflicts 10`, and on computers simple versioning (`keep 10`, `fsPath <AW_HOME>/sync-versions/<folder id>`). awd reads the folder config first and sends a PUT only when a field differs, because each folder-config change restarts the folder (ST2). The ignores (`*.aw-tmp`; a mobile device adds `/*/artifacts` in `tasks`) are set with `POST /rest/db/ignores` when they differ.

7. **Peers.** `addPeer({device, sync_id, role, addresses})` writes the peer to `<AW_HOME>/sync-peers.json` (mode 0600), PUTs the engine device (name = slug, `autoAcceptFolders false`, `introducer false`), adds it to each folder, and sets `reconnectionIntervalS 5` until each new peer is connected or 10 min passed, then back to 60. `removePeer(device)` deletes the engine device (`DELETE /rest/config/devices/<id>`) and removes it from the folders and the file. identity-pairing replaces the file with the signed device records and calls the same 2 methods. `aw sync peer add <device-id> <address> [--name] [--role]` is the test path (default role `remote`, default name `peer-<short id>`). It shares `secure` with a device that has no signed record, so awd refuses it (403 `refused`) unless `AW_SYNC_TEST_PEERS=on` (the Docker e2e devices set it); identity-pairing calls `addPeer` after its own checks.

8. **Targeted scans.** `WorkspaceFiles` gets an optional `onWrite(path, content)` hook. It runs after each atomic write, append, removal and conflict operation. awd wires it to `transport.wrote([path])` and to the journal. `wrote()` maps the first path part (`tasks`, `knowledge`, `secure`) to the folder id and calls `POST /rest/db/scan?folder=<id>&sub=<rest>` through a `p-queue` (concurrency 4). A failed scan is logged at debug level: the engine watcher finds the change within `fsWatcherDelayS` anyway.

9. **Sync now and status** (`docs/phase-1.md` 6.4, 6.5):
   - `syncNow({timeoutMs})`: `POST /rest/db/scan?folder=<id>` for each folder (it returns after the scan), then poll every 250 ms: for each peer and each folder that it shares, `GET /rest/db/completion?folder&device` and `GET /rest/system/connections`. A peer is synced when it is connected, and each folder has `needItems` 0 and `remoteState` `valid`. Stop when each peer is synced or at the timeout (default 20 s). The result lists each pending peer with its items and the reason `offline` (not connected) or `timeout`. The total completion is never used (ST8).
   - `status()`: per peer: `connected`, `route` (`lan` when the engine says `isLocal`, `tailscale` for an address in 100.64.0.0/10, `relay` for a relay connection type, else `internet`), `needItems`, `needBytes`, `inSync`, `lastSeen`, `lastSynced` (the last time awd saw the peer synced), and the folders. The route list of `docs/architecture.md` 6.1 gets `internet` (a direct connection outside the LAN).
   - The text: "Synced 12 s ago" when synced; "3 changes not synced to ubuntu-01 (offline)" or "(syncing)"; "Not synced yet" before the first check. `describePeer()` in the plugin makes it, and `aw sync status` and later the apps use it.

10. **Events.** `events()` long-polls `/rest/events` for StateChanged, FolderSummary, FolderCompletion, DeviceConnected, DeviceDisconnected, DevicePaused, DeviceResumed, FolderErrors and PendingDevicesChanged, and `/rest/events/disk`. It skips the Item events (ST9). The transport itself uses the disk events for the journal and the resolver, and DeviceConnected to end the pairing interval.

11. **Journal** (`<AW_HOME>/journal/<workspace id>.jsonl`, one line `{path, sha256, at}`): the files-layer hook gives the exact bytes of each own write; a `LocalChangeDetected` event of a file (not a conflict copy) adds the sha256 of the file at that time, so a human edit counts as a write of this device. awd keeps the last 16 hashes per path in memory and compacts the file at start when it has more than 10,000 lines.

12. **Conflict resolver** (`docs/architecture.md` 4.3.2, `docs/phase-1.md` 6.6). Triggers: a disk event whose path is a conflict copy, a sweep of the 3 folders at start, after each new connection and after Sync now. For a copy `<stem>.sync-conflict-<date>-<time>-<winner short id><ext>` of the original `<stem><ext>`:
    | Original path rule | Who acts | Action |
    |---|---|---|
    | Device-owned log of this device | this device | `mergeLogCopy`: append each line of the copy whose event id the original does not have, then remove the copy |
    | Snapshot `task.yaml` of a task that this device owns, or another device-owned file of this device | this device | keep the original, remove the copy (awd writes the snapshot from the logs) |
    | Device-owned file of another device | nobody | keep the copy for its owner; the merge does not read it |
    | Shared file (workspace, project, schema copies, knowledge, `secure` files) | the highest-priority connected device | the priority rule below |
    Priority rule: the copy author is this device when the sha256 of the copy is in the journal of the path; else the original author is this device when the sha256 of the original is in the journal; else, with exactly 2 devices in the folder, the copy author is the device that is not the winner. The original author is `global.modifiedBy` of `GET /rest/db/file`. When the copy author has the higher priority, awd writes the copy content over the original (`resolveConflictCopy(copy, "copy")`); else it keeps the original. In both cases it removes the copy and stores the losing bytes in `<AW_HOME>/history/<workspace>/<sha256>`. When no author is found, awd keeps the Syncthing winner. Priority: `local` first, then `remote` in the order of `device_order` in `workspace.yaml` (then the peer file order), then `mobile`. A conflict copy of an unknown path stays and is logged.
    Alternative: let the merge read log copies (`classifyPath` refuses them now). Rejected: it changes merge-index code, and the owner removes the copy within seconds anyway.

13. **Files-layer operations for copies** (`shared/core/src/files/conflicts.ts`): `parseConflictCopy(path)` gives the original path, the date and the winner short id, or null. `WorkspaceFiles.resolveConflictCopy(copy, keep)` checks the write guard on the original path, writes the copy bytes over the original when `keep` is `copy`, and removes the copy. `WorkspaceFiles.mergeLogCopy(copy)` requires that this device owns the log. These are the only new deletes. Reason: AGENTS.md "Write workspace files only through `shared/core` `files`".

14. **awd wiring** (`daemon/src/service/sync.ts`): `SyncService.start()` after the workspaces open; it adds the 3 folders of each open workspace and of each new workspace after `initWorkspace`. `Daemon.stop()` stops it before it closes the workspaces. The local API routes are in a new file `daemon/src/api/sync-routes.ts`, registered with one line: `GET /v1/sync` (status), `POST /v1/sync/now {timeout_ms?}`, `POST /v1/sync/pause`, `POST /v1/sync/resume`, `POST /v1/sync/peers`, `DELETE /v1/sync/peers/{device}`. Without an engine each of them gives `503 not_ready` with the reason. `/readyz` reports the engine state; the state does not block readiness, because a session can run on one device without sync. Settings: `AW_SYNC_ENGINE`, `AW_SYNC_LISTEN`, `AW_SYNC_COMMUNITY` in `daemon/src/settings.ts`.

15. **E2E** (`e2e/compose.yaml`, `e2e/docker/`): one image (Node 24.22.3 on Debian slim, `pnpm install --frozen-lockfile`, the engine through `engine.ts fetch` with the sha256 check), 2 services `macbook-pro` (role local) and `ubuntu-01` (role remote) on a private bridge network, `AW_SYNC_COMMUNITY=off`, project name `aw-sync-e2e`. The suite `e2e/src/sync.docker.test.ts` runs only with `task e2e` (`vitest --config vitest.docker.config.ts`); `pnpm test` of `e2e/` runs the offline unit tests of the harness. The second device gets `tasks/workspace.yaml` and `tasks/schemas/` with `docker cp` and registers the folder with `aw workspace init`, because the pairing folder of identity-pairing does not exist yet.

## Risks / Trade-offs

- [A `LocalChangeDetected` hash can read a remote version that arrived right after the local edit] → the files-layer hook journals the exact bytes for AW writes; the event path is only for human edits, and a wrong author keeps the Syncthing winner (no data loss: the history store and the simple versioning keep the other version).
- [The plugin tests need the engine binary and the network once] → the fetch checks the pinned sha256; the cache is in `node_modules/.cache`; CI has network.
- [A Unix socket path over 103 bytes fails] → `checkSocketPath` already limits `AW_HOME` for `awd.sock`; `sync.sock` has the same length.
- [Parallel tasks change `daemon/src/api/app.ts`, `cli/run.ts`, `shared/client/src/schemas.ts` and `shared/plugin-api/src/index.ts`] → each change here is an added block or one line; the lead resolves the order.
- [The global `docker builder prune -af` of the test-server stop command can break the builds of the 2 parallel sessions] → this task removes only its own project, image and volumes; the human runs the global prune after the parallel work.
- [Copy-author detection with 3 or more devices and no journal entry] → keep the Syncthing winner; the knowledge change logs (knowledge task) can add an author source later.

## Migration Plan

No data migration. A device with no engine binary keeps working with sync off. Undo: remove the commit; the engine home `~/.aw/sync`, `sync-peers.json`, `journal/` and `sync-versions/` can be deleted.

## Open Questions

None that block. The community switch is an environment value until desktop-devices-kb adds the setting in the UI and its file.
