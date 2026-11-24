## Why
The desktop app has no app icon (Electron shows its default icon), and the phone shows a placeholder "AW" in a blue circle, a color that the prototype palette does not have. The owner asked for a proper icon for both apps from the logo mark of the prototype (decision 45).

## What Changes
- One source drawing of the AW mark in the repository: `shared/ui/icons/aw-mark.svg` (an AW drawing of the prototype mark: a rounded square, split on the diagonal into a light and a gray half, with a square opening in the center).
- A script `scripts/icons.ts` (run with `pnpm icons:generate`) makes each icon from it with `sharp`:
  - the macOS app icon `desktop/resources/icon.png` (1024 px; electron-builder makes the `.icns` from it through `mac.icon`),
  - the menu bar (Tray) template image (32 px, black with alpha) in `desktop/src/main/tray-icon.ts`,
  - the Android adaptive icon: `ic_launcher_foreground.xml`, `ic_launcher_monochrome.xml` (vector drawables from the same path data) and the background color.
- A test checks that the committed icons are the output of the script for the current source.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `app-style`: the app icons of the desktop and the phone come from one source mark.

## Impact
- New dev dependency `sharp` in `@aw/scripts` (`allowBuilds: sharp: false`: it loads its N-API prebuild; its script only builds from source).
- `desktop/electron-builder.yaml` (`mac.icon`), `desktop/src/main/tray.ts`, `android/app/src/main/res/`.
- `docs/tech-stack.md` (the `sharp` row), `docs/design.md` (the icon).
