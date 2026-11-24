## Why

The phase 1 gap audit (T2, gaps M5 to M10) found that a person cannot install AW from one command: nothing places the sync engine, nothing checks for tmux, the npm package has `.ts` bins, a headless Mac cannot read its device key, the awd log grows with no limit, there is no setup check, the desktop app has no packaging config, and no release ships the Syncthing notices.

## What Changes

- New command `aw engine install`: it fetches the pinned Syncthing archive, checks its sha256 and writes `~/.aw/engine/syncthing`. `--archive <file>` installs from a local archive with the same check.
- `aw service install` installs the engine first, checks for tmux and prints the install command of the OS when tmux is missing, and restarts awd when the engine is new.
- The LaunchDaemon sets `AW_KEYSTORE=file`. `aw service install --headless` refuses when the device key is only in the Keychain. New command `aw service move-keys` moves the keys from the Keychain to `~/.aw/keys/`. The keystore default is `file` when `~/.aw/keys/device` exists.
- awd rotates `~/.aw/logs/awd.log` (the launchd log file): copy and truncate at 10 MB, 3 old files.
- New setup check: `GET /v1/doctor` (person route), `aw doctor`, and a desktop "Setup check" page with the Claude sign-in step and the AGT-14 plan text. It checks the service unit, the session host, the Claude login, disk, clock, the sync engine and the reach of each device, and on macOS sleep, restart after a power failure and FileVault. Each failure has a fix line.
- New `pnpm --filter @aw/daemon build`: tsc emits JS for awd, `aw` and the workspace packages that they use into one package folder (`daemon/dist/npm/`) with `contracts/schemas`, the engine pins, the plugin files and `THIRD_PARTY_NOTICES`. `task check` builds it and runs `aw --version` from it.
- Desktop packaging: `desktop/electron-builder.yaml` with `NSUserNotificationAlertStyle=alert`, the notices file, and sign and notarize hooks that do nothing without a certificate. New script `pnpm --filter @aw/desktop package`.
- New `THIRD_PARTY_NOTICES` (Syncthing: MPL-2.0 text, authors link, source tag), with a copy in the APK as a raw resource and a "Third-party notices" button on the phone's Devices screen. A check keeps the copies and the engine tag the same.
- Docs: `engineering-rules.md` release 5 (the npm package fetches the engine at install, it does not bundle it), `phase-1.md` 6.1 (install steps) and the keystore text, `architecture.md` 4.6.1 (LaunchDaemon keystore, log rotation, `aw doctor`), `AGENTS.md`.
- The leak check skips the `deprecated:` lines of `pnpm-lock.yaml` (a public package text with a contact address).

## Capabilities

### New Capabilities
- `setup-check`: the doctor checks of awd, the route, `aw doctor` and the desktop Setup check page.
- `install-packaging`: `aw engine install`, the tmux check of `aw service install`, the npm package build, the desktop packaging config and the third-party notices.

### Modified Capabilities
- `awd-service`: the Service units requirement (engine install, tmux check, LaunchDaemon keystore, move-keys) and the Logs requirement (rotation of awd.log).
- `device-identity`: the keystore default is `file` when `<AW_HOME>/keys/device` exists.

## Impact

- Code: `daemon/src/cli/` (new `service.ts`, `doctor.ts`; `run.ts` registration), `daemon/src/install/` (new), `daemon/src/service/doctor.ts`, `daemon/src/api/doctor-routes.ts`, `daemon/src/log-rotation.ts`, `daemon/src/units/units.ts`, `daemon/src/settings.ts`, `daemon/scripts/build.ts`, `shared/client/src/doctor.ts`, `desktop/` (SetupCheck page, calls, contract, electron-builder config, hooks), `android/app` (raw notices, Devices button), `scripts/` (notices check).
- API: new `GET /v1/doctor` in `contracts/openapi.yaml`.
- Dependencies: `electron-builder` 26.18 and `@electron/notarize` 3.1 (desktop dev dependencies, already in `docs/tech-stack.md`).
