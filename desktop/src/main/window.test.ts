import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { followScheme, TRAFFIC_LIGHTS, windowOptions } from "./window.ts";

describe("windowOptions", () => {
  it("uses the hidden inset title bar on macOS, with the canvas color of the scheme", () => {
    const dark = windowOptions({ platform: "darwin", dark: true, preload: "/p.cjs" });
    expect(dark.titleBarStyle).toBe("hiddenInset");
    expect(dark.trafficLightPosition).toEqual(TRAFFIC_LIGHTS);
    expect(dark.backgroundColor).toBe("#08090A");
    expect(
      windowOptions({ platform: "darwin", dark: false, preload: "/p.cjs" }).backgroundColor,
    ).toBe("#F7F7F8");
  });

  it("keeps the system title bar on another platform", () => {
    const linux = windowOptions({ platform: "linux", dark: true, preload: "/p.cjs" });
    expect(linux.titleBarStyle).toBeUndefined();
    expect(linux.trafficLightPosition).toBeUndefined();
  });

  it("keeps the renderer security options", () => {
    const options = windowOptions({ platform: "darwin", dark: true, preload: "/p.cjs" });
    expect(options.webPreferences).toMatchObject({
      preload: "/p.cjs",
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    });
    expect(options.show).toBe(false);
    expect(options.minWidth).toBe(400);
  });
});

describe("followScheme", () => {
  it("changes the window background when the system scheme changes, until the window closes", () => {
    const theme = Object.assign(new EventEmitter(), { shouldUseDarkColors: false });
    const win = Object.assign(new EventEmitter(), { colors: [] as string[] });
    const target = {
      setBackgroundColor: (color: string) => win.colors.push(color),
      once: (event: "closed", listener: () => void) => win.once(event, listener),
    };
    followScheme(target, theme);
    theme.shouldUseDarkColors = true;
    theme.emit("updated");
    expect(win.colors).toEqual(["#08090A"]);
    theme.shouldUseDarkColors = false;
    theme.emit("updated");
    expect(win.colors).toEqual(["#08090A", "#F7F7F8"]);
    win.emit("closed");
    expect(theme.listenerCount("updated")).toBe(0);
  });
});
