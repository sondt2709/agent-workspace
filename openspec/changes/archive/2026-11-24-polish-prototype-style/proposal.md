## Why
The desktop app and the phone app mix two accents: the indigo of `docs/design.md` on primary buttons, links, tabs and the focus ring, and the yellow of the prototype on gate cards and gate buttons. The phone also takes its colors from the wallpaper (dynamic color) on Android 12 and later, so its accent is not known. The owner asked for one style, the prototype's yellow, on both apps (decision 45). The owner also asked for full-width option buttons on question gates, small phone components, and Markdown for Claude output in both apps (owner question Q15).

## What Changes
- The prototype palette becomes the one source of color. The accent tokens (`accent`, `onAccent`, `accentText`, `focus`) take the yellow of the prototype: `#F0B429` in the dark scheme and `#8F5200` in the light scheme, the same values as `you`. Indigo goes out of `@aw/ui/tokens`.
- The phone uses a fixed Material 3 color scheme from the same tokens, in dark and light. Dynamic color goes out.
- Question gates (desktop and phone) show one full-width button per option, stacked. The recommended option is the filled button. The other options are outlined. A description shows under its label. A multi-select question shows full-width toggles and "Send answers".
- The phone uses small components: buttons 36 dp high, text fields about 50 dp high, a smaller type scale. Touch targets stay at least 48 dp.
- The phone renders Markdown for Claude output with `com.mikepenz:multiplatform-markdown-renderer-m3`: gate details and Context, agent messages in Activity, approach versions. No raw HTML, no images from the network, links open in the system browser (https only).
- The desktop renders agent messages in Activity and the Context of a gate as Markdown too (it already uses `react-markdown` with `remark-gfm`; the Session tab stays raw).
- `docs/design.md` names the prototype palette as the reference.

## Capabilities

### New Capabilities
- `app-style`: one palette for the desktop app and the phone, question option buttons, compact phone components, Markdown for Claude output.

### Modified Capabilities
- `android-app`: the phone gate card shows its body as Markdown, not plain text.

## Impact
- `shared/ui` (tokens, theme), `shared/client/src/gates.ts` (`recommendedOption`), desktop renderer (`GateCard.tsx`, `GateParts.tsx`, `Thread.tsx`).
- `android/app` (theme, compact components, Markdown view, gate card), `android/control` (`GateTexts.recommended`), `android/gradle/libs.versions.toml`.
- `docs/design.md`, `docs/tech-stack.md`, `THIRD_PARTY_NOTICES`.
- No change to file formats, events or APIs.
