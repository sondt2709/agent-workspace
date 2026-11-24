// Unit tests of the pins, the config template, the status rules, the journal and the priority
// rule (openspec add-syncthing-sync). The REST replies are real captures (src/fixtures).
import { openWorkspace, systemClock } from "@aw/core";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { escapeXml, isAwConfig, readConfigText, renderConfig } from "./config.ts";
import { WriteJournal } from "./journal.ts";
import { isElected, isSyncId, rankOf, shortId, type RankedDevice } from "./peers.ts";
import {
  checkArchive,
  clearSignedText,
  comparePins,
  fetchEngine,
  hasValidSignature,
  loadPins,
  parseSignedSums,
  platformKey,
  sha256,
  signedBlock,
} from "./pins.ts";
import { decideShared, resolveCopy, type ResolveContext } from "./resolver.ts";
import {
  EngineRest,
  EngineRestError,
  type EngineCompletion,
  type EngineConnection,
} from "./rest.ts";
import {
  ago,
  describePeer,
  folderStatus,
  isTailscale,
  lastSyncedAfterPoll,
  peerStatus,
  pendingOf,
  routeOf,
} from "./status.ts";
import { backoffMs, isEngineOf } from "./supervisor.ts";
import { SyncthingTransport } from "./transport.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const rest = JSON.parse(fixture("rest-v2.1.7.json")) as Record<string, unknown>;
// The signed sums of the release, downloaded from
// https://github.com/syncthing/syncthing/releases/download/v2.1.7/sha256sum.txt.asc (the
// `release_url` and `signed_sums` of engine/engine.json) on 2026-11-22 (UTC). A second download
// later that day gave the same bytes.
const signed = fixture("sha256sum-v2.1.7.txt.asc");

