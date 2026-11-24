## ADDED Requirements

### Requirement: App icons from one mark
The desktop app and the phone app SHALL use icons made by `scripts/icons.ts` from the one source `shared/ui/icons/aw-mark.svg`: the macOS app icon (`desktop/resources/icon.png`, set as `mac.icon` of `electron-builder.yaml`), the menu bar template image, and the Android adaptive icon (foreground, background and monochrome layers). A test SHALL fail when a committed icon is not the output of the script for the current source.

#### Scenario: Changed mark
- **WHEN** a person changes `aw-mark.svg` and does not run `pnpm icons:generate`
- **THEN** the test of `@aw/scripts` fails and names the stale icon file

#### Scenario: Themed icon on Android 13
- **WHEN** the person turns on themed icons
- **THEN** the launcher shows the monochrome layer of the AW mark
