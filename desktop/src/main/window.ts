// The options of the app window (docs/design.md 8.1). The window background is the `canvas` token
// of the system scheme, so no white frame shows at the start or during a resize. On macOS the
// window uses the hidden inset title bar: the traffic lights sit in the 44 px top row of the sidebar.
import { tokens } from "@aw/ui/tokens";
import type { BrowserWindowConstructorOptions } from "electron";

/** The position of the traffic lights: centered in the 44 px top row of the sidebar. */
export const TRAFFIC_LIGHTS = { x: 16, y: 14 } as const;

/** The window background of a scheme: the `canvas` token. */
export function windowBackground(dark: boolean): string {
  return tokens[dark ? "dark" : "light"].canvas;
}

/**
 * Keeps the window background on the `canvas` of the current system scheme, so no frame of the
 * old scheme shows during a resize after the person changes the system setting.
 */
export function followScheme(
  win: {
    setBackgroundColor(color: string): void;
    once(event: "closed", listener: () => void): unknown;
  },
  theme: {
    readonly shouldUseDarkColors: boolean;
    on(event: "updated", listener: () => void): unknown;
    off(event: "updated", listener: () => void): unknown;
  },
): void {
  const update = () => win.setBackgroundColor(windowBackground(theme.shouldUseDarkColors));
  theme.on("updated", update);
  win.once("closed", () => theme.off("updated", update));
}

export function windowOptions(input: {
  platform: NodeJS.Platform;
  dark: boolean;
  preload: string;
}): BrowserWindowConstructorOptions {
  const mac = input.platform === "darwin";
  return {
    width: 1280,
    height: 800,
    minWidth: 400,
    minHeight: 480,
    title: "Agent Workspace",
    show: false,
    backgroundColor: windowBackground(input.dark),
    ...(mac ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: TRAFFIC_LIGHTS } : {}),
    webPreferences: {
      preload: input.preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  };
}
