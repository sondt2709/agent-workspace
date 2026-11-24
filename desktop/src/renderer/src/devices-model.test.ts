import { describe, expect, it } from "vitest";
import type { SessionHostsReply, SyncNowReply } from "../../shared/channels.ts";
import {
  agentLines,
  heartbeatText,
  hostSummary,
  normalizeCheckCode,
  otherDeviceChoices,
  phraseCheckPasses,
  pickPositions,
  sessionHostChoice,
  sessionsOn,
  svgDataUrl,
  syncResultLines,
} from "./devices-model.ts";
import { makeTask, PROJECT } from "./testing.tsx";

const NOW = Date.parse("2026-11-23T10:00:30.000Z");

describe("heartbeatText of a phone (verify-journeys finding 23)", () => {
  it("says that a phone sends no heartbeat, not that none came yet", () => {
    expect(heartbeatText(undefined, NOW, "phone")).toBe(
      "A phone sends no heartbeat. The sync line shows its state.",
    );
    expect(heartbeatText(undefined, NOW, "remote")).toBe("No heartbeat yet");
  });
});

describe("heartbeatText", () => {
  it("says the age of the last heartbeat, or since when a device is offline", () => {
    const base = { device: "ubuntu-01", last_heartbeat_hlc: "x" };
    expect(
      heartbeatText(
        { ...base, online: true, received_at: "2026-11-23T10:00:18.000Z", offline_since: null },
        NOW,
      ),
    ).toBe("Last heartbeat 12 s ago");
    const offline = heartbeatText(
      {
        ...base,
        online: false,
        received_at: "2026-11-23T09:00:00.000Z",
        offline_since: "2026-11-23T09:01:30.000Z",
      },
      NOW,
    );
    expect(offline).toMatch(/^Offline since \d\d:\d\d$/);
    expect(heartbeatText(undefined, NOW)).toBe("No heartbeat yet");
  });
});

describe("syncResultLines", () => {
  const status = { engine: "running", device: "m", sync_id: null, paused: false, pids: [] };
  it("names each device that is not synced, with no move suggestion", () => {
    const reply: SyncNowReply = {
      at: "2026-11-23T10:00:00.000Z",
      pending: [{ device: "ubuntu-01", items: 3, reason: "offline" }],
      status: { ...status, peers: [{ device: "ubuntu-01" } as never] },
    } as SyncNowReply;
    expect(syncResultLines(reply)).toEqual(["3 changes not synced to ubuntu-01 (offline)"]);
    expect(syncResultLines({ ...reply, pending: [] })).toEqual(["All devices are synced."]);
  });
});

describe("agentLines working count (screens-align check)", () => {
  it("counts only the running sessions that the queues route counts", () => {
    const session = {
      session: "s",
      device: "ubuntu-01",
      host: "tmux",
      state: "running",
      reason: null,
    } as const;
    const claim = { epoch: 1, device: "ubuntu-01", session: "s" };
    const tasks = [
      makeTask({ session, claim }),
      // Done: the queues route does not count it.
      makeTask({ key: "AW-4", stage: "done", session, claim }),
      // The claim is on another device (a move).
      makeTask({ key: "AW-5", session, claim: { ...claim, device: "macbook-pro" } }),
    ];
    expect(agentLines(undefined, "ubuntu-01", [PROJECT], tasks)).toEqual([
      { agent: "claude@ubuntu-01", sessions: "1 working · queue 0" },
    ]);
  });
});

describe("hostSummary when Orca is missing (screens-align check)", () => {
  it("says that the default host is tmux when Orca is on but not available", () => {
    const entry = {
      device: "macbook-pro",
      may_run: true,
      use_orca: true,
      orca: { available: false, version: null, reason: "the Orca host is not set up" },
      checkouts: [{ project: "billing-api", session_host: null }],
    } as unknown as SessionHostsReply["devices"][number];
    expect(hostSummary(entry)?.checkouts).toEqual([
      { project: "billing-api", host: "tmux (default; Orca not available)" },
    ]);
    expect(hostSummary({ ...entry, orca: null })?.checkouts).toEqual([
      { project: "billing-api", host: "Orca (default)" },
    ]);
  });
});

