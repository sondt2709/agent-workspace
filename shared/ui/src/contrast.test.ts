// docs/design.md 2.2, 2.3 and 10.1: each text token and each status color is readable on the
// surfaces where it shows (WCAG 2 contrast of at least 4.5:1).
import { describe, expect, it } from "vitest";
import { contrast, tokens, type SchemeTokens } from "./tokens.ts";

type Key = keyof SchemeTokens;

/** [foreground, background] pairs that a screen uses. */
const PAIRS: [Key, Key][] = [
  ["text", "canvas"],
  ["text", "surface"],
  ["text", "raised"],
  ["text", "overlay"],
  ["text2", "surface"],
  ["text2", "raised"],
  ["text2", "overlay"],
  ["text3", "canvas"],
  ["text3", "surface"],
  ["text3", "raised"],
  ["text3", "overlay"],
  ["accentText", "surface"],
  ["accentText", "overlay"],
  ["onAccent", "accent"],
  ["onYou", "you"],
  ["run", "surface"],
  ["you", "surface"],
  ["wait", "surface"],
  ["ok", "surface"],
  ["err", "surface"],
  ["err", "overlay"],
  ["termFg", "term"],
];

describe("token contrast", () => {
  for (const scheme of ["dark", "light"] as const) {
    for (const [fg, bg] of PAIRS) {
      it(`${scheme}: ${fg} on ${bg} is at least 4.5:1`, () => {
        const t = tokens[scheme];
        expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`${scheme}: the focus ring is at least 3:1 on canvas and surface`, () => {
      const t = tokens[scheme];
      expect(contrast(t.focus, t.canvas)).toBeGreaterThanOrEqual(3);
      expect(contrast(t.focus, t.surface)).toBeGreaterThanOrEqual(3);
    });
  }

  // The prototype palette is the one source (openspec polish-prototype-style): the accent is the
  // prototype yellow, the same value as `you`, so no second accent shows.
  it("uses the prototype yellow as the one accent", () => {
    expect(tokens.dark.accent).toBe("#F0B429");
    for (const scheme of ["dark", "light"] as const) {
      const t = tokens[scheme];
      expect(t.accent).toBe(t.you);
      expect(t.accentText).toBe(t.you);
      expect(t.focus).toBe(t.you);
    }
  });

  it("computes the WCAG ratio and refuses a color that is not #RRGGBB", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBe(1);
    expect(() => contrast("rgba(0,0,0,.5)", "#FFFFFF")).toThrow(/#RRGGBB/);
  });
});
