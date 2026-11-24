## Why

The desktop app does not look like a native Mac app. A UI/UX review of each screen against the phase 1 prototype confirms it: a separate system title bar above the app top bar, filled icons, no bundled font, grey dialogs, floating labels, a solid indigo fill as the keyboard focus, and two chip styles. The next UX journeys (task view, create flows, navigation) need one design system first.

## What Changes

- New `docs/design.md`: the desktop design system (principles, color tokens for dark and light, type, spacing, density, radius, elevation, motion, icons, components, macOS window, keyboard, accessibility), in AW's own words with one source line.
- `shared/ui`: the tokens of `docs/design.md` 2 in a new entry `@aw/ui/tokens` (no MUI import); `createAppTheme()` maps them to MUI: the indigo accent as `primary`, `surface` backgrounds, a palette group `aw`, Inter Variable at 13 px, sentence-case labels, radii, ripple off, a focus ring on `:focus-visible`, labels above inputs, `overlay` dialogs and menus with no elevation gradient, tinted chips, the button kinds.
- Bundled fonts: `@fontsource-variable/inter` and `@fontsource-variable/geist-mono` in the renderer. No font from the network.
- Desktop main: the window takes its background from the `canvas` token of the system scheme; on macOS it uses the hidden inset title bar with the traffic lights in the sidebar.
- Desktop shell: the sidebar on `canvas` with a 44 px drag row, 28 px items, outline icons and right-aligned counts; a 72 px rail; the top bar is a drag region with icon-only buttons below 600 px; all icons use the `Outlined` variants.
- Docs: `prd.md` RMT-09 and `tech-stack.md` (Theme row, two library rows) name `docs/design.md`. MUI stays the component library.
- No change of a route, an API, a file format or a behaviour.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `desktop-app`: a new requirement "Design system": the theme tokens and their contrast, the bundled fonts, the focus ring, the macOS window.

## Impact

- Code: `shared/ui/src/` (new `tokens.ts`, `index.ts`, tests), `desktop/src/main/` (new `window.ts`, `index.ts`), `desktop/src/renderer/src/main.tsx`, `components/AppShell.tsx`, `components/common.tsx`, the icon imports of each component.
- Dependencies: `@fontsource-variable/inter` 5.3.0 and `@fontsource-variable/geist-mono` 5.3.0 (OFL-1.1) in `desktop/package.json`; the app notices list them.
- Docs: `docs/design.md`, `docs/prd.md`, `docs/tech-stack.md`.
