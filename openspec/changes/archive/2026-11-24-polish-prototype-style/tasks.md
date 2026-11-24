## 1. Palette
- [x] 1.1 Set the accent tokens of `shared/ui/src/tokens.ts` to the prototype yellow; update the contrast test and the theme test
- [x] 1.2 Remove other accent mixes in the desktop renderer (contained buttons with `color="warning"`, hex values, the text selection color)
- [x] 1.3 Replace the phone theme with a fixed Material 3 scheme from the same tokens (dark and light), no dynamic color
- [x] 1.4 Update `docs/design.md` 1 and 2.3 to name the prototype palette as the reference

## 2. Question option buttons
- [x] 2.1 Add `recommendedOption` to `@aw/client/gates` and `GateTexts.recommended` to `android/control`, with the same test cases
- [x] 2.2 Desktop: full-width stacked option buttons and full-width toggles in `GateCard.tsx` and `GateParts.tsx`; update the tests
- [x] 2.3 Phone: full-width stacked option buttons and toggles in `Components.kt` and `GateParts.kt`

## 3. Compact phone
- [x] 3.1 Add `Compact.kt` (Button, OutlinedButton, TextButton, OutlinedTextField) and a smaller type scale in `Theme.kt`
- [x] 3.2 Use the compact components in the screens (remove the Material 3 imports)

## 4. Markdown
- [x] 4.1 Desktop: agent messages in Activity and Context as `MarkdownText`; a test
- [x] 4.2 Phone: add the Markdown library (version catalog, `docs/tech-stack.md`, `THIRD_PARTY_NOTICES`) and `MarkdownText` with the https-only link handler
- [x] 4.3 Phone: gate body, Context, agent messages in Activity and approach versions as Markdown

## 5. Checks
- [x] 5.1 Unit tests of `shared/ui`, `shared/client`, `desktop`, `android/control`
- [x] 5.2 Build the APK on the Linux test server; a few screenshots (desktop dark and light; the phone screenshots come with the last part, in one emulator run)
