// The root error screen replaces the whole shell. On macOS it keeps a 44 px drag row, so the window
// still moves and the error does not sit under the traffic lights (docs/design.md 8.1).
import { createAppTheme } from "@aw/ui";
import { ThemeProvider } from "@mui/material";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TITLE_ROW } from "./platform.ts";
import { RootError } from "./routes.tsx";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Electron/45.3.2";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Electron/45.3.2";
const original = navigator.userAgent;

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, "userAgent", { value, configurable: true });
}

function Broken(): never {
  throw new Error("The screen failed.");
}

function renderError() {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const router = createMemoryRouter([
    { path: "/", element: <Broken />, errorElement: <RootError /> },
  ]);
  return render(
    <ThemeProvider theme={createAppTheme()}>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  setUserAgent(original);
  vi.restoreAllMocks();
});

describe("RootError", () => {
  it("on macOS shows the error below a 44 px drag row", () => {
    setUserAgent(MAC);
    const { container } = renderError();
    expect(screen.getByText("The screen failed.")).toBeTruthy();
    const row = container.querySelector<HTMLElement>(".aw-drag");
    expect(row).not.toBeNull();
    expect(getComputedStyle(row as HTMLElement).height).toBe(`${TITLE_ROW}px`);
  });

  it("on another platform shows the error with no drag row", () => {
    setUserAgent(LINUX);
    const { container } = renderError();
    expect(screen.getByText("The screen failed.")).toBeTruthy();
    expect(container.querySelector(".aw-drag")).toBeNull();
  });
});
