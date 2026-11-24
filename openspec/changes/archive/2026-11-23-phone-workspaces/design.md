## Context

The phone keeps each joined workspace in `<files>/aw/<workspace id>/` (`SyncEngineController.workspaces()`). `AppGraph` has one `WorkspaceGraph` per workspace (index, model, writer, actions). `AppViewModel` takes `workspaces().firstOrNull()` and shows only that snapshot. `PushRegistrar.update(snapshot)` runs only from that snapshot, in `viewModelScope`, so only while a screen is open.

An emulator run on the base commit `81baa6e` (an Android emulator on the Linux test server, awd with 2 workspaces) showed 3 defects: the second workspace never shows; it gets no `push.yaml`, so its gates give no push; and the second join overwrote `<files>/device-slug` with the prefilled phone model, so the first workspace shows its own phone as offline.

The android-ui review lists 2 push registration findings in the code that this change rewrites: H2 (an endpoint in a cold process is dropped) and M2 (a failed registration stays "registering").

## Goals / Non-Goals

**Goals:**
- Show each joined workspace and let the person switch, at each width class.
- Keep the selected workspace after an app restart.
- Register push for each joined workspace, also with no screen open, and open the right workspace from a notification.
- Fix H2 and M2 with tests.
- Keep the slug of the phone the same in each workspace.

**Non-Goals:**
- Per-workspace folder scoping of the peers (N13).
- Create, rename or remove a workspace on the phone; the community switch on the phone.
- The other findings of the reviews (fix phase), except the part of M1 that the new lock covers.

## Decisions

1. **Switcher logic in `android/control` (`Workspaces.kt`), screens in `android/app`.** The JVM tests run without the Android SDK, as for the other screen logic. `WorkspaceSwitcher(joined: () -> List<String>, store: WorkspaceSelectionStore)` has `workspaces` and `selected` (`StateFlow`), `select(id)`, `refresh()` and `joined(id)`. Alternative: state in `AppViewModel`; rejected, because it cannot be tested on the JVM and the push registrar needs the list without a view model.
2. **The selected id in a plain file `<files>/selected-workspace`**, written atomically (temp file, then move), like `device-slug`. The code uses `Files.readAllBytes` and `Files.write`: Android (minSdk 29, and API 34 in the test) has no `Files.readString` or `Files.writeString`. The emulator run found this; the JVM tests cannot. Alternative: DataStore; rejected, because it is a new library for one value.
3. **A stored id that is not joined falls back to the first workspace (sorted by id), and the file is not changed.** If the folder comes back, the selection comes back too.
4. **After a join the app selects the new workspace.** `PairingStatus` gets `workspaceId`. The person just asked for that workspace.
5. **A switch resets the back stack to the root of the open tab** (`Navigator.select(tab)`). A task route of another workspace is not valid there.
6. **Switcher UI = the top bar title at each width class.** A text button with the workspace name and a drop-down icon opens a `DropdownMenu`: each workspace with a check on the selected one and its "Needs you" count, then "Join another workspace". The bottom bar, the rail and the drawer keep the tabs. The menu items are focusable, so a keyboard and a mouse work. Alternative: a workspace list in the drawer only; rejected, because the bar and the rail have no space for it.
7. **Push registration moves to `android/control` `PushRegistrations` on a port `PushConnector`** (`register`, `unregister`, `useDistributor`, `distributor`). The app class `PushRegistrar` is the UnifiedPush adapter plus `wake()`. `PushRegistrations.follow(workspaces, snapshot, scope)` collects the snapshot of each joined workspace (`flatMapLatest` over the id list, `merge` of the snapshot flows) and calls `update` for each. `AppGraph` starts it in its own scope at process start.
8. **One lock** (`Mutex`) for `update`, `onEndpoint`, `onUnregistered` and `onFailed`; the file work runs on the IO dispatcher of the caller, and an `IOException` is logged, not thrown.
9. **H2:** `onEndpoint` takes the VAPID key from, in order: the key that this process asked for, the existing `push.yaml` entry of that computer, the key of a reloaded snapshot. With no key it logs "The endpoint of <computer> in <workspace> has no VAPID key: dropped".
10. **M2:** `onFailed` keeps the instance and its key in a `failed` set and sets the state of that workspace to `FAILED`. `update` does not register a failed instance again with the same key in this process. A new key registers again.
11. **Combined push state** over the workspaces: `NO_DISTRIBUTOR` if any workspace has it, else `FAILED` if any, else `REGISTERING` if any, else `ON` if any, else `WAITING_FOR_COMPUTERS`. Devices shows one line.
12. **Notification extra `EXTRA_WORKSPACE`** from the instance name. `MainActivity` calls `openFromPush(workspace, task)`: select the workspace when it is joined, then `[Inbox, Task(id)]`.
13. **Stored slug on a later join:** `PhonePairing.join` uses `store.slug()` when the phone has an identity and a slug, and ignores the typed name. The request takes the `name` of the own record of a joined workspace, so each workspace shows the same name ("Pixel 9"). The pairing screen shows "This phone joins as <slug>" instead of the name field. The coming fix of review finding 1 (user id from the master key, refuse another master key) stays possible, because it adds checks before this step.

## Risks / Trade-offs

- [2 instances of one computer share one VAPID key (one per workspace)] → the embedded FCM distributor gives one endpoint per instance; the e2e test checks a push from each workspace.
- [The snapshot of a workspace loads async after a cold start] → `follow` skips a snapshot with `loaded = false`; `onEndpoint` reads `push.yaml` first (decision 9).
- [A workspace removed from the engine keeps its instances registered] → removal is out of scope (revoke task); `follow` stops collecting it.
- [The selection file can name a removed workspace] → fallback of decision 3.

## Migration Plan

No migration. A phone with one workspace has no selection file; the switcher selects its only workspace. A phone whose slug changed on the base build keeps the changed slug; such a phone pairs again (test builds only).

## Open Questions

None.
