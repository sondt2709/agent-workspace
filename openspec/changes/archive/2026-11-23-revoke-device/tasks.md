## 1. Current behavior on the base

- [x] 1.1 Write the new unit tests first (presence, pause, push, `RecordPeers`, revoke delivery) and keep their failing output on `5a59834`
- [x] 1.2 Run the new Docker journey on the base with the local tmux fix and keep the log
- [x] 1.3 Take the desktop screenshots of a task of a revoked device on the base build

## 2. Presence and shown pause

- [x] 2.1 `presenceOf()` gives `device_revoked` rows with the `revoked_at` time; the engine passes `revokedAt`; `OfflineTask.cause` type
- [x] 2.2 Kotlin `presenceOf()` with the same rule; regenerate `device-revoked/expected.json`
- [x] 2.3 `withPresencePause()`: revoked replaces the own pause and adds the "Needs you" reason
- [x] 2.4 `@aw/client/pause-load` `tasksWithPresence()`; the CLI `withPause()` uses it

## 3. Desktop

- [x] 3.1 The main background load merges the presence; the pause notification title uses the shown text
- [x] 3.2 Renderer tests: Inbox card, List group, task detail "Change assignee…"

## 4. Revoke delivery and session stop

- [x] 4.1 Optional `SyncTransport.waitDelivered()`; the Syncthing transport with `availability` of `/rest/db/file`; test with 2 real pinned engines
- [x] 4.2 `daemon/src/service/revoked.ts`; `DeviceService.revoke()` keeps the peer while it delivers, then drops it
- [x] 4.3 Session test: a revoked own record stops the session and claims nothing

## 5. Phone peers and push

- [x] 5.1 `RecordPeers.of()` skips keys and sync ids revoked in any workspace (JVM test)
- [x] 5.2 `PushService.subscriptions()` allow list from the device records of the open workspaces

## 6. Docs

- [x] 6.1 `docs/phase-1.md` 6.8 (delivery, an offline revoked device), `docs/architecture.md` (revoked notification), `SECURITY.md`

## 7. Verification

- [x] 7.1 Break each new test once and restore it
- [x] 7.2 `task check` in shared, daemon, desktop, plugins, e2e; `task android:check`; `task leakcheck`
- [x] 7.3 Docker journey on the final commit
- [x] 7.4 Phone journey on the Android emulator test server (2 workspaces, revoked computer, revoked phone, no push)
- [x] 7.5 Desktop screenshots after
