// The design tokens of the desktop app (docs/design.md 2 to 5), from the palette of the prototype.
// The phone theme (android/app ui/Theme.kt) uses the same colors. This module imports nothing, so the
// Electron main process can read the window color with no MUI code. Screens never use these values
// directly: they use the MUI palette that createAppTheme() makes from them.

/** The color tokens of one color scheme (docs/design.md 2). */
export interface SchemeTokens {
  /** The window, the sidebar and the title area. */
  canvas: string;
  /** The main content area, lists, the task view. */
  surface: string;
  /** Cards, inputs, a hovered row, code blocks. */
  raised: string;
  /** Menus, popovers and dialogs. */
  overlay: string;
  /** A hovered item in a menu or a dialog. */
  overlayHover: string;
  /** Row hover on any surface. */
  hover: string;
  /** The selected row and the active navigation item. */
  selected: string;
  line: string;
  lineStrong: string;
  /** The backdrop of a dialog. */
  scrim: string;
  text: string;
  text2: string;
  text3: string;
  textDisabled: string;
  /** The fill of the primary button: the prototype yellow, the same value as `you`. */
  accent: string;
  onAccent: string;
  /** Links and the selected tab mark. */
  accentText: string;
  /** The focus ring. */
  focus: string;
  /** Running work. */
  run: string;
  /** "Needs you". */
  you: string;
  onYou: string;
  /** Waiting, paused and queued. */
  wait: string;
  /** Done, allowed and synced. */
  ok: string;
  /** Errors and destructive actions. */
  err: string;
  onErr: string;
  /** The terminal snapshot (dark in both schemes). */
  term: string;
  termFg: string;
  /** The shadow of a menu, a popover or a dialog. */
  shadow: string;
}

export type SchemeName = "light" | "dark";

export const tokens: Record<SchemeName, SchemeTokens> = {
  dark: {
    canvas: "#08090A",
    surface: "#0F1011",
    raised: "#141517",
    overlay: "#1B1C1F",
    overlayHover: "#232428",
    hover: "rgba(255,255,255,0.04)",
    selected: "rgba(255,255,255,0.07)",
    line: "rgba(255,255,255,0.08)",
    lineStrong: "rgba(255,255,255,0.14)",
    scrim: "rgba(0,0,0,0.6)",
    text: "#F7F8F8",
    text2: "#C9CDD3",
    text3: "#8A8F98",
    textDisabled: "#62666D",
    accent: "#F0B429",
    onAccent: "#1A1200",
    accentText: "#F0B429",
    focus: "#F0B429",
    run: "#4EA7FC",
    you: "#F0B429",
    onYou: "#1A1200",
    wait: "#9AA0A9",
    ok: "#4CB782",
    err: "#EB5757",
    onErr: "#1A0505",
    term: "#0A0B0C",
    termFg: "#C9CDD3",
    shadow: "0 8px 24px rgba(0,0,0,0.5)",
  },
  light: {
    canvas: "#F7F7F8",
    surface: "#FFFFFF",
    raised: "#F4F4F5",
    overlay: "#FFFFFF",
    overlayHover: "#F1F1F3",
    hover: "rgba(0,0,0,0.035)",
    selected: "rgba(0,0,0,0.06)",
    line: "rgba(0,0,0,0.08)",
    lineStrong: "rgba(0,0,0,0.15)",
    scrim: "rgba(0,0,0,0.24)",
    text: "#171717",
    text2: "#3F3F46",
    text3: "#5E5E66",
    textDisabled: "#A1A1AA",
    accent: "#8F5200",
    onAccent: "#FFFFFF",
    accentText: "#8F5200",
    focus: "#8F5200",
    run: "#1D6FD6",
    you: "#8F5200",
    onYou: "#FFFFFF",
    wait: "#5E5E66",
    ok: "#14804F",
    err: "#C93434",
    onErr: "#FFFFFF",
    term: "#16171A",
    termFg: "#D5D8DD",
    shadow: "0 8px 24px rgba(0,0,0,0.12)",
  },
};

/** The font stacks (docs/design.md 3). The app bundles both variable fonts. */
export const fonts = {
  // "JetBrains Mono AW" (desktop/src/renderer/src/fonts/fonts.css) gives the glyphs that the first
  // font does not have, for example the box drawing characters of a tree.
  sans: '"Inter Variable", Inter, "JetBrains Mono AW", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", sans-serif',
  mono: '"Geist Mono Variable", "Geist Mono", "JetBrains Mono AW", ui-monospace, "SF Mono", Menlo, monospace',
};

/** The radii in px (docs/design.md 5). */
export const radius = { xs: 4, sm: 6, md: 8, lg: 12 } as const;

/** The durations in ms (docs/design.md 6). */
export const motion = { quick: 100, menu: 150, panel: 200 } as const;

/** The WCAG 2 contrast ratio of two opaque `#RRGGBB` colors. */
export function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  if (!/^#[0-9A-Fa-f]{6}$/.test(a) || !/^#[0-9A-Fa-f]{6}$/.test(b)) {
    throw new Error(`contrast needs #RRGGBB colors, not ${a} and ${b}`);
  }
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
