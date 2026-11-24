// The packaging of the desktop app (spec install-packaging: desktop packaging config, third-party
// notices). electron-builder itself does not run here: it downloads Electron and takes minutes.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import notarize from "./notarize.mjs";
import { renderNotices, thirdParty } from "./notices.ts";

const desktop = join(import.meta.dirname, "..");

const context = {
  electronPlatformName: "darwin",
  appOutDir: "/tmp/out/mac-arm64",
  packager: { appInfo: { productFilename: "Agent Workspace" } },
};

describe("electron-builder.yaml", () => {
  it("sets the alert style, the notices, the hardened runtime and the notarize hook", async () => {
    const config = parse(await readFile(join(desktop, "electron-builder.yaml"), "utf8")) as {
      appId: string;
      mac: { extendInfo: Record<string, string>; hardenedRuntime: boolean; notarize: boolean };
      extraResources: { from: string; to: string }[];
      afterSign: string;
      publish: null;
    };
    expect(config.appId).toBe("com.agentworkspace.desktop");
    expect(config.mac.extendInfo.NSUserNotificationAlertStyle).toBe("alert");
    expect(config.mac.hardenedRuntime).toBe(true);
    expect(config.extraResources).toContainEqual({
      from: "out/THIRD_PARTY_NOTICES",
      to: "THIRD_PARTY_NOTICES",
    });
    expect(config.afterSign).toBe("scripts/notarize.mjs");
    expect(config.publish).toBeNull();
  });
});

describe("notarize hook", () => {
  it("does nothing with no API key or on another platform", async () => {
    let calls = 0;
    const fake = () => {
      calls += 1;
      return Promise.resolve();
    };
    expect(await notarize(context, {}, fake)).toEqual({
      notarized: false,
      reason: "no APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER",
    });
    expect(
      await notarize({ ...context, electronPlatformName: "linux" }, { APPLE_API_KEY: "k" }, fake),
    ).toEqual({ notarized: false, reason: "not macOS" });
    expect(calls).toBe(0);
  });

  it("notarizes the app of the output folder with the 3 variables", async () => {
    const seen: Record<string, string>[] = [];
    const result = await notarize(
      context,
      { APPLE_API_KEY: "/keys/AuthKey.p8", APPLE_API_KEY_ID: "KEYID", APPLE_API_ISSUER: "issuer" },
      (options) => {
        seen.push(options);
        return Promise.resolve();
      },
    );
    expect(result.notarized).toBe(true);
    expect(seen[0]).toMatchObject({ appPath: "/tmp/out/mac-arm64/Agent Workspace.app" });
  });
});

describe("desktop notices", () => {
  it("adds each third-party package after the repository file, and no AW package", () => {
    const entries = thirdParty({
      MIT: [
        { name: "react", versions: ["19.3.1"], paths: [], license: "MIT" },
        { name: "@aw/client", versions: ["0.0.0"], paths: [], license: "MIT" },
      ],
      ISC: [{ name: "axios-like", versions: ["1.0.0"], paths: [], license: "ISC" }],
    });
    expect(entries.map((e) => e.name)).toEqual(["axios-like", "react"]);
    const text = renderNotices("Syncthing v2.1.7\n", [
      {
        name: "react",
        versions: ["19.3.1"],
        license: "MIT",
        homepage: "https://example.com/react",
        text: "MIT License text",
      },
    ]);
    expect(text.startsWith("Syncthing v2.1.7\n")).toBe(true);
    expect(text).toContain("react 19.3.1");
    expect(text).toContain("Home page: https://example.com/react");
    expect(text).toContain("MIT License text");
  });
});
