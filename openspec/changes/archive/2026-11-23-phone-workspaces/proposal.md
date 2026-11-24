## Why

A phone can join more than one workspace ("Join another workspace" on Devices), but the app shows only the first workspace and registers push only for it (gap M25, `prd.md` WS-01/02/05, RMT-02). The person does not see the tasks of the second workspace and gets no push for its gates. A test on the emulator also showed that the second join replaces the slug of the phone, so the first workspace shows the phone as offline.

## What Changes

- Add a workspace switcher to the phone app: the top bar shows the open workspace, and its menu lists each joined workspace with its "Needs you" count and "Join another workspace". It works at each width class.
- Keep the selected workspace in `<files>/selected-workspace`, so it stays after an app restart. After a join, the app opens the new workspace. A switch resets the back stack to the root of the open tab.
- Register push for every joined workspace, in the app process scope, also when no screen is open. A tap on a notification opens the workspace of the push and the task.
- Fix 2 push registration findings of the android-ui review: H2 (a new endpoint in a cold process is dropped) and M2 (a failed registration stays "registering" and registers again). Add the state "Push is off: the registration failed".
- A phone that has paired before joins another workspace with its stored slug. The pairing screen shows the slug and no name field then.

## Capabilities

### New Capabilities
- `android-workspaces`: the joined workspaces of the phone, the selected workspace and the switcher.

### Modified Capabilities
- `android-app`: "Push receiver" registers for each joined workspace, keeps the key of a cold endpoint, shows a failed registration, and the notification tap opens the workspace of the push.
- `android-pairing`: "Phone joins with a code" and "Pairing screen": a phone with an identity joins with its stored slug.

## Impact

- `android/control`: new `Workspaces.kt` and `PushRegistrations.kt` with JVM tests; `Push.kt`, `Screens.kt`, `WorkspaceModel.kt`, `PhonePairing.kt`.
- `android/app`: `AppGraph`, `AppViewModel`, `AwApp`, new `WorkspaceMenu`, `PairingScreen`, `PushRegistrar` (now the UnifiedPush adapter), `AwPushService`, `GateNotifications`, `MainActivity`.
- Docs: `docs/phase-1.md` 7.7, 8.2 and 10.7.
- No new dependency, no environment variable, no file format change (`push.yaml` stays the same). The new phone file `<files>/selected-workspace` is app-private.
