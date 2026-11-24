# Decision: devices, roles and sync

| Item | Value |
|---|---|
| Date | 2026-11-22 (updated the same day with the device roles and the priority rule) |
| Status | Accepted by the product owner. This file replaces any older text about device roles, conflicts and task keys. |
| Updated | Updated after the verification on 2026-11-22 (conflict copy name, `maxConflicts`, Undo, Syncthing folders), then for the stage names and the editable task fields of the task-model decision. On 2026-11-23, device roles item 3 and Sync item 10 changed by `2026-11-23-manual-move.md` (no automatic move). |
| Replaces | "The home server is the only writer of the event log" (architecture v0.3, ADR-03) |
| Principles | 2, 5 in `../principles.md` |
| Related | `2026-11-22-phases.md`, `2026-11-22-relay-transport.md` (phase 2 live path), **`2026-11-22-task-model.md` (task fields, ready to implement, workflow independence, credentials: read it too)** |

## Device roles
There are 3 roles. The UI and the documents use these names.

| Role | Example | Create tasks | Implement (run agents) | Notes |
|---|---|---|---|---|
| **local** | MacBook Pro | Yes | Yes | The main device. The user installs AW here first. AW works with this device only. |
| **remote** | ubuntu-01 (24/7) | Yes (its agents create tasks and subtasks) | Yes, **default** | Optional. When it exists, new tasks run here by default. |
| **mobile** | Pixel 9 | Yes | No | A remote control: create tasks, answer gates, read results. |

1. A person has exactly 1 local device and 0 or more remote devices. A second laptop is a remote device (it is not always on).
2. With no remote device, the local device implements.
3. A remote device can be down for many reasons. Each project has an ordered list of devices that implement, for example ubuntu-01, MacBook Air, then MacBook Pro (local). When a device is offline, its tasks wait: a running task shows "Paused: ubuntu-01 offline", and queued tasks stay. AW never moves a task by itself. The human can assign the task to an agent on another device; that device continues from the last pushed step, because the agent pushes its work branch at each step (`2026-11-23-manual-move.md`).
4. Agents can create tasks and subtasks, for example after the human approves an approach. The human assigns each new task to an agent and a device. Then AW starts it.
5. Priority among remote devices follows the order in the device list (default: pairing order).
6. Across networks, devices use Syncthing's public discovery and relay servers by default, with a switch to turn them off. The traffic stays end-to-end encrypted (TLS between the two devices, which check each other's device id). A relay sees the device ids, the IP addresses and the amount of traffic, and it is slower than a direct connection. A person can run their own relay and discovery server later.

## Sync
1. **The AW folder is a separate folder**, for example `~/AW/`. It is never inside a code checkout. So a `.git` folder is never inside the synced folder. Each workspace has 3 Syncthing folders: `tasks` and `knowledge` on all devices, and `secure` (credentials and test server configuration) on local and remote only.
2. **Code does not go through AW sync.** Code goes through git and the code host (for example GitHub). Each implementing device has its own checkout of each project.
3. **Phase 1 transport: built-in Syncthing** between the person's own devices. Phase 2 adds Cloudflare R2 and the relay. Phase 3 adds Google Drive. Each transport is a plugin with the same interface, and the file layout stays the same (`2026-11-22-phases.md`).
4. **Each device writes only its own log files** (`tasks/<task-id>/log/<device>.jsonl`). Task folders use the internal id, never the key. Devices merge the logs in a fixed order: hybrid logical clock time, then device id.
5. **Ownership rules:**
   | Data | Rule |
   |---|---|
   | Task stage (Backlog … Done) and state | Only the device that runs the session of the task changes it. |
   | Gate answer | Any device can send it. The session device uses the first answer that it receives and writes "resolved". A later answer becomes a comment. |
   | Comment | Only added, never changed. |
   | Title, priority, and the first message until the first session starts | The newest edit wins, per field. |
   | Test slot lease | The device that has the resource gives it out. |
6. **Priority for shared files: local > remote > mobile.** The priority applies only when two devices changed the same file since the last sync. Otherwise the newer change wins. When it applies, the version of the device with the higher priority wins. AW overwrites the other version. AW makes no backup file and shows no conflict copy.
   - Syncthing itself keeps the newer file and makes a `.sync-conflict` copy with the older content. The short device id in the copy name is the device whose version won, not the author of the copy. AW finds the author from a sha256 journal of its own writes. AW removes that copy at once and keeps the version of the higher-priority device. The highest-priority online device does this, so that two devices do not undo each other.
   - `maxConflicts` stays at 10 or more. With 0, Syncthing deletes the older edit with no copy.
   - To lose less work, agents write each learned item to its own new file.
   - Undo uses a hidden version history on each computer, outside the AW folder: Syncthing "simple" file versioning keeps what another device changed or deleted, and AW copies a file before it changes it locally. It never shows as files in the AW folder.
7. **Task keys (AW-7):** each device takes the next free number that it knows. When two devices take the same number at the same time, the device with the higher priority (local > remote > mobile) keeps it. The other task gets the next free number, and the task thread shows the change. Links between tasks use the internal id, so they do not break.
8. **Sync before implement.** Before an agent starts to implement on a device, these must be synced to that device: the knowledge (workspace and project), the credentials for the task, and the test server configuration. AW checks the `knowledge` and `secure` folders. The task shows "Waiting for sync: knowledge 92 %" until they are complete. AW can check only what the online devices have. A change on a laptop that went to sleep before it synced does not arrive. "Sync now" before the laptop sleeps prevents this.
9. **Credentials and test server configuration are files in phase 1** (`secure/test-servers.yaml` and `secure/credentials/`). The `secure` folder syncs only to local and remote, never to mobile. Credentials are project test accounts and API keys. They are encrypted on disk with a key in the keystore of each device. The agent gets them only when its session starts, never in the knowledge. The Claude login is never a file in the AW folder and never syncs. Each device signs in to Claude itself.
10. **Sync now.** Besides the automatic sync, the desktop app has a "Sync" button ("Sync now" in menus). It syncs and shows the result, for example "Synced 12 s ago" or "3 changes not synced". AW also syncs when the laptop goes to sleep or shuts down, when the OS allows it. A laptop closed without a sync is the user's own mistake: AW suggests no move (`2026-11-23-manual-move.md`).

## Open items
1. Storage access per device in phase 2 (an R2 token for one folder is not verified).
2. Storage request cost of the polling interval, for R2 (phase 2) and Google Drive (phase 3).