describe("engine pins", () => {
  it("has a pin for each platform, confirmed by the captured signed sums of the release", async () => {
    const pins = await loadPins();
    expect(Object.keys(pins.platforms).sort()).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
    ]);
    expect(comparePins(pins, parseSignedSums(clearSignedText(signed)))).toEqual([]);
  });

  it("reads only the signed block: a line after the signature is not read", async () => {
    const pins = await loadPins();
    const archive = pins.platforms["linux-x64"]!.archive;
    const forged = `${signed}\n${"f".repeat(64)}  ${archive}\n`;
    expect(signedBlock(forged)).toBe(signedBlock(signed));
    expect(clearSignedText(forged)).toBe(clearSignedText(signed));
    expect(comparePins(pins, parseSignedSums(clearSignedText(forged)))).toEqual([]);
    // The same line before the block is not read either.
    expect(clearSignedText(`${"f".repeat(64)}  ${archive}\n${signed}`)).toBe(
      clearSignedText(signed),
    );
    // A second signed block, or a name with 2 values, is refused.
    expect(() => signedBlock(`${signed}\n${signed}`)).toThrow(/2 clear-signed blocks/);
    expect(() => parseSignedSums(`${"a".repeat(64)}  x.zip\n${"b".repeat(64)}  x.zip\n`)).toThrow(
      /2 values/,
    );
  });

  it("names the archive whose pin differs from the signed sums", async () => {
    const pins = await loadPins();
    const sums = parseSignedSums(signed);
    sums.set("syncthing-linux-amd64-v2.1.7.tar.gz", "0".repeat(64));
    expect(comparePins(pins, sums)).toEqual([
      expect.stringContaining("linux-x64: syncthing-linux-amd64-v2.1.7.tar.gz has 000"),
    ]);
  });

  it("accepts only a VALIDSIG line of the pinned fingerprint", () => {
    const fpr = "FBA2E162F2F44657B38F0309E5665F9BD5970C47";
    const good = `[GNUPG:] GOODSIG E5665F9BD5970C47 Syncthing\n[GNUPG:] VALIDSIG ${fpr} 2026-10-21 1792562700 0 4 0 1 8 01 ${fpr}`;
    expect(hasValidSignature(good, fpr)).toBe(true);
    expect(hasValidSignature(good.replaceAll(fpr, "A".repeat(40)), fpr)).toBe(false);
    expect(hasValidSignature("[GNUPG:] BADSIG E5665F9BD5970C47", fpr)).toBe(false);
  });

  it("refuses an archive with another sha256 and writes no binary", async () => {
    const pins = await loadPins();
    expect(() => checkArchive(Buffer.from("x"), "a.zip", "0".repeat(64))).toThrow(/not the pinned/);
    const dest = await mkdtemp(join(tmpdir(), "aw-pin-"));
    try {
      await expect(
        fetchEngine({
          pins,
          platform: "linux-x64",
          dest,
          archiveBytes: Buffer.from("not the archive"),
        }),
      ).rejects.toThrow(/not the pinned/);
      expect(await readdir(dest)).toEqual([]);
    } finally {
      await rm(dest, { recursive: true, force: true });
    }
    expect(sha256(Buffer.from(""))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("maps the OS and the architecture", () => {
    expect(platformKey("darwin", "arm64")).toBe("darwin-arm64");
    expect(platformKey("linux", "x64")).toBe("linux-x64");
    expect(platformKey("win32", "x64")).toBeNull();
  });
});

describe("config template", () => {
  it("escapes the values and reads them back", () => {
    const text = renderConfig({
      version: "52",
      deviceId: "CLYYKI3-6JVFTIF-CRK4YG6-AE5MVQQ-C2JKFAK-CS45ZZF-4RQXQCT-GNZA4QG",
      name: "mac<&>",
      socket: "/tmp/a&b/sync.sock",
      apiKey: "k&y",
      listen: "tcp://0.0.0.0:22300",
    });
    expect(text).toContain('name="mac&lt;&amp;&gt;"');
    expect(readConfigText(text)).toEqual({
      version: "52",
      deviceId: "CLYYKI3-6JVFTIF-CRK4YG6-AE5MVQQ-C2JKFAK-CS45ZZF-4RQXQCT-GNZA4QG",
      apiKey: "k&y",
      socket: "/tmp/a&b/sync.sock",
    });
    for (const off of [
      "globalAnnounceEnabled",
      "localAnnounceEnabled",
      "relaysEnabled",
      "natEnabled",
    ]) {
      expect(text).toContain(`<${off}>false</${off}>`);
    }
    expect(escapeXml(`"'`)).toBe("&quot;&apos;");
  });

  it("knows an AW config from the config of syncthing generate", () => {
    const socket = "/tmp/aw/run/sync.sock";
    const text = renderConfig({
      version: "52",
      deviceId: "CLYYKI3-6JVFTIF-CRK4YG6-AE5MVQQ-C2JKFAK-CS45ZZF-4RQXQCT-GNZA4QG",
      name: "macbook-pro",
      socket,
      apiKey: "key",
      listen: "tcp://0.0.0.0:22300",
    });
    expect(isAwConfig(text, socket)).toBe(true);
    // Another AW_HOME: the socket differs.
    expect(isAwConfig(text, "/tmp/other/run/sync.sock")).toBe(false);
    // The lines of `syncthing generate` v2.1.7 (2026-11-22): GUI on TCP 8384, NAT and reports on.
    const generated = text
      .replace(`<address>${socket}</address>`, "<address>127.0.0.1:8384</address>")
      .replace("<natEnabled>false</natEnabled>", "<natEnabled>true</natEnabled>")
      .replace("<urAccepted>-1</urAccepted>", "<urAccepted>0</urAccepted>")
      .replace(
        "<crashReportingEnabled>false</crashReportingEnabled>",
        "<crashReportingEnabled>true</crashReportingEnabled>",
      );
    expect(isAwConfig(generated, socket)).toBe(false);
    expect(
      isAwConfig(
        text.replace("<natEnabled>false</natEnabled>", "<natEnabled>true</natEnabled>"),
        socket,
      ),
    ).toBe(false);
    expect(isAwConfig(text.replace("<apikey>key</apikey>", "<apikey></apikey>"), socket)).toBe(
      false,
    );
  });
});

describe("conflict copy of a device-owned file", () => {
  const path = "tasks/devices/macbook-pro/bindings.yaml";
  const copy = "tasks/devices/macbook-pro/bindings.sync-conflict-20261123-120000-ABCDEFG.yaml";

  async function setup(original: string, copyText: string, journaled: string[]) {
    const base = await mkdtemp(join(tmpdir(), "aw-owned-"));
    const root = join(base, "w");
    await mkdir(join(root, "tasks", "devices", "macbook-pro"), { recursive: true });
    await writeFile(join(root, ...path.split("/")), original);
    await writeFile(join(root, ...copy.split("/")), copyText);
    const journal = new WriteJournal(join(base, "journal"), () => 0);
    for (const text of journaled) await journal.record("w", path, text);
    const files = openWorkspace({ root, device: "macbook-pro", role: "local", clock: systemClock });
    const me = { device: "macbook-pro", rank: 0 };
    const ctx: ResolveContext = {
      workspace: "w",
      files,
      journal,
      me,
      byShortId: () => null,
      folderDevices: () => [me],
      originalModifiedBy: () => Promise.resolve(null),
      elected: () => true,
      historyDir: join(base, "history"),
      log: { debug() {}, info() {}, warn() {}, error() {} },
    };
    const history = async () =>
      Promise.all(
        (await readdir(ctx.historyDir).catch(() => [] as string[])).map((name) =>
          readFile(join(ctx.historyDir, name), "utf8"),
        ),
      );
    return { base, root, ctx, history };
  }

  it("keeps the version that the owner wrote and stores the other one in the history", async () => {
    // The owner wrote the copy; a hand edit on another device is newer and won the name.
    const owner = "kind: bindings\nmay_run: true\n";
    const edit = "kind: bindings\nmay_run: false\n";
    const t = await setup(edit, owner, [owner]);
    try {
      const outcome = await resolveCopy(copy, t.ctx);
      expect(outcome.action).toBe("restored_copy");
      expect(await readFile(join(t.root, ...path.split("/")), "utf8")).toBe(owner);
      expect(await t.history()).toEqual([edit]);
    } finally {
      await rm(t.base, { recursive: true, force: true });
    }
  });

  it("keeps the engine winner when the owner wrote it, and stores the copy in the history", async () => {
    const owner = "kind: bindings\nmay_run: true\n";
    const edit = "kind: bindings\nmay_run: false\n";
    const t = await setup(owner, edit, [owner]);
    try {
      const outcome = await resolveCopy(copy, t.ctx);
      expect(outcome.action).toBe("removed_owned_copy");
      expect(await readFile(join(t.root, ...path.split("/")), "utf8")).toBe(owner);
      expect(await t.history()).toEqual([edit]);
    } finally {
      await rm(t.base, { recursive: true, force: true });
    }
  });
});

describe("status rules", () => {
  const connected = rest.connection_lan as EngineConnection;
  const paused = rest.connection_paused as EngineConnection;
  const valid = rest.completion_valid as EngineCompletion;
  const behind = rest.completion_paused_peer as EngineCompletion;
  const folder = { folder: "aw-w-knowledge", workspace: "w", kind: "knowledge" as const };

  it("counts a folder as synced only with a connection, 0 items and a valid remote state", () => {
    expect(folderStatus(folder, valid, true).inSync).toBe(true);
    expect(folderStatus(folder, valid, false).inSync).toBe(false);
    expect(folderStatus(folder, { ...valid, remoteState: "unknown" }, true).inSync).toBe(false);
    expect(folderStatus(folder, behind, true)).toMatchObject({ needItems: 1, inSync: false });
    expect(folderStatus(folder, null, true).inSync).toBe(false);
  });

  it("reports an offline peer as not synced with its items, never as 100 %", () => {
    const peer = peerStatus({
      device: "ubuntu-01",
      connection: paused,
      folders: [folderStatus(folder, behind, false)],
    });
    expect(peer).toMatchObject({ connected: false, inSync: false, needItems: 1 });
    expect(pendingOf(peer, false)).toEqual({ device: "ubuntu-01", items: 1, reason: "offline" });
    expect(describePeer(peer, Date.now())).toBe("1 change not synced to ubuntu-01 (offline)");
    expect(describePeer({ ...peer, needItems: 3 }, Date.now())).toBe(
      "3 changes not synced to ubuntu-01 (offline)",
    );
  });

  it("never moves the sync time at a poll, and sets it at the first poll in sync (kb-4)", () => {
    const at = "2026-11-24T07:26:07.995Z";
    const poll = "2026-11-24T07:26:18.291Z";
    expect(lastSyncedAfterPoll(at, true, poll)).toBe(at);
    expect(lastSyncedAfterPoll(at, false, poll)).toBe(at);
    expect(lastSyncedAfterPoll(undefined, true, poll)).toBe(poll);
    expect(lastSyncedAfterPoll(undefined, false, poll)).toBeUndefined();
  });

  it("says Synced with the age", () => {
    const now = Date.parse("2026-11-23T10:00:12Z");
    const peer = peerStatus({
      device: "ubuntu-01",
      connection: connected,
      folders: [folderStatus(folder, valid, true)],
      lastSynced: "2026-11-23T10:00:00Z",
    });
    expect(peer.route).toBe("lan");
    expect(describePeer(peer, now)).toBe("Synced 12 s ago");
    expect(ago("2026-11-23T09:55:00Z", now)).toBe("5 min ago");
    expect(pendingOf(peer, true)).toBeNull();
  });

  it("names the route", () => {
    expect(isTailscale("100.101.1.2:22300")).toBe(true);
    expect(isTailscale("100.128.1.2:22300")).toBe(false);
    expect(routeOf({ ...connected, address: "100.64.0.9:22300", isLocal: false })).toBe(
      "tailscale",
    );
    expect(routeOf({ ...connected, type: "relay-client", isLocal: false })).toBe("relay");
    expect(routeOf({ ...connected, address: "198.51.100.4:22300", isLocal: false })).toBe(
      "internet",
    );
    expect(routeOf(paused)).toBeUndefined();
  });

  it("restarts with a backoff from 1 s to 60 s", () => {
    expect([0, 1, 2, 5, 6, 10].map(backoffMs)).toEqual([1000, 2000, 4000, 32_000, 60_000, 60_000]);
  });

  it("stops only a syncthing process of the AW home", () => {
    const home = "/srv/aw/sync";
    const aw = `/srv/aw/engine/syncthing serve --home=${home} --no-browser`;
    expect(isEngineOf("syncthing", aw, home)).toBe(true);
    // The user's own Syncthing after a reboot can have an old pid of the pid file.
    expect(isEngineOf("syncthing", "/usr/bin/syncthing serve --no-browser", home)).toBe(false);
    expect(isEngineOf("syncthing", "syncthing serve --home=/srv/other/syncthing", home)).toBe(
      false,
    );
    expect(isEngineOf("node", aw, home)).toBe(false);
    expect(isEngineOf(null, null, home)).toBe(false);
  });

  it("compares the folder config before a PUT", () => {
    const current = {
      id: "aw-w-tasks",
      label: "tasks",
      path: "/w/tasks",
      type: "sendreceive",
      devices: [{ deviceID: "B" }, { deviceID: "A" }],
      fsWatcherEnabled: true,
      fsWatcherDelayS: 1,
      rescanIntervalS: 3600,
      maxConflicts: 10,
      paused: false,
      versioning: {
        type: "simple",
        params: { keep: "10" },
        cleanupIntervalS: 3600,
        fsPath: "/v",
        fsType: "basic",
      },
    };
    const wanted = { ...current, devices: [{ deviceID: "A" }, { deviceID: "B" }] };
    expect(SyncthingTransport.folderMatches(current, wanted)).toBe(true);
    expect(SyncthingTransport.folderMatches(current, { ...wanted, maxConflicts: 0 })).toBe(false);
    expect(
      SyncthingTransport.folderMatches(current, { ...wanted, devices: [{ deviceID: "A" }] }),
    ).toBe(false);
  });
});

describe("priority rule", () => {
  const order = ["ubuntu-01", "mac-mini-lab"];
  const devices: RankedDevice[] = [
    { device: "macbook-pro", role: "local" },
    { device: "ubuntu-01", role: "remote" },
    { device: "mac-mini-lab", role: "remote" },
    { device: "pixel-9", role: "mobile" },
  ];
  const rank = rankOf(devices, order);
  const author = (device: string) => ({ device, rank: rank(device) });
  const [local, remote, second, phone] = devices.map((d) => author(d.device));

  it("orders local, then remote by the device order, then mobile", () => {
    expect(local!.rank).toBeLessThan(remote!.rank);
    expect(remote!.rank).toBeLessThan(second!.rank);
    expect(second!.rank).toBeLessThan(phone!.rank);
  });

  it("gives the same ranks on each device, also to devices not in the device order", () => {
    // Only the device that made the workspace is in device_order (daemon initWorkspace).
    const a: RankedDevice = { device: "ubuntu-01", role: "remote" };
    const b: RankedDevice = { device: "laptop-02", role: "remote" };
    const fromA = rankOf([a, b], ["macbook-pro"]);
    const fromB = rankOf([b, a], ["macbook-pro"]);
    expect([fromA("ubuntu-01"), fromA("laptop-02")]).toEqual([
      fromB("ubuntu-01"),
      fromB("laptop-02"),
    ]);
    const decide = (r: (d: string) => number) =>
      decideShared({
        copyAuthor: { device: "ubuntu-01", rank: r("ubuntu-01") },
        originalAuthor: { device: "laptop-02", rank: r("laptop-02") },
      }).keep;
    expect(decide(fromA)).toBe(decide(fromB));
  });

  it("elects exactly one of 2 remote devices that are not in the device order", () => {
    // macbook-pro (local) is asleep: ubuntu-01 and laptop-02 are online together.
    const local: RankedDevice = { device: "macbook-pro", role: "local" };
    const a: RankedDevice = { device: "ubuntu-01", role: "remote" };
    const b: RankedDevice = { device: "laptop-02", role: "remote" };
    const online = (device: string) => device !== "macbook-pro";
    const elected = [
      isElected(a, [local, b], online, ["macbook-pro"]),
      isElected(b, [local, a], online, ["macbook-pro"]),
    ];
    expect(elected.filter(Boolean)).toHaveLength(1);
    // The slug breaks the tie: laptop-02 sorts first.
    expect(elected).toEqual([false, true]);
    // With the local device online, only it resolves.
    expect(isElected(a, [local, b], () => true, [])).toBe(false);
    expect(isElected(b, [local, a], () => true, [])).toBe(false);
    expect(isElected(local, [a, b], () => true, [])).toBe(true);
  });

  it("keeps the version of the author with the higher priority", () => {
    expect(decideShared({ copyAuthor: local!, originalAuthor: remote! }).keep).toBe("copy");
    expect(decideShared({ copyAuthor: remote!, originalAuthor: local! }).keep).toBe("original");
    expect(decideShared({ copyAuthor: phone!, originalAuthor: second! }).keep).toBe("original");
    expect(decideShared({ copyAuthor: null, originalAuthor: remote! }).keep).toBe("original");
    expect(decideShared({ copyAuthor: local!, originalAuthor: null }).keep).toBe("original");
  });

  it("checks the check characters of a device id", () => {
    const id = "MWAQSX5-ZFSDHGU-35OVA2B-KC7KOTN-6WWXH2J-T652RXX-EB32OIJ-N5QZ2A5";
    expect(isSyncId(id)).toBe(true);
    expect(isSyncId("CLYYKI3-6JVFTIF-CRK4YG6-AE5MVQQ-C2JKFAK-CS45ZZF-4RQXQCT-GNZA4QG")).toBe(true);
    // One changed character (a typo) breaks the check of its group.
    expect(isSyncId(id.replace("ZFSDHGU", "ZFSDHGV"))).toBe(false);
    expect(isSyncId(id.toLowerCase())).toBe(false);
  });

  it("takes the short id from the device id", () => {
    expect(shortId("5NRSCRM-EBSEQFK-QNF5TAK-VWPOCL5-ZSWAWL3-RGEZFBQ-4Z53HNX-4RPKHQV")).toBe(
      "5NRSCRM",
    );
  });
});

describe("engine REST replies", () => {
  it("parses a captured reply and refuses one with a missing field", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aw-rest-"));
    const socket = join(dir, "s.sock");
    let body: unknown = rest.completion_valid;
    const server = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    try {
      const engine = new EngineRest({ socket, apiKey: "k" });
      expect(await engine.completion("f", "d")).toMatchObject({
        needItems: 0,
        remoteState: "valid",
      });
      body = { ...(rest.completion_valid as EngineCompletion), remoteState: undefined };
      const error = await engine.completion("f", "d").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(EngineRestError);
      expect((error as Error).message).toMatch(/remoteState/);
      body = { connections: { X: { connected: "yes" } } };
      await expect(engine.connections()).rejects.toThrow(/not valid/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("write journal", () => {
  it("keeps the last hashes per path after a reload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aw-journal-"));
    try {
      const journal = new WriteJournal(dir, () => 0);
      const first = await journal.record("w", "knowledge/shared/a.md", "one");
      for (let i = 0; i < 20; i += 1) await journal.record("w", "knowledge/shared/a.md", `v${i}`);
      const again = new WriteJournal(dir, () => 0);
      expect(await again.has("w", "knowledge/shared/a.md", first)).toBe(false);
      expect(await again.has("w", "knowledge/shared/a.md", sha256(Buffer.from("v19")))).toBe(true);
      expect(await again.has("w", "knowledge/shared/b.md", sha256(Buffer.from("v19")))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("conflict copy that is a link (final check fc1-2)", () => {
  it("never reads a linked copy, so a private file never goes into a synced file", async () => {
    const base = await mkdtemp(join(tmpdir(), "aw-link-copy-"));
    const root = join(base, "w");
    await mkdir(join(root, "knowledge", "shared"), { recursive: true });
    const secret = join(base, "id_ed25519");
    await writeFile(secret, "PRIVATE-KEY-BYTES\n");
    const copy = "knowledge/shared/notes.sync-conflict-20261124-101010-ABCDEFG.md";
    await symlink(secret, join(root, ...copy.split("/")));
    const files = openWorkspace({ root, device: "macbook-pro", role: "local", clock: systemClock });
    const me = { device: "macbook-pro", rank: 0 };
    const ctx: ResolveContext = {
      workspace: "w",
      files,
      journal: new WriteJournal(join(base, "journal"), () => 0),
      me,
      byShortId: () => null,
      folderDevices: () => [me],
      originalModifiedBy: () => Promise.resolve(null),
      elected: () => true,
      historyDir: join(base, "history"),
      log: { debug() {}, info() {}, warn() {}, error() {} },
    };
    try {
      const outcome = await resolveCopy(copy, ctx);
      expect(outcome.action).toBe("left_not_regular");
      await expect(readFile(join(root, "knowledge", "shared", "notes.md"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readdir(ctx.historyDir).catch(() => [])).toEqual([]);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
