## Why

The phone is a remote control (principle 1). After android-engine, the app syncs the files and keeps the Room index, but it shows only a placeholder screen. The human cannot see the tasks, answer a gate, create a task, send a message, assign a task or add a credential on the phone. Push does not exist on the phone either, so a gate arrives only when the human opens the app.

## What Changes

- Replace the placeholder `MainActivity` with one adaptive Compose Material 3 app. The window size class selects the layout: a bottom bar and 1 pane (compact), a rail and 2 panes for Inbox and Tasks (medium), a rail with list and detail (expanded), and an expanded rail with a third thread pane for a task (large).
- Screens: Home ("Needs you" first, device and sync status, Sync now), Inbox (gate cards that the human acts on in place), Tasks (by stage, the Paused chip), Task detail (fields, raw thread, message box, gate cards), New task (the first message form), Devices (status, last heartbeat, engine state, the battery "Restricted" warning).
- Keyboard and mouse: hover, a right-click menu on task rows (the same menu as a long press), arrow keys, Enter, Esc, Ctrl+N (New task) and Ctrl+R (Sync now), listed in `onProvideKeyboardShortcuts`.
- Phone actions write events to the phone's own logs through one Kotlin event writer in `android/shared`: `gate.answered`, `message.sent`, `task.created`, a human `task.assigned`. Each write is followed by a targeted scan of the engine.
- Credential add: the phone seals the value to the computers into `devices/<phone>/sealed/<id>.age` through a `CredentialSealer` interface. identity-pairing is not on this branch yet, so the sealer is a TODO that the integration fills; the screen shows that the feature waits for it.
- Push receiver: UnifiedPush `connector` with the `embedded-fcm-distributor` (Web Push with VAPID; no Firebase config file is needed). One instance per computer with that computer's VAPID public key. The phone writes its endpoints and keys to `devices/<phone>/push.yaml`. A push wakes the engine for a short sync and shows a notification (title: task key + gate kind; a tap opens the task).
- New Gradle module `android/control`: the screen states, the gate rules, the actions, the push file and the push preview, with JVM tests (no Android SDK needed).
- New index queries in `android/shared`: all tasks, projects, devices, presence, issues, one document.

## Capabilities

### New Capabilities
- `android-app`: the phone app screens, the adaptive layout, keyboard and mouse, the phone actions, the credential outbox and the push receiver.

### Modified Capabilities
- `android-shared-model`: adds the Kotlin event writer of the phone's own logs and the index queries that the screens need.
- `repository-tooling`: "Android checks" also runs the JVM tests and detekt of `:control`.

## Impact

- Code: `android/app` (Compose UI, push service, manifest), new `android/control`, `android/shared` (writer, queries), `android/settings.gradle.kts`, `android/gradle/libs.versions.toml`, `android/Taskfile.yaml`, CI job `android`.
- New libraries (rows in `docs/tech-stack.md` 2.5): Compose BOM 2026.11.01, `activity-compose` 1.13.0, `material3-adaptive` 1.3.0, `material3-adaptive-navigation-suite` 1.5.0, Navigation 3 1.2.2, lifecycle 2.11.1, UnifiedPush `connector` 3.3.5 and `embedded-fcm-distributor` 3.1.0 (the doc rows said 2.5).
- File format: `devices/<phone>/push.yaml` gets a documented layout; computers publish their VAPID public key as `vapid_public_key` in their `bindings.yaml` (a loose key; task-loop adds it to the schema with the sender).
- Docs: `docs/phase-1.md` 8 and 10, `docs/tech-stack.md` 1.5 and 2.5, `AGENTS.md`.
