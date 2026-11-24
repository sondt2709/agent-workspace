## 1. Control logic (android/control)

- [x] 1.1 Add `Workspaces.kt`: `WorkspaceSelectionStore`, `WorkspaceSwitcher` (`workspaces`, `selected`, `select`, `refresh`, `joined`) and `WorkspaceEntry` with names and "Needs you" counts
- [x] 1.2 Add the workspace name to `WorkspaceSnapshot` (from `tasks/workspace.yaml`)
- [x] 1.3 Add `PushRegistrations.kt` with the port `PushConnector`, `PushState` (with `FAILED`), the combined state, one lock, `follow()` over the joined workspaces, the H2 key order and the M2 failed set
- [x] 1.4 `PhonePairing`: join with the stored slug on a phone with an identity; `workspaceId` in `PairingStatus`; `PhonePairing.storedSlug()` for the screen
- [x] 1.5 JVM tests: `WorkspacesTest`, `PushRegistrationsTest`, the second-join test in `PhonePairingTest`; break the code once for each new test

## 2. App (android/app)

- [x] 2.1 `PushRegistrar` becomes the UnifiedPush adapter of `PushConnector`; `AppGraph` starts `follow()` in its scope and owns the switcher
- [x] 2.2 `AppViewModel` uses the selected workspace, `switchWorkspace`, `openFromPush(workspace, task)`, the selection after a join
- [x] 2.3 `WorkspaceMenu.kt`: the top bar switcher with the menu; `AwApp` uses it
- [x] 2.4 `GateNotifications` and `AwPushService` carry the workspace; `MainActivity` opens it
- [x] 2.5 `PairingScreen` shows "This phone joins as <slug>" on a paired phone; Devices shows the failed push state

## 3. Docs and checks

- [x] 3.1 Update `docs/phase-1.md` 7.7, 8.2 and 10.7
- [x] 3.2 `task android:check` with JDK 21 passes; `openspec validate --strict`

## 4. End to end on an Android emulator on the Linux test server

- [x] 4.1 Build the APK of the final tree on the Linux test server and run the journey: pair, join, switch, restart, push from each workspace, notification tap
- [x] 4.2 Screenshots at phone width and in a wide window; evidence in `evidence/phone-workspaces/after/`
