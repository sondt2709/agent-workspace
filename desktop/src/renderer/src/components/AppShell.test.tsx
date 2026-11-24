// The macOS window parts of the shell (docs/design.md 8.1): the 44 px title row of the sidebar where
// the traffic lights sit, and the drag regions. Another platform keeps the system title bar.
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { AppCommand } from "../../../shared/channels.ts";
import { isMac, TITLE_ROW, TRAFFIC_LIGHTS_WIDTH } from "../platform.ts";
import { installBridge, renderApp } from "../testing.tsx";
import { AppShell, RAIL_WIDTH, Sidebar } from "./AppShell.tsx";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Electron/45.3.2";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Electron/45.3.2";
const original = navigator.userAgent;

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, "userAgent", { value, configurable: true });
}

function renderShell() {
  installBridge({
    workspaces: () => [{ id: "ws-1", name: "Personal", path: "/tmp/Personal", open_gates: 2 }],
  });
  return renderApp(<AppShell />, { route: "/w/:ws/*", url: "/w/ws-1/inbox" });
}

afterEach(() => {
  cleanup();
  setUserAgent(original);
});

describe("AppShell window parts", () => {
  it("reads macOS from the user agent", () => {
    expect(isMac(MAC)).toBe(true);
    expect(isMac(LINUX)).toBe(false);
  });

  it("on macOS starts the sidebar with a 44 px drag row and makes the top bar a drag region", async () => {
    setUserAgent(MAC);
    const { container } = renderShell();
    const nav = await screen.findByRole("navigation", { name: "Navigation" });
    const row = nav.firstElementChild as HTMLElement;
    expect(row.classList.contains("aw-drag")).toBe(true);
    expect(getComputedStyle(row).height).toBe(`${TITLE_ROW}px`);
    // The row stays at the top of the scrolling navigation, so no item scrolls under the lights.
    expect(getComputedStyle(nav).overflowY).toBe("auto");
    expect(getComputedStyle(row).position).toBe("sticky");
    expect(getComputedStyle(row).top).toBe("0px");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "New task" }).closest(".aw-drag")).not.toBeNull(),
    );
    expect(container.querySelectorAll(".aw-drag")).toHaveLength(2);
  });

  it("shows the project names of the sidebar as labels, not as headings", async () => {
    installBridge({
      workspaces: () => [{ id: "ws-1", name: "Personal", path: "/tmp/Personal", open_gates: 0 }],
    });
    renderApp(<Sidebar current="ws-1" compact={false} />, {
      route: "/w/:ws/*",
      url: "/w/ws-1/inbox",
    });
    const nav = await screen.findByRole("navigation", { name: "Navigation" });
    await within(nav).findByText("Billing API");
    expect(within(nav).queryAllByRole("heading")).toEqual([]);
  });

  it("makes the rail as wide as the traffic lights need", () => {
    // macOS 26 draws the 3 lights from x 16 to x 76 (titlebar capture of the check, 2026-11-24).
    expect(RAIL_WIDTH).toBeGreaterThanOrEqual(TRAFFIC_LIGHTS_WIDTH);
  });

  it("on another platform has no title row in the sidebar", async () => {
    setUserAgent(LINUX);
    renderShell();
    const nav = await screen.findByRole("navigation", { name: "Navigation" });
    expect(nav.querySelector(".aw-drag")).toBeNull();
  });
});

describe("menu commands with an open dialog (fc1-d3)", () => {
  it("keeps the draft of an open dialog when a menu command would open another dialog", async () => {
    installBridge({
      workspaces: () => [{ id: "ws-1", name: "Personal", path: "/tmp/Personal", open_gates: 0 }],
    });
    let send: (command: AppCommand) => void = () => undefined;
    window.aw = {
      ...window.aw,
      onCommand: (listener) => {
        send = listener;
        return () => undefined;
      },
    };
    renderApp(<AppShell />, { route: "/w/:ws/*", url: "/w/ws-1/inbox" });
    act(() => send("new-task"));
    const field = await screen.findByLabelText<HTMLTextAreaElement>("First message");
    await userEvent.type(field, "Add a CSV export");
    act(() => send("sync-now"));
    act(() => send("new-session"));
    act(() => send("new-task"));
    expect(screen.queryByRole("dialog", { name: "Sync" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "New session" })).toBeNull();
    expect(screen.getByLabelText<HTMLTextAreaElement>("First message").value).toBe(
      "Add a CSV export",
    );
  });
});
