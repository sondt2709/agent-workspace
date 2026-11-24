// Offline tests of the Docker harness (pnpm test). The Docker suite itself runs with "task e2e".
import { describe, expect, it } from "vitest";
import { COMPOSE_FILE, composeArgs, leakLines, PROJECT } from "./compose.ts";
import { loadE2eSettings } from "./settings.ts";

describe("leak lines", () => {
  it("finds the lines of the verification log with the default config (2026-11-22)", () => {
    const log = [
      '2026-11-22 17:35:35 INF Using discovery mechanism (identity="global discovery server https://discovery-lookup.syncthing.net/v2/?noannounce" log.pkg=discover)',
      "2026-11-22 17:35:59 INF Joined relay (uri=relay://<relay>:22067 log.pkg=relay/client)",
      '2026-11-22 17:35:45 INF Detected NAT type (uri=quic://0.0.0.0:22000 type="Symmetric NAT" log.pkg=connections)',
      '2026-11-22 17:35:55 INF New external port opened (protocol=TCP external="[<public-ip>:22741]" local="[::]:22000" gateway=NAT-PMP@<gateway> log.pkg=nat)',
      '2026-11-22 20:59:56 INF Using discovery mechanism (identity="IPv4 local broadcast discovery on port 21027" log.pkg=discover)',
      '2026-11-22 20:59:56 INF TCP listener starting (address="[::]:22300" log.pkg=connections)',
    ].join("\n");
    expect(leakLines(log)).toHaveLength(4);
  });
});

describe("compose arguments", () => {
  it("names the compose file and the project", () => {
    expect(composeArgs("ps")).toEqual(["compose", "-f", COMPOSE_FILE, "-p", PROJECT, "ps"]);
    expect(COMPOSE_FILE.endsWith("/e2e/compose.yaml")).toBe(true);
  });
});

describe("e2e settings", () => {
  it("takes AW_E2E_PROJECT, and an empty value is not set (offline-task-keys review low 9)", () => {
    expect(loadE2eSettings({ AW_E2E_PROJECT: "aw-setup-check" }).project).toBe("aw-setup-check");
    expect(loadE2eSettings({ AW_E2E_PROJECT: "" }).project).toBe("aw-sync-e2e");
    expect(loadE2eSettings({}).project).toBe("aw-sync-e2e");
  });
});
