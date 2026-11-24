// The palette paths of docs/design.md 2 on Typography. MUI 9 has no system props: without the theme
// variants of @aw/ui, `color="text.secondary"` sets no color and the text shows in `text`.
import { createAppTheme, tokens } from "@aw/ui";
import { ThemeProvider, Typography } from "@mui/material";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

/** The computed color of a Typography with the color prop `color` (jsdom: the light scheme). */
function colorOf(color: string): string {
  render(
    <ThemeProvider theme={createAppTheme()}>
      <Typography color={color}>{color}</Typography>
    </ThemeProvider>,
  );
  return getComputedStyle(screen.getByText(color)).color;
}

function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

describe("Typography colors", () => {
  it("applies the palette paths of the screens", () => {
    const light = tokens.light;
    expect(colorOf("text.secondary")).toBe(rgb(light.text3));
    expect(colorOf("text.primary")).toBe(rgb(light.text));
    expect(colorOf("warning.main")).toBe(rgb(light.you));
    expect(colorOf("aw.text2")).toBe(rgb(light.text2));
  });
});

describe("Heading levels", () => {
  it("makes a page title (variant h2) the h1 of the page", () => {
    render(
      <ThemeProvider theme={createAppTheme()}>
        <Typography variant="h2">Inbox</Typography>
      </ThemeProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Inbox" })).toBeTruthy();
  });
});
