## 1. Source and generator
- [x] 1.1 Draw `shared/ui/icons/aw-mark.svg`
- [x] 1.2 Add `sharp` to `@aw/scripts`, `allowBuilds`, `docs/tech-stack.md`; add `scripts/icons.ts` and the root script `icons:generate`
- [x] 1.3 Add `scripts/icons.test.ts` (outputs match the committed files)

## 2. Outputs
- [x] 2.1 macOS icon `desktop/resources/icon.png` and `mac.icon`
- [x] 2.2 Tray template image in `desktop/src/main/tray-icon.ts`
- [x] 2.3 Android adaptive icon layers and the background color
- [x] 2.4 `docs/design.md`: the icon section

## 3. Checks
- [x] 3.1 Unit tests of `@aw/scripts` and `desktop`; break the icon test once
- [x] 3.2 Build the app folder with electron-builder (`--dir`) and check the `.icns` (10 sizes); the phone launcher shows in the emulator run of the last part