describe("sessionsOn and otherDeviceChoices", () => {
  it("lists the running sessions of a device", () => {
    const running = makeTask({
      session: { session: "s", device: "ubuntu-01", host: "tmux", state: "running", reason: null },
    });
    const ended = makeTask({
      key: "AW-4",
      session: { session: "s", device: "ubuntu-01", host: "tmux", state: "ended", reason: null },
    });
    expect(sessionsOn([running, ended], "ubuntu-01")).toEqual(["AW-3 Rate limit"]);
    expect(sessionsOn([running], "macbook-pro")).toEqual([]);
  });

  it("gives the choices of the project except the device of the task", () => {
    expect(otherDeviceChoices([PROJECT], makeTask({ assignee: "claude@macbook-pro" }))).toEqual([
      "claude@ubuntu-01",
    ]);
  });
});

describe("sessionHostChoice", () => {
  const hosts: SessionHostsReply = {
    device: "macbook-pro",
    devices: [
      {
        device: "macbook-pro",
        may_run: true,
        use_orca: true,
        checkouts: [{ project: "billing-api", session_host: "tmux" }],
        orca: { available: true, version: "1.4.257", reason: null },
      },
      { device: "ubuntu-01", may_run: true, use_orca: true, checkouts: [], orca: null },
      { device: "mac-mini", may_run: true, use_orca: false, checkouts: [], orca: null },
      {
        device: "studio",
        may_run: true,
        use_orca: true,
        checkouts: [],
        orca: { available: false, version: null, reason: "no Orca binary" },
      },
    ],
  };

  it("selects the checkout host first, and shows the Orca version of this device", () => {
    expect(sessionHostChoice(hosts, "macbook-pro", "billing-api")).toEqual({
      initial: "tmux",
      orcaEnabled: true,
      orcaLabel: "Orca 1.4.257",
      note: null,
    });
    expect(sessionHostChoice(hosts, "macbook-pro", "other").initial).toBe("orca");
  });

  it("offers Orca on another device with use_orca, with the tmux fallback note", () => {
    const choice = sessionHostChoice(hosts, "ubuntu-01", "billing-api");
    expect(choice).toMatchObject({ initial: "orca", orcaEnabled: true, orcaLabel: "Orca" });
    expect(choice.note).toContain("runs in tmux");
  });

  it("turns Orca off with no use_orca, no bindings, no reply yet, or Orca missing here", () => {
    expect(sessionHostChoice(hosts, "mac-mini", null)).toMatchObject({
      initial: "tmux",
      orcaEnabled: false,
      orcaLabel: "Orca · not turned on on mac-mini",
    });
    expect(sessionHostChoice(hosts, "pixel-9", null).orcaEnabled).toBe(false);
    expect(sessionHostChoice(undefined, "ubuntu-01", null).orcaLabel).toBe("Orca · checking…");
    expect(sessionHostChoice(hosts, "studio", null)).toEqual({
      initial: "tmux",
      orcaEnabled: false,
      orcaLabel: "Orca · not available on studio",
      note: "no Orca binary",
    });
  });
});

describe("pairing helpers", () => {
  it("normalizes a check code of 6 digits", () => {
    expect(normalizeCheckCode("482913")).toBe("482 913");
    expect(normalizeCheckCode(" 482 913 ")).toBe("482 913");
    expect(normalizeCheckCode("48291")).toBeNull();
    expect(normalizeCheckCode("48291a")).toBeNull();
  });

  it("makes an image URL of the SVG", () => {
    expect(svgDataUrl("<svg/>")).toBe(`data:image/svg+xml;base64,${btoa("<svg/>")}`);
  });
});

describe("recovery phrase check", () => {
  it("picks 3 different positions and checks the words", () => {
    let i = 0;
    const values = [0.5, 0.5, 0.1, 0.9];
    const positions = pickPositions(24, () => values[i++ % values.length]!);
    expect(positions).toEqual([2, 12, 21]);
    const words = Array.from({ length: 24 }, (_v, n) => `w${n}`);
    expect(phraseCheckPasses(words, positions, ["W2", " w12 ", "w21"])).toBe(true);
    expect(phraseCheckPasses(words, positions, ["w2", "w12", "w20"])).toBe(false);
  });
});
