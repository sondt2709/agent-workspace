import { describe, expect, it } from "vitest";
import {
  awVar,
  breakpoints,
  createAppTheme,
  mainVar,
  packageName,
  paletteOf,
  tokens,
  typographyColors,
} from "./index.ts";
import * as tokensEntry from "./tokens.ts";

type Overrides = Record<string, unknown>;

/** The style overrides of one component, with a function override called for `ownerState`. */
function overrides(
  component: string,
  slot: string,
  ownerState: Record<string, unknown> = {},
): Overrides {
  const theme = createAppTheme();
  const entry = (theme.components as Record<string, { styleOverrides?: Overrides }>)[component];
  const value = entry?.styleOverrides?.[slot];
  if (typeof value !== "function") return value as Overrides;
  const call = value as (props: {
    ownerState: Record<string, unknown>;
    theme: unknown;
  }) => Overrides;
  return call({ ownerState, theme });
}

describe("@aw/ui", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@aw/ui");
  });

  it("has the tokens of docs/design.md in an entry with no MUI import", () => {
    expect(tokensEntry.tokens).toBe(tokens);
    expect(tokens.dark.canvas).toBe("#08090A");
    expect(tokens.light.surface).toBe("#FFFFFF");
    expect(Object.keys(tokens.dark).sort()).toEqual(Object.keys(tokens.light).sort());
  });

  it("maps the tokens to the MUI palette of each scheme, with the accent as primary", () => {
    for (const mode of ["light", "dark"] as const) {
      const palette = paletteOf(mode);
      const t = tokens[mode];
      expect(palette.mode).toBe(mode);
      expect(palette.primary).toEqual({ main: t.accent, contrastText: t.onAccent });
      expect(palette.warning).toEqual({ main: t.you, contrastText: t.onYou });
      expect(palette.background).toEqual({ default: t.surface, paper: t.surface });
      expect(palette.aw).toBe(t);
      // The old theme filled a focused item with the solid accent: a focus must not look like a selection.
      expect(palette.action?.focus).toBe(t.selected);
    }
  });

  it("makes a dense theme with both color schemes, the AW breakpoints and CSS variables", () => {
    const theme = createAppTheme();
    const schemes = (theme as typeof theme & { colorSchemes?: Record<string, unknown> })
      .colorSchemes;
    expect(Object.keys(schemes ?? {}).sort()).toEqual(["dark", "light"]);
    expect(theme.breakpoints.values).toEqual(breakpoints);
    expect(theme.typography.fontSize).toBe(13);
    expect(theme.typography.fontFamily).toMatch(/^"Inter Variable"/);
    expect(theme.components?.MuiButton?.defaultProps?.size).toBe("small");
    expect(theme.components?.MuiList?.defaultProps?.dense).toBe(true);
    expect(theme.spacing(2)).toBe("calc(2 * var(--mui-spacing, 4px))");
    const vars = theme.vars as unknown as { palette: { aw: Record<string, string> } };
    expect(vars.palette.aw.overlayHover).toMatch(/^var\(--mui-palette-aw-overlayHover[,)]/);
  });

  it("maps the palette paths of a Typography color prop to their CSS variables", () => {
    // MUI 9 has no system props: with no theme variant, color="text.secondary" sets no color.
    const variants = createAppTheme().components?.MuiTypography?.variants ?? [];
    const style = (color: string) =>
      variants.find((v) => typeof v.props === "object" && v.props.color === color)?.style;
    expect(style("text.secondary")).toEqual({ color: "var(--mui-palette-text-secondary)" });
    expect(style("warning.main")).toEqual({ color: mainVar("warning") });
    expect(style("aw.text2")).toEqual({ color: awVar("text2") });
    expect(typographyColors()).not.toContain("aw.shadow");
  });

  it("lets clicks reach a menu, a dialog or a drawer over a drag region of the title area", () => {
    // Electron finds the drag regions by their CSS, not by the element on top: an overlay that is
    // portaled to <body> needs its own no-drag region (docs/design.md 8.1).
    const styles = createAppTheme().components?.MuiCssBaseline?.styleOverrides as Overrides;
    expect(styles[".MuiModal-root, .MuiPopper-root"]).toEqual({ WebkitAppRegion: "no-drag" });
  });

  it("keeps the MUI contrast text and icon color of a filled alert", () => {
    const filled = overrides("MuiAlert", "root", { severity: "warning", variant: "filled" });
    expect(filled).not.toHaveProperty("color");
    expect(filled).not.toHaveProperty(["& .MuiAlert-icon"]);
    const standard = overrides("MuiAlert", "root", { severity: "warning", variant: "standard" });
    expect(standard).toMatchObject({ color: awVar("text") });
  });

  it("uses sentence-case labels", () => {
    const theme = createAppTheme();
    expect(theme.typography.overline.textTransform).toBe("none");
    expect(theme.typography.button.textTransform).toBe("none");
  });

  it("turns the ripple off and shows a 2 px focus ring on keyboard focus", () => {
    const theme = createAppTheme();
    expect(theme.components?.MuiButtonBase?.defaultProps?.disableRipple).toBe(true);
    expect(overrides("MuiButtonBase", "root")["&.Mui-focusVisible"]).toEqual({
      outline: `2px solid ${awVar("focus")}`,
      outlineOffset: 1,
    });
  });

  it("puts dialogs and menus on the overlay surface with no elevation gradient", () => {
    expect(overrides("MuiDialog", "paper")).toMatchObject({
      backgroundColor: awVar("overlay"),
      backgroundImage: "none",
    });
    expect(overrides("MuiPopover", "paper")).toMatchObject({ backgroundColor: awVar("overlay") });
    expect(overrides("MuiPaper", "root")).toEqual({ backgroundImage: "none" });
  });

  it("gives a status chip the tint of its color and a plain chip the selected fill", () => {
    expect(overrides("MuiChip", "root", { color: "warning" })).toMatchObject({
      backgroundColor: "color-mix(in srgb, var(--mui-palette-warning-main) 14%, transparent)",
      color: "var(--mui-palette-warning-main)",
    });
    expect(overrides("MuiChip", "root", { color: "default" })).toMatchObject({
      backgroundColor: awVar("selected"),
    });
  });

  it("shows only contained primary buttons in the accent", () => {
    expect(overrides("MuiButton", "text", { color: "primary" })).toMatchObject({
      color: awVar("text2"),
    });
    expect(overrides("MuiButton", "outlined", { color: "primary" })).toMatchObject({
      color: awVar("text"),
    });
    expect(overrides("MuiButton", "outlined", { color: "error" })).not.toHaveProperty("color");
  });
});
