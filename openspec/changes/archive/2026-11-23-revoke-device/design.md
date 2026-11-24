## Context

`docs/phase-1.md` 6.8 says: the tasks of a revoked device show "Paused: <device> was revoked" with "Change assignee", the revoked device stops its sessions, and no device keeps it as a peer. On the base `5a59834`:

1. `presenceOf()` (`shared/core/src/merge/presence.ts`) gives only `device_offline` rows. move-paused-task made the pause model for `device_revoked` (`shared/client/src/pause.ts`), but nothing makes such a row.
2. The desktop main process loads the tasks with no presence, so it cannot notify for a presence pause (move-paused-task open issue 4).
3. `DeviceService.revoke()` writes the record and removes the peer at once. The revoked device never gets the record, so `SessionManager.#claims()` never sees its own revoke, and its sessions keep running.
4. `RecordPeers.of()` on the phone skips only the revoked record itself. A device with a valid record in another workspace stays a peer. awd skips each key and sync id that any workspace revoked.
5. `PushService.subscriptions()` reads each `push.yaml` with no device record check.

## Goals / Non-Goals

**Goals:**
- The revoked pause on the desktop (task detail, Board, List, Inbox, Tray, notification) and in the CLI.
- The revoked device gets its revoke when it is online, and stops its sessions within 10 s (NFR-06).
- The phone and the push follow the revoke rule of awd in each workspace.

**Non-Goals:**
- Approve and Revoke on the phone (O1), the revoked pause on the phone screens (N5), folders per workspace (N13).
- A revoked device that is offline at the revoke time. It cannot get the record any more (no peer keeps it).

## Decisions

1. **The revoked pause is a presence row, not a task fold field.** The presence already carries the view-only pauses, and the clients merge it (`withPresencePause`). Alternative: a `paused` value in the task fold. Rejected: it changes the task view contract of both languages, and the handoff names the presence.
2. **Which tasks.** The device of a task is the device of the assignee (`agent@device`), else the device of the claim. A task that is not done and not archived, whose device is revoked, gets `{cause: "device_revoked", device, since: ISO of revoked_at}`. A task that the person assigned to another device has no row (it moves). The revoked row replaces an offline row and shows also when the task has its own pause, because the revoked device never writes `task.resumed`. `presenceOf()` gets the `revokedAt` function of the engine as a fourth argument; without it the time is `now`.
3. **The Kotlin presence follows.** `contracts/fixtures/merge/device-revoked/expected.json` includes the presence, and `MergeCasesTest` compares it. `presenceOf()` in `android/shared/.../Rules.kt` gets the same rule and the revoke time from the kept device records.
4. **Needs you.** `withPresencePause()` adds `{reason: "paused", cause}` to `needs_you_reasons` and sets `needs_you_lane` for a pause that needs the human, as the task fold does for a `task.paused` with `needs_human`. So the Board lane, the List group, the Inbox card and the Tray count work with no change in the views.
5. **One loader for the CLI and the desktop main process.** New `shared/client/src/pause-load.ts` (`@aw/client/pause-load`): `tasksWithPresence(client, ws, tasks)` reads the presence and, only when it has rows, the device names. `pause.ts` stays free of the axios client, because the renderer imports it.
6. **Notification text.** The pause notification title uses the shown pause text: "AW-1 · Paused: ubuntu-01 was revoked". The id stays `paused:<task>:<cause>`. A revoked pause is a pause that needs the human (`architecture.md` 4.10.6). The phone push stays off for it (`architecture.md` 4.6.5).
7. **Delivery before the drop.** New optional `SyncTransport.waitDelivered(device, workspace, path, timeoutMs): Promise<boolean>` (the path is relative to the workspace root, as in `wrote()`). The Syncthing transport scans the path (`POST /rest/db/scan` returns after the scan), then polls `GET /rest/db/file` every 250 ms until `availability` has the device id of the peer, the peer is not connected, or the time ends. `DeviceService.revoke()` puts the sync id of the target in a `delivering` set before it writes the record, so each `refreshPeers()` keeps that peer. After the record and the credential rotation, it waits (`REVOKE_DELIVERY_MS` = 10 000), then removes the set entry and runs `refreshPeers()`. The route answers after the drop, so the reply means "the device is no peer". `SyncService.waitDelivered()` gives `false` when no engine runs. Alternatives: a fixed delay (no proof), or a separate channel to the revoked device (no such channel exists).
8. **One revoke rule in awd.** New `daemon/src/service/revoked.ts`: `revokedIdentities(records)` gives the revoked device keys and sync ids, and `isRevoked(record, identities)`. `#refreshPeersNow` and `PushService` use it.
9. **Push allow list.** A `push.yaml` device gets a push only when the workspace has a kept record of that slug that is not revoked, and its key and sync id are not in the revoked set of the open workspaces. The push service gets the open workspaces from the session service.

## Risks / Trade-offs

- [The revoked device gets new files for up to 10 s] → The new credential key is sealed only to the remaining computers. The window is inside NFR-06.
- [The revoked device is offline at the revoke] → It keeps its sessions until a person stops them there. `docs/phase-1.md` 6.8 says so.
- [`availability` is a field of the engine REST reply] → A fixture of the pinned v2.1.7 reply and a test with 2 real engines.
- [A revoke route answers up to 10 s later] → The "Revoke device" button of the desktop dialog is disabled while the request runs; the client timeout is 30 s.

## Migration Plan

No data change. An older awd keeps the old behavior. Rollback: revert the commit.

## Open Questions

(none)
