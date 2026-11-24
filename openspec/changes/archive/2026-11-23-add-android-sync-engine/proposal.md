## Why

The AW Android app must sync the workspace files with the computers of the person. It must use its own built-in Syncthing engine, never a Syncthing app that the user installed (`docs/phase-1.md` 6.7, decision `2026-11-22-approved-defaults.md` item 3). The shared Kotlin module (file model, merge, index) exists, but no Android code builds, starts or controls the engine yet.

## What Changes

- New Gradle module `android/engine`: the version file of the Android engine (Syncthing tag, source sha256, Go version and sha256, NDK version), the build script that makes `libawsync.so` for arm64-v8a and x86_64 with the recipe of `docs/tech-stack.md` 1.2, and a Gradle task that runs it.
- In the same module, the Kotlin engine controller (JVM and Android targets, JVM tests): the `config.xml` template before the first start (the same settings as awd, phone values), the engine home preparation, the REST client (Ktor, OkHttp engine) over a Unix socket with a fallback to HTTPS on `127.0.0.1` with the pinned engine certificate, the supervisor (start, health check, restart with backoff, stop), the folder and peer setup (`tasks` and `knowledge`, never `secure`), Sync now, the status of each peer, and the index refresher (shared `MergeEngine` and `WorkspaceIndex` after each engine change).
- New Gradle module `android/app` (first part): applicationId `com.agentworkspace.android`, the `specialUse` foreground service with a permanent notification while the engine runs, the process launcher of `libawsync.so`, the Unix socket factory on `LocalSocket`, a restart of the engine each time the app opens, the battery "Restricted" check, and the Gradle property for a local Firebase config file (the file is never committed).
- `task android:check` also lints and tests the new modules on a computer with no Android SDK.
- Docs: `docs/phase-1.md` 6.7, `docs/tech-stack.md` 1.2, 1.5 and 2.5 (new rows), `AGENTS.md`.

## Capabilities

### New Capabilities
- `android-sync-engine`: the Android engine build and pins, the engine controller on the phone (config, REST client, supervision, folders, Sync now, status, index refresh), the foreground service, the start at app open and the battery check.

### Modified Capabilities
- `repository-tooling`: `task android:check` covers the `engine` and `app` modules.

## Impact

- New code in `android/engine/` and `android/app/`; `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle/libs.versions.toml`, `android/Taskfile.yaml`.
- New libraries from the tech-stack table: Ktor client 3.6 (OkHttp engine, `ktor-client-mock` in tests), Kermit 2.2, AndroidX core 1.19.
- The full Android build (`assembleDebug`) and the `.so` build need the Android SDK and NDK; they run on the Linux test server, not in `task check`.
- No change to awd, the local API or the file format.
