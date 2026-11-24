## Context
The prototype draws its logo with CSS: a 6 px rounded square with a 135° hard gradient (the `text` color, then `text3`) and a 2 px rounded square in the window color at the center. The app icon of the prototype puts that mark on a dark tile. The desktop has no icon file; the Tray uses a 32 px ring. The phone has a vector "AW" on blue.

## Decisions
1. **Source.** `shared/ui/icons/aw-mark.svg`, 24 × 24, two `<path>` elements with the same outline (a rounded square with a square opening, `fill-rule="evenodd"`): the gray half, and the light half clipped to the upper-left triangle. Only paths and one clip path, so the same path data goes into an Android vector drawable with no converter.
2. **Generator.** `scripts/icons.ts` in `@aw/scripts` (the repo-wide tools): it writes into `desktop/` and `android/` but imports nothing from them. `sharp` 0.35 renders the SVG to PNG (Apache-2.0, about 170 million npm downloads per week (2026-11-22), N-API prebuilds). Alternatives: `@resvg/resvg-js` (MPL-2.0, fails 4.9.1; no stable release in 6 months); `iconutil` (macOS only, not a library).
3. **macOS icon.** A 1024 px PNG: the macOS icon grid (an 824 px rounded tile with a 185 px radius at 100 px), a dark gradient tile (`overlay` to `surface`), a 1 px light line, and the mark at 440 px. `mac.icon: icon.png` in `electron-builder.yaml`; electron-builder makes the `.icns` from it (it does this for a PNG of at least 512 px).
4. **Tray.** A 32 px template image (black with alpha; the gray half at 50 % alpha), so macOS colors it for the menu bar. The script writes the base64 PNG to `desktop/src/main/tray-icon.ts`; the main process reads no file.
5. **Android.** `minSdk` is 29, so each device uses the adaptive icon of `mipmap-anydpi`; legacy PNG sizes would never show and are not made. Foreground: the mark at 46 dp in the 108 dp canvas (inside the 66 dp safe circle). Background: `surface` dark (`#0F1011`). Monochrome: the mark in one color, the gray half at 50 % alpha (themed icons of Android 13).
6. **Check.** `scripts/icons.test.ts` runs the generator in memory and compares each output with the committed file, so a change of the source without a new run fails the check.

## Risks / Trade-offs
- `sharp` output can differ between versions by a few bytes → the test compares the vector files and the tray PNG; the 1024 px PNG is compared by its decoded pixels with a small tolerance.
