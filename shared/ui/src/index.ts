// The MUI theme of the desktop app (docs/design.md, docs/tech-stack.md 1.4 "Theme"). The tokens of
// tokens.ts become the MUI palette, the type scale, the radii, the motion and the component
// defaults. Screens take colors, type sizes and spacing only from this theme (docs/engineering-rules.md
// 5.18); a token that MUI has no name for is in the palette group `aw` (CSS `--mui-palette-aw-*`).
import { createTheme, type Theme, type ThemeOptions } from "@mui/material/styles";
import { fonts, motion, radius, tokens, type SchemeName, type SchemeTokens } from "./tokens.ts";

export { contrast, fonts, motion, radius, tokens } from "./tokens.ts";
export type { SchemeName, SchemeTokens } from "./tokens.ts";

export const packageName = "@aw/ui";

declare module "@mui/material/styles" {
  interface Palette {
    aw: SchemeTokens;
  }
  interface PaletteOptions {
    aw?: SchemeTokens;
  }
}

/** The MUI breakpoints of docs/tech-stack.md 1.4: the same widths as the Android width classes. */
export const breakpoints = { xs: 0, sm: 600, md: 840, lg: 1200, xl: 1600 } as const;

/** The CSS variable of one token of the current scheme. */
export function awVar(name: keyof SchemeTokens): string {
  return `var(--mui-palette-aw-${name})`;
}

/** The CSS variable of a main MUI palette color of the current scheme. */
export function mainVar(color: string): string {
  return `var(--mui-palette-${color}-main)`;
}

/** A status color at `percent` % opacity (chips, banners, the line of a gate card). */
export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/** The MUI palette of one color scheme. */
export function paletteOf(mode: SchemeName): NonNullable<ThemeOptions["palette"]> {
  const t = tokens[mode];
  return {
    mode,
    primary: { main: t.accent, contrastText: t.onAccent },
    secondary: { main: t.wait },
    info: { main: t.run },
    warning: { main: t.you, contrastText: t.onYou },
    success: { main: t.ok },
    error: { main: t.err, contrastText: t.onErr },
    background: { default: t.surface, paper: t.surface },
    text: { primary: t.text, secondary: t.text3, disabled: t.textDisabled },
    divider: t.line,
    action: {
      hover: t.hover,
      selected: t.selected,
      focus: t.selected,
      disabled: t.textDisabled,
      disabledBackground: t.selected,
    },
    aw: t,
  };
}

/** MUI chip and alert colors that map to a palette color. */
const STATUS_COLORS = new Set(["primary", "secondary", "info", "warning", "success", "error"]);

/** The text colors of the MUI palette. */
const TEXT_COLORS = ["primary", "secondary", "disabled"] as const;

/**
 * The palette paths that a Typography `color` prop takes, with their CSS variable. MUI 9 has no
 * system props: Typography maps only `primary` and `textSecondary` forms, so `text.secondary`,
 * `warning.main` and `aw.text2` set no color without these theme variants (docs/design.md 2).
 */
function typographyColorVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const key of TEXT_COLORS) vars[`text.${key}`] = `var(--mui-palette-text-${key})`;
  for (const key of STATUS_COLORS) vars[`${key}.main`] = mainVar(key);
  for (const key of Object.keys(tokens.dark) as (keyof SchemeTokens)[]) {
    if (key !== "shadow") vars[`aw.${key}`] = awVar(key);
  }
  return vars;
}

/** The palette paths that a Typography `color` prop takes in this theme. */
export function typographyColors(): string[] {
  return Object.keys(typographyColorVars());
}

