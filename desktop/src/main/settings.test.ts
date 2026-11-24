import { describe, expect, it } from "vitest";
import { loadSettings } from "./settings.ts";

describe("loadSettings", () => {
  it("ignores ELECTRON_RENDERER_URL in the packaged app (fix list 0-6)", () => {
    const settings = loadSettings(
      { packaged: true },
      { HOME: "/home/user", ELECTRON_RENDERER_URL: "http://localhost:5173" },
    );
    expect(settings.devServerUrl).toBeNull();
  });

  it("refuses a dev server URL that is not on this computer", () => {
    for (const url of [
      "https://attacker.example.com",
      "http://example.com:5173",
      "http://localhost.example.com:5173",
      "file:///tmp/index.html",
      "not a url",
    ]) {
      expect(
        loadSettings({ packaged: false }, { HOME: "/home/user", ELECTRON_RENDERER_URL: url })
          .devServerUrl,
      ).toBeNull();
    }
  });

  it("keeps a local dev server URL of electron-vite dev", () => {
    for (const url of ["http://localhost:5173", "http://127.0.0.1:5173/", "http://[::1]:5173"]) {
      expect(
        loadSettings({ packaged: false }, { HOME: "/home/user", ELECTRON_RENDERER_URL: url })
          .devServerUrl,
      ).toBe(url);
    }
  });

  it("reads AW_HOME and the socket path", () => {
    const settings = loadSettings({ packaged: true }, { HOME: "/home/user" });
    expect(settings.awHome).toBe("/home/user/.aw");
    expect(settings.socketPath).toBe("/home/user/.aw/run/awd.sock");
    expect(loadSettings({ packaged: true }, { AW_HOME: "/tmp/aw" }).socketPath).toBe(
      "/tmp/aw/run/awd.sock",
    );
  });
});
