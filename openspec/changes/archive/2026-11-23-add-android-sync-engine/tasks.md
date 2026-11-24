## 1. Engine build and pins

- [x] 1.1 Add `android/engine/engine-version.properties` (tag, source sha256, Go version and host sha256s, NDK version, min API, `.so` sha256 pins)
- [x] 1.2 Add `android/engine/scripts/build-libawsync.sh` (Go and source download with sha256 check, NDK version check, build for arm64-v8a and x86_64, sha256 compare or print)
- [x] 1.3 Add the `:engine` Gradle module (KMP `jvm()` + Android library) and the task `:engine:buildEngineLibs`
- [x] 1.4 JVM test: the Android tag equals the tag of `plugins/sync-syncthing/engine/engine.json`, and each pin has the right form

## 2. Engine controller (`:engine`, JVM tests)

- [x] 2.1 Config template, `readConfigText`, `isAwConfig` (socket and loopback), engine home preparation through a command runner
- [x] 2.2 REST client on Ktor (OkHttp) with reply checks; Unix socket `SocketFactory` adapter (JDK channel on the JVM); loopback HTTPS with the pinned certificate
- [x] 2.3 Supervisor: launcher interface, clock interface, states, health ping, restart with backoff, stop, stale engine check, socket-to-loopback fallback
- [x] 2.4 Engine setup after each start: options, device name, peers, folders, ignores; reconnect 5 s / 20 s; peers file
- [x] 2.5 Sync now and peer status (port of `status.ts`)
- [x] 2.6 Event loop and index refresher (`MergeEngine.update()` + `WorkspaceIndex.write()`)
- [x] 2.7 `SyncEngineController`: one entry point for the app (start, restart on open, app closed, stop, sync now, status, add/remove peer, add workspace)
- [x] 2.8 JVM tests for 2.1 to 2.7 (fake launcher, fake clock, Ktor mock engine, a Unix socket server for the adapter, real merge and in-memory index)

## 3. Android app (`:app`)

- [x] 3.1 Gradle module `com.android.application`, applicationId `com.agentworkspace.android`, jniLibs from the engine build, `useLegacyPackaging = true`, property `aw.googleServicesJson` check
- [x] 3.2 `AwApplication` + `AppGraph`, app open/close by activity callbacks, engine restart at open
- [x] 3.3 `LocalSocket` socket factory, process launcher of `nativeLibraryDir/libawsync.so`
- [x] 3.4 `SyncEngineService` (`specialUse`, permanent low-importance notification, battery "Restricted" warning), manifest
- [x] 3.5 Minimal `MainActivity` that shows the engine state (screens come in android-ui)

## 4. Repository and docs

- [x] 4.1 `android:check` covers `:engine` and `:app` (Spotless targets, detekt tasks); Taskfile entry `android:engine-libs`
- [x] 4.2 Docs: `docs/phase-1.md` 6.7, `docs/tech-stack.md` 1.2 / 1.5 / 2.5 rows, `AGENTS.md`
- [x] 4.3 `task check` green; compile `:app` and build the `.so` once with a scratch SDK and NDK, then remove them