const components: ThemeOptions["components"] = {
  MuiCssBaseline: {
    styleOverrides: {
      // The mono stack for screens that show keys, paths and commands (docs/design.md 3).
      ":root": { "--aw-font-mono": fonts.mono },
      body: {
        fontFeatureSettings: '"cv11", "ss01"',
        WebkitFontSmoothing: "antialiased",
        MozOsxFontSmoothing: "grayscale",
      },
      // The window moves by the title rows (docs/design.md 8.1); controls in them do not.
      ".aw-drag": { WebkitAppRegion: "drag" },
      ".aw-drag button, .aw-drag a, .aw-drag input, .aw-drag [role=button], .aw-drag .aw-no-drag": {
        WebkitAppRegion: "no-drag",
      },
      // Electron finds drag regions by CSS, not by the element on top. Menus, dialogs and the
      // drawer are portaled to <body>, so they need their own no-drag region over the title rows.
      ".MuiModal-root, .MuiPopper-root": { WebkitAppRegion: "no-drag" },
      "code, kbd, pre, samp": { fontFamily: fonts.mono },
      // Selected text takes a tint of the accent, not the blue of the system.
      "::selection": { backgroundColor: tint(awVar("accent"), 32) },
      "@media (prefers-reduced-motion: reduce)": {
        "*, *::before, *::after": {
          transitionDuration: `${motion.quick}ms !important`,
          animationDuration: "1ms !important",
        },
      },
    },
  },
  MuiTypography: {
    // The page title (h2, docs/design.md 12.2) is the h1 of its page.
    defaultProps: {
      variantMapping: {
        h1: "h1",
        h2: "h1",
        h3: "h3",
        h4: "h4",
        h5: "h5",
        h6: "h6",
        subtitle1: "h6",
        subtitle2: "h6",
        body1: "p",
        body2: "p",
        inherit: "p",
      },
    },
    variants: Object.entries(typographyColorVars()).map(([color, value]) => ({
      props: { color },
      style: { color: value },
    })),
  },
  MuiButtonBase: {
    defaultProps: { disableRipple: true },
    styleOverrides: {
      root: {
        "&.Mui-focusVisible": { outline: `2px solid ${awVar("focus")}`, outlineOffset: 1 },
      },
    },
  },
  MuiButton: {
    defaultProps: { size: "small", disableElevation: true },
    styleOverrides: {
      root: {
        borderRadius: radius.sm,
        fontWeight: 510,
        minHeight: 28,
        boxShadow: "none",
        transition: `background-color ${motion.quick}ms ease-out, border-color ${motion.quick}ms ease-out`,
      },
      sizeSmall: { padding: "3px 10px", fontSize: 13 },
      text: ({ ownerState }) => ({
        ...(ownerState.color === "primary" ? { color: awVar("text2") } : {}),
        "&:hover": { backgroundColor: awVar("hover") },
      }),
      outlined: ({ ownerState }) => ({
        backgroundColor: awVar("raised"),
        borderColor: awVar("line"),
        ...(ownerState.color === "primary" ? { color: awVar("text") } : {}),
        "&:hover": { backgroundColor: awVar("overlayHover"), borderColor: awVar("lineStrong") },
      }),
    },
  },
  MuiIconButton: {
    defaultProps: { size: "small" },
    styleOverrides: {
      root: {
        borderRadius: radius.sm,
        color: awVar("text3"),
        "&:hover": { backgroundColor: awVar("hover"), color: awVar("text") },
      },
    },
  },
  MuiPaper: {
    defaultProps: { elevation: 0 },
    // No MUI elevation overlay: depth comes from the surface tokens (docs/design.md 5.3).
    styleOverrides: { root: { backgroundImage: "none" } },
  },
  MuiCard: {
    defaultProps: { variant: "outlined" },
    styleOverrides: {
      root: {
        backgroundColor: awVar("raised"),
        borderColor: awVar("line"),
        borderRadius: radius.md,
      },
    },
  },
  MuiBackdrop: {
    styleOverrides: {
      root: { "&:not(.MuiBackdrop-invisible)": { backgroundColor: awVar("scrim") } },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: {
        backgroundColor: awVar("overlay"),
        backgroundImage: "none",
        border: `1px solid ${awVar("line")}`,
        borderRadius: radius.lg,
        boxShadow: awVar("shadow"),
      },
    },
  },
  MuiDialogTitle: {
    styleOverrides: { root: { fontSize: 15, fontWeight: 590, padding: "18px 20px 8px" } },
  },
  MuiDialogContent: { styleOverrides: { root: { padding: "8px 20px" } } },
  MuiDialogActions: { styleOverrides: { root: { padding: "12px 20px 16px", gap: 4 } } },
  MuiPopover: {
    styleOverrides: {
      paper: {
        backgroundColor: awVar("overlay"),
        backgroundImage: "none",
        border: `1px solid ${awVar("line")}`,
        borderRadius: radius.md,
        boxShadow: awVar("shadow"),
      },
    },
  },
  MuiMenu: {
    styleOverrides: { list: { padding: 4 } },
  },
  MuiMenuItem: {
    defaultProps: { dense: true },
    styleOverrides: {
      root: {
        borderRadius: radius.sm,
        minHeight: 28,
        fontSize: 13,
        "&:hover": { backgroundColor: awVar("overlayHover") },
      },
    },
  },
  MuiTooltip: {
    defaultProps: { arrow: false, enterDelay: 400 },
    styleOverrides: {
      tooltip: {
        backgroundColor: awVar("overlay"),
        color: awVar("text"),
        border: `1px solid ${awVar("line")}`,
        borderRadius: radius.sm,
        boxShadow: awVar("shadow"),
        fontSize: 12,
        fontWeight: 400,
        padding: "4px 8px",
      },
    },
  },
  // Labels sit above the input, not inside its border (docs/design.md 8.8).
  MuiTextField: { defaultProps: { size: "small", slotProps: { inputLabel: { shrink: true } } } },
  MuiInputLabel: {
    defaultProps: { shrink: true },
    styleOverrides: {
      root: {
        "&&": {
          position: "relative",
          transform: "none",
          maxWidth: "100%",
          marginBottom: 6,
          fontSize: 12,
          fontWeight: 510,
          lineHeight: "16px",
          color: awVar("text3"),
        },
        "&&.Mui-error": { color: mainVar("error") },
      },
    },
  },
  MuiOutlinedInput: {
    defaultProps: { notched: false },
    styleOverrides: {
      // On `surface`, an input stands out on a raised card and on a dialog (docs/design.md 8.12).
      root: {
        backgroundColor: awVar("surface"),
        borderRadius: radius.sm,
        fontSize: 13,
        "& .MuiOutlinedInput-notchedOutline": { borderColor: awVar("lineStrong"), top: 0 },
        "& .MuiOutlinedInput-notchedOutline legend": { display: "none" },
        "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: awVar("lineStrong") },
        "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
          borderColor: awVar("lineStrong"),
          borderWidth: 1,
        },
        "&.Mui-focused": { boxShadow: `0 0 0 2px ${awVar("focus")}` },
        "&.Mui-error .MuiOutlinedInput-notchedOutline": { borderColor: mainVar("error") },
      },
      input: { padding: "6px 10px" },
      // A multiline input has its padding on the textarea (MUI 9 has no inputMultiline class).
      multiline: { padding: 0 },
    },
  },
  MuiFormHelperText: {
    styleOverrides: { root: { marginLeft: 0, marginRight: 0, fontSize: 12, lineHeight: "16px" } },
  },
  MuiSelect: { defaultProps: { size: "small" } },
  MuiFormControl: { defaultProps: { size: "small" } },
  MuiChip: {
    defaultProps: { size: "small" },
    styleOverrides: {
      root: ({ ownerState }) => {
        const color =
          ownerState.color && STATUS_COLORS.has(ownerState.color) ? ownerState.color : null;
        return {
          height: 20,
          borderRadius: radius.xs,
          border: "none",
          fontSize: 12,
          fontWeight: 510,
          backgroundColor: color ? tint(mainVar(color), 14) : awVar("selected"),
          color: color ? mainVar(color) : awVar("text2"),
          "& .MuiChip-icon": { color: "inherit", fontSize: 13, marginLeft: 5, marginRight: -2 },
          "&.MuiChip-clickable:hover": {
            backgroundColor: color ? tint(mainVar(color), 22) : awVar("overlayHover"),
          },
        };
      },
      label: { paddingLeft: 6, paddingRight: 6 },
    },
  },
  MuiAlert: {
    styleOverrides: {
      root: ({ ownerState }) => {
        const color = ownerState.severity ?? "info";
        const main = mainVar(color === "info" ? "info" : color);
        const base = { borderRadius: radius.md, fontSize: 13, alignItems: "center" };
        // A filled alert keeps the MUI contrast text and icon color on its status fill.
        if (ownerState.variant === "filled") return base;
        return {
          ...base,
          color: awVar("text"),
          ...(ownerState.variant === "outlined"
            ? { borderColor: tint(main, 40), backgroundColor: "transparent" }
            : { backgroundColor: tint(main, 12) }),
          "& .MuiAlert-icon": { color: main },
        };
      },
    },
  },
  MuiList: { defaultProps: { dense: true } },
  MuiListItemButton: {
    defaultProps: { dense: true },
    styleOverrides: {
      root: {
        borderRadius: radius.sm,
        "&:hover": { backgroundColor: awVar("hover") },
        "&.Mui-selected, &.Mui-selected:hover": { backgroundColor: awVar("selected") },
        "&.Mui-focusVisible": { backgroundColor: "transparent" },
      },
    },
  },
  MuiListItemIcon: { styleOverrides: { root: { color: awVar("text3") } } },
  MuiListSubheader: {
    styleOverrides: {
      root: {
        backgroundColor: "transparent",
        fontSize: 12,
        fontWeight: 510,
        lineHeight: "28px",
        color: awVar("text3"),
      },
    },
  },
  MuiTabs: {
    styleOverrides: {
      root: { minHeight: 32 },
      indicator: { height: 2, backgroundColor: awVar("accentText") },
    },
  },
  MuiTab: {
    styleOverrides: {
      root: {
        minHeight: 32,
        minWidth: 0,
        padding: "6px 10px",
        fontSize: 13,
        fontWeight: 510,
        color: awVar("text3"),
        "&.Mui-selected": { color: awVar("text") },
      },
    },
  },
  MuiBadge: {
    styleOverrides: { badge: { fontSize: 11, fontWeight: 510, height: 16, minWidth: 16 } },
  },
  MuiLink: {
    defaultProps: { underline: "hover" },
    styleOverrides: { root: { color: awVar("accentText") } },
  },
  MuiTable: { defaultProps: { size: "small" } },
  MuiTableCell: {
    styleOverrides: { root: { borderColor: awVar("line"), fontSize: 13 } },
  },
  MuiToolbar: { defaultProps: { variant: "dense" } },
  MuiDrawer: {
    styleOverrides: { paper: { backgroundColor: awVar("canvas"), borderColor: awVar("line") } },
  },
};

