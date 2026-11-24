## ADDED Requirements

### Requirement: Engine install command
`aw engine install` SHALL fetch the pinned engine archive of this platform, check its sha256 against the pins, and write the binary to `<AW_HOME>/engine/syncthing` (mode 0755). `--archive <file>` SHALL use a local archive with the same check. A binary of the same pin SHALL stay. The command SHALL refuse when `AW_SYNC_ENGINE` is set or when AW ships no engine for the platform.

#### Scenario: Wrong archive
- **WHEN** `aw engine install --archive <file>` gets an archive with another sha256
- **THEN** the command exits with 1, the error names both sha256 values, and no binary is written

### Requirement: Third-party notices
The repository SHALL have `THIRD_PARTY_NOTICES` with the Syncthing section: the tag of the engine pins, the MPL-2.0 text, and the links to the source tag and its AUTHORS file. The npm package folder SHALL ship it. The desktop app SHALL ship it with the list of the JavaScript packages of its bundle and their license texts, made at package time. The Android app SHALL ship an equal copy as the raw resource `third_party_notices` and SHALL open it from the Devices screen. A check SHALL fail when the copy differs or when the tag differs from the engine pins of the computers or of Android.

#### Scenario: Old tag
- **WHEN** the engine pins name `v2.1.8` and `THIRD_PARTY_NOTICES` names `v2.1.7`
- **THEN** the notices check fails and names both tags

### Requirement: npm package build
`pnpm --filter @aw/daemon build` SHALL write a package folder `daemon/dist/npm/` with JS only: awd, `aw`, `aw-hook`, `aw-statusline`, `aw-launch` and each workspace package that they import, in the folder layout of the repository, with each `@aw/*` import rewritten to a relative path, a `package.json` with the `aw` and `awd` bins and the exact third-party runtime dependencies, `contracts/schemas`, the engine pins, the plugin files of `agent-claude`, `LICENSE` and `THIRD_PARTY_NOTICES`. No test file and no `.ts` file SHALL be in the folder. `task check` SHALL build it and run `aw --version` from it.

#### Scenario: Version from the build
- **WHEN** the build ran and `node daemon/dist/npm/daemon/src/bin/aw.js --version` runs with the linked dependencies
- **THEN** it prints the version of `daemon/package.json`

### Requirement: Desktop packaging config
`desktop/electron-builder.yaml` SHALL set `NSUserNotificationAlertStyle` to `alert` in `Info.plist`, ship `THIRD_PARTY_NOTICES` as an extra resource, use the hardened runtime, and run an `afterSign` notarize hook. The hook SHALL do nothing when the platform is not macOS or when `APPLE_API_KEY`, `APPLE_API_KEY_ID` or `APPLE_API_ISSUER` is missing. `pnpm --filter @aw/desktop package` SHALL build the app with electron-builder.

#### Scenario: No certificate
- **WHEN** the notarize hook runs on macOS with no `APPLE_API_KEY`
- **THEN** it returns without a call to the notarize service
