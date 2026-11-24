## Context

awd runs the official Syncthing binary on each computer and controls it through REST (`plugins/sync-syncthing`, `docs/phase-1.md` 6.1 to 6.6). The phone needs the same engine and the same rules, but Android has no official binary, no `syncthing generate` from a shell user, and kills background work in Doze. `docs/phase-1.md` 6.7 and `docs/tech-stack.md` 1.2 and 1.5 give the plan: `libawsync.so` built from the same tag with the recipe of `researchxxl/syncthing-android`, a child process with its home in app-private storage, an own Kotlin REST client, and one `specialUse` foreground service. The Kotlin shared module (`android/shared`) has the file model, the merge and the Room index.

Constraints:
- `task android:check` runs on a computer with no Android SDK (JVM tests, ktlint, detekt). So the engine logic must be testable on the JVM.
- No MPL-2.0 code of the fork enters AW (`docs/phase-1.md` 6.7.2). AW writes its own client.
- No built `.so` and no `google-services.json` in git.

## Goals / Non-Goals

**Goals:**
- A pinned, reproducible build of `libawsync.so` (arm64-v8a, x86_64) with one version file.
- A Kotlin engine controller with the awd rules: config before the first start, REST client, supervision with backoff, folders `tasks` and `knowledge`, peers, Sync now (60 s), the status of each peer, and the index refresh after each engine change.
- The Android app module: applicationId `com.agentworkspace.android`, the foreground service, the engine restart at each app open, the battery "Restricted" check.

**Non-Goals:**
- UI screens, pairing UI, push (android-ui and later tasks). The phone's own event writer (android-ui).
- Emulator and real-phone tests (final test phase).
- A CI job that builds the `.so` (release-pipeline).

## Decisions

1. **Two new modules.** `:engine` is a Kotlin Multiplatform library (targets `jvm()` and Android, like `:shared`). It holds the version file, the build script and all engine logic. `:app` (`com.android.application`) holds only the Android glue: the service, the launcher, the `LocalSocket` factory, the battery check. Reason: the logic runs in JVM tests on a computer with no SDK. Alternative: all code in `:app` (no JVM tests without the SDK).

2. **Version file `android/engine/engine-version.properties`** (key=value). Both the bash build script (`. file`) and Gradle (`java.util.Properties`) read it with no parser. It pins the Syncthing tag and the sha256 of `syncthing-source-<tag>.tar.gz` (the release tarball has the vendored modules and a `RELEASE` file, so the build needs no git and no module download), the Go version and the sha256 of each Go host archive, the NDK version, the min API of the clang target, and the sha256 of each built `libawsync.so`. Alternative: JSON like `engine.json` (bash would need `jq`).

3. **Build script `android/engine/scripts/build-libawsync.sh`.** Inputs: the work folder (Go, sources, Go caches) and the output folder. It downloads and checks the Go archive and the source tarball, finds the NDK (`ANDROID_NDK_HOME` or `$ANDROID_HOME/ndk/<version>`, checked against `source.properties`), and runs `go run build.go -goos android -goarch <arch> -cc <ndk clang> -no-upgrade build` with `CGO_ENABLED=1`, `EXTRA_LDFLAGS=-checklinkname=0`, `SOURCE_DATE_EPOCH=0`, `BUILD_USER=aw`, `BUILD_HOST=aw`, `-trimpath` through `build.go`. It copies the binary to `<out>/<abi>/libawsync.so` and compares each sha256 with the pin; an empty pin prints the value to record. The Gradle task `:engine:buildEngineLibs` runs it; `:app` packs `engine/build/jniLibs` (or the folder of the property `aw.engineLibsDir`) with `useLegacyPackaging = true`. The app build calls the task only when the libs are missing.

4. **Engine home and paths in app-private storage.** `filesDir/sync` (`STHOMEDIR`), REST socket `filesDir/run/sync.sock`, workspace folder `filesDir/aw/<workspace id>/{tasks,knowledge}`, peers `filesDir/sync-peers.json` (until identity-pairing, like awd). No `secure` folder on the phone.

5. **First start without `generate`.** The phone runs `libawsync.so generate --home=<home> --no-port-probing` and `device-id` like awd. The same template as awd with phone values: device name = the phone slug, listen `tcp://0.0.0.0:22300`, reconnect 20 s. `isAwConfig` accepts the socket address or the loopback fallback address. The Kotlin template and checks are a port of `plugins/sync-syncthing/src/config.ts`.

6. **REST client: Ktor with the OkHttp engine and a custom `SocketFactory`.** OkHttp connects each request through a `java.net.Socket` adapter over a Unix socket: on Android `android.net.LocalSocket` (filesystem namespace), on the JVM (tests) a JDK 21 `SocketChannel` with `UnixDomainSocketAddress`. The request host is a fixed name; the API key goes in `X-API-Key`. Reason: Ktor is the HTTP client of the tech stack; OkHttp accepts any socket factory. Alternative: Ktor CIO `unixSocket()` (needs `UnixDomainSocketAddress`, which Android does not have).

7. **Loopback fallback.** When the engine runs but its socket does not answer for 2 starts in a row (spike S3 not proven), the controller writes the GUI address `127.0.0.1:<free port>` with `tls="true"` and starts again. The client then uses HTTPS and trusts only the certificate in `<home>/https-cert.pem` (exact match), so no other app can pose as the engine.

