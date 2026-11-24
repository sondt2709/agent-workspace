## 1. Shared module

- [x] 1.1 Index queries: all tasks, projects, devices, presence, issues, one document (+ test)
- [x] 1.2 `NioWorkspaceWriter` (append with the newline rule, atomic write) and `EventWriter` (envelope, UUIDv7, HLC, validation, path rule, 64 KiB) (+ tests)

## 2. Control module

- [x] 2.1 Gradle module `:control` (KMP jvm + Android), in `settings.gradle.kts`, `android:check` and CI
- [x] 2.2 `WidthClass`, `Route`, `Navigator` (tabs, push stack, Esc/Back), `Shortcuts` (+ tests)
- [x] 2.3 Screen states: Home, Inbox, Tasks by stage with the Paused chip, Task detail, Devices; gate card rules; time texts (+ tests)
- [x] 2.4 `WorkspaceModel` (snapshot from the index after each refresh) and `PhoneActions` (answer, message, create, assign) with the scan and refresh hooks (+ tests)
- [x] 2.5 `CredentialSealer`, `PendingSealer`, `CredentialOutbox` (+ tests)
- [x] 2.6 Push: `PushRegistry` (`push.yaml`, VAPID keys from `bindings.yaml`), `PushPreview` (+ tests)

## 3. App module

- [x] 3.1 Gradle: Compose, adaptive, Navigation 3, lifecycle, UnifiedPush; manifest (configChanges, touchscreen, push service, notification channel)
- [x] 3.2 Theme, `AppViewModel`, `MainActivity` with `NavigationSuiteScaffold` and `NavDisplay` + `ListDetailSceneStrategy`, shortcuts
- [x] 3.3 Screens: Home, Inbox, Tasks, Task detail (thread, message box, gate cards, assign), New task, Devices, Add credential
- [x] 3.4 Push service, notification, open from a tap; registration per computer
- [x] 3.5 Compile `:app` with a scratch SDK (`assembleDebug`, `lintDebug`)

## 4. Docs and checks

- [x] 4.1 Docs: `docs/phase-1.md` 8 and 10, `docs/tech-stack.md` 1.5 and 2.5, `AGENTS.md`
- [x] 4.2 `task check` green; archive the change; one commit
