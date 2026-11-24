## Context

`docs/design.md` (new in this change) defines the desktop design system. Today `shared/ui` maps the prototype tokens to MUI with the default component look; the renderer has no font file; the main process opens a window with the system title bar and a white background. MUI stays the library (`prd.md` RMT-09).

## Goals / Non-Goals

**Goals:**
- One token set (dark and light) with the names of `docs/design.md`, readable by the renderer and by the main process.
- A theme that gives each MUI component the look of `docs/design.md` 8, so the screens change with no per-screen colors.
- Bundled fonts, a visible focus ring, a native macOS window.

**Non-Goals:**
- Sidebar order, breadcrumbs, the Inbox list and detail, the board swimlane, the command menu (journey navigation-prototype).
- The content of the task view (task-view-focus), the create flows, session options, key backup.
- The Android app.

## Decisions

1. **Tokens in `shared/ui/src/tokens.ts`, exported as `@aw/ui/tokens`.** The main process needs `canvas` for `backgroundColor`; the main entry of `@aw/ui` imports MUI, which the main bundle must not carry. `@aw/ui` re-exports the tokens.
2. **Palette mapping.** `primary` = `accent` with `onAccent`; `background.default` and `background.paper` = `surface`; `text.primary` = `text`, `text.secondary` = `text3`; `divider` = `line`; `action.hover` = `hover`, `action.selected` = `selected`, `action.focus` = `selected` (not the accent: the old mapping filled a focused item with `#7C7FF5`). A palette group `aw` holds all tokens, so a screen can write `bgcolor: "aw.canvas"`; with `cssVariables` they are `--mui-palette-aw-*`.
3. **Component defaults in the theme.** `MuiButtonBase` with `disableRipple` and a 2 px `focus` outline on `.Mui-focusVisible`; `MuiButton` text and outlined buttons with `primary` color use the `text` color, so only contained buttons show the accent; `MuiPaper` with `backgroundImage: none`; `MuiDialog`, `MuiMenu`, `MuiPopover` paper on `overlay` with `r-lg`, a `line` border and the level 2 shadow; `MuiTextField` with `shrink` labels and `MuiOutlinedInput` with `notched: false`, and `MuiInputLabel` static above the input; `MuiChip` filled with the status tint; `MuiTooltip` on `overlay`; `MuiTab` 32 px with no uppercase; the `overline` variant in sentence case, 12 px, 510.
4. **Fonts.** `@fontsource-variable/inter` and `@fontsource-variable/geist-mono` (Fontsource, OFL-1.1). The renderer entry imports their CSS; Vite copies the woff2 files to `out/renderer/assets/`. Family names "Inter Variable" and "Geist Mono Variable" lead the stacks; the system fonts stay as fallbacks. Rejected: a CDN (CSP and privacy), the system font only (no control of the metrics).
5. **Icons.** The `Outlined` variants of `@mui/icons-material`. Rejected: `lucide-react` (a new library for the same job).
6. **Window.** A pure `windowOptions(platform, dark)` in `desktop/src/main/window.ts`: `backgroundColor` = `canvas` of the scheme; on `darwin` `titleBarStyle: "hiddenInset"` and `trafficLightPosition: { x: 16, y: 14 }`. The renderer reads `navigator.userAgent` to add the 44 px row for the traffic lights and the drag regions (CSS class `aw-drag`, with `no-drag` on controls). No vibrancy: solid colors keep the token contrast.
7. **Accent.** The primary button uses the indigo `accent`, not the white or black button of the prototype: one accent for the primary action, focus and links (`docs/design.md` 1.2).

## Risks / Trade-offs

- [Contained buttons change from white to indigo on many screens] → this is the design; the screenshots before and after show each screen.
- [Labels above inputs change the height of forms] → a theme-level change; the after screenshots check each dialog at 400 px.
- [hiddenInset hides the system title] → the top bar is a drag region; double-click zooms through the system setting.
- [The font files add about 0.5 MB to the app] → acceptable for a desktop app; the subsets load by `unicode-range`.
