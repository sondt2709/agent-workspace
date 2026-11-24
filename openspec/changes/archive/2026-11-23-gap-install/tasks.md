## 1. Install and service

- [x] 1.1 `daemon/src/install/engine.ts`: `installEngine` (pins, sha256, `--archive`, refuse with `AW_SYNC_ENGINE` or an unknown platform) with tests
- [x] 1.2 `daemon/src/install/tmux.ts`: install command per OS from `/etc/os-release`, with tests
- [x] 1.3 `daemon/src/install/keys.ts`: the headless key check and `moveKeys`, with tests; settings default `file` when `keys/device` exists
- [x] 1.4 `units.ts`: `AW_KEYSTORE=file` in the LaunchDaemon, a restart command per unit kind; tests
- [x] 1.5 `daemon/src/cli/service.ts`: move the service commands out of `run.ts`, add the engine step, the tmux note, the restart, the headless key check and `aw service move-keys`; `aw engine install`; CLI tests
- [x] 1.6 `daemon/src/log-rotation.ts`: copy-and-truncate rotation and the 5-minute check in awd, with tests

## 2. Setup check

- [x] 2.1 `shared/client/src/doctor.ts`: reply schema and `DoctorClient` (export `./doctor`)
- [x] 2.2 `daemon/src/service/doctor.ts`: check builders and probes, with tests
- [x] 2.3 `daemon/src/api/doctor-routes.ts` (person route) and the registration in `app.ts`; route test; `pnpm api:generate`
- [x] 2.4 `daemon/src/cli/doctor.ts`: `aw doctor` with the local fallback and exit code; CLI test
- [x] 2.5 Desktop: `doctor` call (contract, channels, calls), `SetupCheck.tsx` page at `settings/setup`, link from Settings; renderer test

## 3. Packaging and notices

- [x] 3.1 Sibling entry helper for `.ts`/`.js` paths; `aw-launch` runs the JS entry when it exists
- [x] 3.2 `daemon/scripts/build.ts` with a temporary tsconfig (emit, import rewrite, package.json, assets, `--link-deps`), with unit tests of the rewrite; `build` script; Taskfile builds and runs `aw --version`
- [x] 3.3 `THIRD_PARTY_NOTICES`, the APK raw copy, the Devices button, and the notices check in `scripts/`
- [x] 3.4 Desktop: `electron-builder` and `@electron/notarize` dev dependencies, `electron-builder.yaml`, `scripts/notarize.mjs`, `scripts/notices.ts`, `package` script, config test

## 4. Docs and checks

- [x] 4.1 Update `docs/engineering-rules.md` (release item 5), `docs/phase-1.md` 6.1, `docs/workflow.md` commands if listed, `AGENTS.md` commands and status lines
- [x] 4.2 `task check` green (JAVA_HOME), leak check
