## Context
The prototype (local only) has one dark-first palette. Its status colors (run, you, wait, ok, err) and its surfaces are already the tokens of `@aw/ui/tokens`. The prototype marks the actions that need the person with its yellow (`you`). `docs/design.md` 2.3 added an indigo accent for primary buttons, links, the tab mark and the focus ring. The phone theme has its own blue fallback and dynamic color.

## Goals / Non-Goals
Goals: one accent on both apps, the prototype's yellow; the same values on desktop and phone; contrast that passes the token test; full-width option buttons; small phone components; safe Markdown on the phone.
Non-goals: new screens, a new layout, a change of the status colors or the surfaces.

## Decisions
1. **Accent = the prototype yellow, same value as `you`.** Dark `#F0B429` with text `#1A1200` (9.9:1). Light `#8F5200` with white text (6.5:1); `#8F5200` is also readable as text on white, so links, the tab mark, M3 text buttons and the focus ring use it. Reason: a light yellow fill (`#F0B429`) fails as text and as a focus ring on white (1.9:1). One hue for the accent and "Needs you" is the prototype's own rule: the person's next action is yellow. Alternative: the inverted neutral button of the prototype; rejected because the owner asked for the yellow.
2. **No dynamic color on the phone.** A wallpaper color would bring back a second accent.
3. **Recommended option.** The first option whose label contains "(Recommended)" (any case), else the first option. Claude Code puts "(Recommended)" in the label of AskUserQuestion. One helper in TypeScript (`recommendedOption`) and in Kotlin (`GateTexts.recommended`), with the same test cases.
4. **Option buttons.** Full width, stacked, left-aligned text, the label in body-strong and the description under it in meta size. The recommended option is filled with the accent; the others are outlined. An option that needs a comment (Request changes, Deny) stays outlined. A multi-select option is a full-width toggle: outlined, with a check mark and the accent border when picked.
5. **Compact phone.** Local wrappers `Button`, `OutlinedButton`, `TextButton` and `OutlinedTextField` in `android/app/.../ui/Compact.kt` with the same names as Material 3, so the screens keep their call sites. Buttons: 36 dp min height, 16 dp side padding, `labelLarge` 13 sp. Text fields: the value-based Material 3 `OutlinedTextField` with `bodyMedium` (13 sp) and `heightIn(min = 48.dp)`, which turns off its 56 dp default minimum: about 50 dp with one line. A state-based field (`TextFieldState`, which has a `contentPadding`) with a bridge to the `value` of the screens dropped fast input in the emulator run, so it was not kept. The Material 3 minimum touch size (48 dp) stays on.
6. **Phone Markdown library.** `com.mikepenz:multiplatform-markdown-renderer-m3` 0.46.0 (Apache-2.0, maintained since 2021, releases each month, Kotlin 2.4.21 and Compose 1.12 like the app, GFM tables). Checked against `docs/engineering-rules.md` 4.8 to 4.12. Alternative: compose-richtext; fewer releases and no Material 3 artifact. Safety: the library draws Compose text, so no HTML or script runs; it loads no image without an image transformer (the app gives none); a `UriHandler` opens only `https://` links with `ACTION_VIEW`.
7. **Desktop Markdown scope.** Agent messages in Activity and Context use `MarkdownText`; the Session tab shows the raw text (principle 8). The clamp of 6 lines stays: the head of a long message renders as Markdown.

## Risks / Trade-offs
- A yellow accent on many buttons weakens "Needs you" as a signal → status chips keep their icon and text, and the theme keeps only one filled button for each view.
- Shadowing Material 3 names in the `ui` package can surprise a reader → `Compact.kt` has a header comment, and the imports of the Material 3 versions go out of the screens.
- The Android app does not compile on this Mac (no Android SDK) → build the APK on the Linux test server once.