8. **Supervisor on coroutines.** The waits are coroutine `delay`s and all times are in `SupervisorTiming`; the wall clock for the texts is the `TimeSource` of `android/shared`. The supervisor tests run in real time with times of 10 to 200 ms (the Ktor mock engine runs on its own threads, so virtual time would jump during a request). Health ping every 10 s, restart at once after an exit and after 3 failed pings, backoff 1 s to 60 s, stop with `destroy()` then `destroyForcibly()` after 10 s. States: `not_installed`, `starting`, `running`, `restarting`, `stopped`, `failed` (the awd values). One process: the controller sets `STMONITORED=1`, so the engine runs without its monitor process, and the supervisor is the monitor. A pid file `<home>/aw-engine.pid` and a check of `/proc/<pid>/cmdline` stop an engine that an earlier app process left (only a process whose command line has `libawsync.so` and the home).

9. **After each start** (port of `transport.ts` `#onEngineStart`): options (local discovery on, global discovery and relays from the community switch, NAT off, reconnect 5 s while the app is open, else 20 s), the device name, the peers, the folders (send and receive, `fsWatcherDelayS 1`, `maxConflicts 10`, no versioning on the phone), ignores `*.aw-tmp` and, in `tasks`, `/*/artifacts`. A config value is sent only when it differs. An engine device that is not in the peer list (removed while the engine was stopped) is deleted. A failed step is logged and tried again at the next health check; the engine keeps running.

10. **Index refresh.** An event loop reads `/rest/events/disk` (long poll). After a `RemoteChangeDetected` or `LocalChangeDetected` of a workspace folder, and once after each start, the refresher waits 500 ms for more events and then calls `MergeEngine.update()` and `WorkspaceIndex.write()` (the order of `android-shared-result.md`). A failed update is logged; the next one reads all files. The event cursor starts again after an engine restart.

11. **Sync now and status.** Sync now starts the engine when it does not run, scans each folder with the time that is left, and polls `/rest/db/completion` and `/rest/system/connections` every 250 ms until each peer is synced or 60 s pass. The synced rule and the texts ("Synced 12 s ago", "3 changes not synced to ubuntu-01 (offline)") are a port of `status.ts`.

12. **App glue.** `AwApplication` owns one `AppGraph` (manual DI, tech-stack 2.5). Activity callbacks count the started activities: 0 → 1 is "app opened" (restart the engine, reconnect 5 s), 1 → 0 is "app closed" (reconnect 20 s). `SyncEngineService` is a `specialUse` foreground service with a low-importance channel and the text "AW · syncing with N devices"; it runs while at least one workspace is set up. The battery check uses `ActivityManager.isBackgroundRestricted()`; the notification then says that sync stops in Doze, and its action opens the app details settings. No new library for lifecycle: the callbacks are in the platform.

13. **Firebase config.** The Gradle property `aw.googleServicesJson` names a local file. The task `:app:checkPushConfig` checks that the file exists and is outside the repository, so the file never enters git. android-ui applies the push code and the Google services plugin with this property.

14. **Logs.** Kermit 2.2 with the default log writer. The controller never logs the API key or a REST reply body of a successful call. The engine output goes to `filesDir/logs/sync-engine.log` (rotated at 10 MB before each start, 3 old files, like awd). The redacting log writer of `engineering-rules.md` 5.10 comes with the app logging of android-ui.

15. **Lint without the SDK.** `task android:check` runs detekt on the `:app` sources without type resolution (`:app:detektAll`). A build with the SDK runs Android Lint with `checkDependencies = true` and `warningsAsErrors = true`, which also checks the API levels of `:engine` and `:shared` against minSdk 29 (for example no `Path.of` or `Files.writeString`).

16. **Build host.** The Linux test server was not reachable during this task. The `.so` build and the APK build ran once on this Mac with a scratch SDK and NDK in a temporary folder (removed after the build). The script supports Linux and macOS hosts (x86_64 and arm64 Go archives).

17. **Opt-in contract test.** `RealEngineTest` runs the controller with a real Syncthing binary of the pinned tag when the Gradle property `aw.engineBinary` names one; `task check` skips it.

## Risks / Trade-offs

- [The Unix socket may fail on Android 17 (spike S3)] → loopback HTTPS fallback with the pinned engine certificate (decision 7); the emulator test of the final phase checks both.
- [`STMONITORED=1` changes how the engine restarts itself] → the supervisor restarts after each exit, also exit code 3 (restart request).
- [The `.so` sha256 pins come from one build] → reproducible-build settings; a second build on another computer in the final test phase must give the same sha256.
- [The `app` code compiles only with the SDK] → the full Android build runs on a computer with the SDK; on this Mac `task android:check` runs only ktlint and detekt (no type resolution) on `app`.
- [Play review of `specialUse` (S4)] → the fallback of `docs/phase-1.md` 6.7.6 stays possible: the controller does not depend on the service type.

## Migration Plan

New modules only. Rollback: remove `include(":engine", ":app")`.

## Open Questions

None blocking. The S3 result decides if the fallback stays.