/**
 * The theme of the desktop app: light and dark color schemes with CSS variables, a 13 px base,
 * 6 px controls and the component defaults of docs/design.md 8.
 */
export function createAppTheme(): Theme {
  return createTheme({
    cssVariables: { colorSchemeSelector: "media" },
    colorSchemes: {
      light: { palette: paletteOf("light") },
      dark: { palette: paletteOf("dark") },
    },
    breakpoints: { values: breakpoints },
    shape: { borderRadius: radius.sm },
    spacing: 4,
    transitions: {
      duration: {
        shortest: motion.quick,
        shorter: motion.menu,
        short: motion.menu,
        standard: motion.panel,
        complex: motion.panel,
        enteringScreen: motion.panel,
        leavingScreen: motion.menu,
      },
    },
    typography: {
      fontFamily: fonts.sans,
      fontSize: 13,
      htmlFontSize: 16,
      fontWeightMedium: 510,
      fontWeightBold: 590,
      // docs/design.md 3: title-lg, title, title-sm, body-strong, body, meta, label.
      h1: { fontSize: 22, lineHeight: "30px", fontWeight: 590, letterSpacing: "-0.015em" },
      h2: { fontSize: 18, lineHeight: "26px", fontWeight: 590, letterSpacing: "-0.01em" },
      h3: { fontSize: 14, lineHeight: "20px", fontWeight: 590 },
      subtitle1: { fontSize: 14, lineHeight: "20px", fontWeight: 590 },
      subtitle2: { fontSize: 12, lineHeight: "16px", fontWeight: 510 },
      body1: { fontSize: 13, lineHeight: "20px" },
      body2: { fontSize: 12, lineHeight: "18px" },
      caption: { fontSize: 12, lineHeight: "16px" },
      overline: {
        fontSize: 12,
        lineHeight: "16px",
        fontWeight: 510,
        letterSpacing: 0,
        textTransform: "none",
      },
      button: { fontSize: 13, textTransform: "none", fontWeight: 510, letterSpacing: 0 },
    },
    components,
  });
}
