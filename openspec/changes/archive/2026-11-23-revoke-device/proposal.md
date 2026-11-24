## Why

When the person revokes a device, its tasks look as if they still run, and the person gets no hint to change the assignee (gaps M17a, M17). The revoked device never gets its own revoke record, so its sessions do not stop. The phone keeps a device that another workspace revoked as a sync peer (M21, review finding 0b), and each computer still sends pushes to a revoked phone (review finding 0-2).

## What Changes

- The presence lists each task of a revoked device in `offline_tasks` with the cause `device_revoked` and the `revoked_at` time (TypeScript and Kotlin merge).
- The desktop app and the `aw` CLI show "Paused · ubuntu-01 was revoked" with "Change assignee…". The task goes to the "Needs you" lane, the Inbox and the Tray count. The main process shows one notification for each such task.
- `aw device revoke` keeps the revoked device as a sync peer until the engine reports that it has the new record, for at most 10 s, and only while it is connected. Then the revoked device stops its sessions.
- `SyncTransport` gets the optional method `waitDelivered()`. The Syncthing transport uses `GET /rest/db/file` (`availability`).
- The phone drops a peer whose device key or sync device id is revoked in any workspace, as awd does.
- A computer sends a push only to a phone that has a valid, not revoked record in the workspace, and whose key and sync id are not revoked in any open workspace.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `workspace-merge`: Presence lists the tasks of a revoked device with `device_revoked`.
- `desktop-app`: the revoked pause on the task views and in the Needs you lane.
- `desktop-background`: a notification for a task of a revoked device.
- `aw-cli`: the revoked pause in `aw task list` and `aw task show`.
- `device-identity`: the revoke delivers the record to a connected revoked device before the peer goes.
- `sync-transport`: the optional `waitDelivered()` method.
- `android-sync-engine`: phone peers skip a device that any workspace revoked.
- `push-sender`: no push to a revoked phone or to a phone with no record.

## Impact

- Code: `shared/core` (presence), `android/shared` (presence), `android/control` (`RecordPeers`), `shared/client` (pause), `shared/plugin-api`, `plugins/sync-syncthing`, `daemon` (devices, push, CLI), `desktop` (main background load, notifications).
- Contract: the merge fixture `contracts/fixtures/merge/device-revoked/expected.json` gets one presence row. No API route, event type or schema changes.
- Security: a revoked device stays a peer for at most 10 s after the revoke (NFR-06).
- Tests: unit tests in each package, a real-engine test, the Docker journey `e2e/src/revoke-device.docker.test.ts`, and a phone run on the Android emulator test server.
