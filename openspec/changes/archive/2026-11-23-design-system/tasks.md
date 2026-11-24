## 1. Tokens and theme (`shared/ui`)

- [x] 1.1 Add `src/tokens.ts` with the dark and light tokens of `docs/design.md` 2, the font stacks and the radii; export it as `@aw/ui/tokens` and from `@aw/ui`.
- [x] 1.2 Map the tokens in `createAppTheme()`: palette (accent primary, surfaces, `aw` group, `action.focus`), typography, shape, component defaults of `design.md` Decision 3.
- [x] 1.3 Add a contrast test of the token pairs; update the theme test (accent, overline, ripple, focus ring, dialog paper). Break each new test once.

## 2. Window (desktop main)

- [x] 2.1 Add `src/main/window.ts` with `windowOptions(platform, dark)` and its test; use it in `src/main/index.ts` with `nativeTheme.shouldUseDarkColors`.

## 3. Renderer

- [x] 3.1 Add the font packages to `desktop/package.json` and import their CSS in `src/renderer/src/main.tsx`.
- [x] 3.2 AppShell: sidebar on `aw.canvas` with the macOS 44 px drag row, 28 px items, right-aligned counts, 72 px rail; top bar as a drag region with icon-only buttons below 600 px; main area on `surface`.
- [x] 3.3 Switch each icon import to its `Outlined` variant; chips to the tinted style.
- [x] 3.4 Fix the screens that break with the new theme (no per-screen colors).

## 4. Docs

- [x] 4.1 `docs/design.md` final; `docs/prd.md` RMT-09; `docs/tech-stack.md` Theme row and the font library rows.

## 5. Evidence

- [x] 5.1 `cd shared && task check`, `cd desktop && task check`, root `task check`.
- [x] 5.2 After screenshots with the seed (dark, light, 400 px, 1600 px) and the font check in `evidence/design-system/`.
