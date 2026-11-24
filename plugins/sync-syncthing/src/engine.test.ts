// The engine with the real pinned binary: the config before the first start, the supervision and
// the stop (openspec add-syncthing-sync, sync-engine).
import { systemClock, type Clock } from "@aw/core";
import { execa } from "execa";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { engineDeviceId, isAwConfig, readConfigText } from "./config.ts";
import { EngineRest } from "./rest.ts";
import { commandName, EngineSupervisor } from "./supervisor.ts";
import {
  ensureTestEngine,
  freePort,
  memoryLog,
  testNode,
  waitFor,
  type TestNode,
} from "./testing.ts";

/**
 * Log lines of third-party traffic. The patterns come from the engine log of the verification on
 * 2026-11-22 with the default config: "global discovery server", "Joined relay", "Relay listener",
 * "Detected NAT", "New external port opened" (UPnP, NAT-PMP).
 */
const LEAK_LINE =
  /global discovery|discovery\.syncthing|relay|\bnat\b|upnp|nat-pmp|external port|stun|usage report|crash report|data\.syncthing/i;

let binary: string;
let node: TestNode;

beforeAll(async () => {
  binary = await ensureTestEngine();
  node = await testNode({ binary, slug: "macbook-pro", role: "local", workspace: "ws1" });
  await node.transport.start();
}, 120_000);

afterAll(async () => {
  await node?.close();
});

describe("first start", () => {
  it("writes the AW config before the first serve", async () => {
    const text = await readFile(join(node.home, "sync", "config.xml"), "utf8");
    const config = readConfigText(text);
    expect(config.socket).toBe(join(node.home, "run", "sync.sock"));
    expect(config.apiKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(text).toContain('name="macbook-pro"');
    expect(text).toContain("<natEnabled>false</natEnabled>");
    expect(text).toContain("<urAccepted>-1</urAccepted>");
    expect(node.transport.state).toBe("running");
    expect(node.transport.syncId).toMatch(/^[A-Z2-7]{7}(-[A-Z2-7]{7}){7}$/);
  });

  it("has no discovery, relay, NAT or report line in the engine log", async () => {
    const log = await readFile(join(node.home, "logs", "sync-engine.log"), "utf8");
    expect(log).toContain("GUI and API listening");
    expect(log.split("\n").filter((line) => LEAK_LINE.test(line))).toEqual([]);
  });

  it("applies the community switch at once, with no engine restart", async () => {
    // Off stays off: a test never sends traffic to the community servers.
    expect(await node.transport.setCommunity(false)).toBe(true);
    const config = readConfigText(await readFile(join(node.home, "sync", "config.xml"), "utf8"));
    const rest = new EngineRest({ socket: config.socket!, apiKey: config.apiKey! });
    expect(await rest.restartRequired()).toBe(false);
  });

  it("turns on only local discovery with the community switch off", async () => {
    const options = await node.transport.engineOptions();
    expect(options).toMatchObject({
      localAnnounceEnabled: true,
      globalAnnounceEnabled: false,
      relaysEnabled: false,
      natEnabled: false,
      urAccepted: -1,
      crashReportingEnabled: false,
      autoUpgradeIntervalH: 0,
      reconnectionIntervalS: 60,
    });
  });
});

describe("supervision", () => {
  it("starts the engine again after SIGKILL", async () => {
    const [pid] = node.transport.pids;
    expect(pid).toBeGreaterThan(0);
    process.kill(pid!, "SIGKILL");
    await waitFor(
      () => node.transport.state === "restarting" || node.transport.state === "starting",
      5000,
    );
    // Within 10 s: the exit starts the restart at once (the health check needs 30 s).
    await waitFor(
      () => node.transport.state === "running" && node.transport.pids[0] !== pid,
      10_000,
    );
    expect(node.log.entries.some((e) => e.msg === "The sync engine exited")).toBe(true);
  }, 60_000);

  it("leaves no engine process after stop", async () => {
    const pids = node.transport.pids;
    await node.transport.stop();
    expect(node.transport.state).toBe("stopped");
    for (const pid of pids) expect(await commandName(pid)).toBeNull();
    // A peer is saved only after the engine has it.
    await expect(
      node.transport.addPeer({
        device: "ubuntu-01",
        sync_id: "MWAQSX5-ZFSDHGU-35OVA2B-KC7KOTN-6WWXH2J-T652RXX-EB32OIJ-N5QZ2A5",
        role: "remote",
        addresses: ["tcp://127.0.0.1:1"],
      }),
    ).rejects.toThrow(/not running/);
    expect(node.transport.peers).toEqual([]);
    await expect(readFile(join(node.home, "sync-peers.json"), "utf8")).rejects.toThrow(/ENOENT/);
  }, 30_000);

  it("stops an engine that an earlier awd left, then starts", async () => {
    await node.transport.start();
    const old = node.transport.pids;
    // A new transport on the same home: like awd after a crash with the engine still running.
    const second = await testNode({ binary, slug: "macbook-pro", role: "local", workspace: "ws1" });
    try {
      const { SyncthingTransport } = await import("./transport.ts");
      const { systemClock } = await import("@aw/core");
      const again = new SyncthingTransport({
        binary,
        home: node.home,
        device: { slug: "macbook-pro", role: "local" },
        listen: `tcp://127.0.0.1:${node.port}`,
        community: false,
        clock: systemClock,
        log: second.log,
      });
      await again.start();
      for (const pid of old) expect(await commandName(pid)).toBeNull();
      expect(again.state).toBe("running");
      expect(
        second.log.entries.some((e) => e.msg === "Stopping a sync engine of an earlier awd"),
      ).toBe(true);
      await again.stop();
    } finally {
      await second.close();
    }
  }, 60_000);
});

describe("supervisor", () => {
  async function supervisor(options: {
    onStart?: () => Promise<void>;
    clock?: Clock;
    healthMs?: number;
    binary?: string;
    /** A folder name under the temp base, to make the socket path long. */
    runDir?: string;
  }) {
    const base = await mkdtemp(join(tmpdir(), "awv-"));
    const log = memoryLog();
    const engine = new EngineSupervisor({
      binary: options.binary ?? binary,
      config: {
        home: join(base, "sync"),
        socket: join(base, options.runDir ?? "run", "sync.sock"),
        name: "macbook-pro",
        listen: `tcp://127.0.0.1:${await freePort()}`,
      },
      logFile: join(base, "logs", "sync-engine.log"),
      clock: options.clock ?? systemClock,
      log,
      ...(options.onStart ? { onStart: options.onStart } : {}),
      ...(options.healthMs ? { healthMs: options.healthMs } : {}),
    });
    return {
      base,
      engine,
      log,
      async close() {
        await engine.stop();
        await rm(base, { recursive: true, force: true });
      },
    };
  }

  it("keeps the engine running when a config step fails, and runs the step again", async () => {
    let calls = 0;
    const s = await supervisor({
      healthMs: 200,
      onStart: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error("read-only folder")) : Promise.resolve();
      },
    });
    try {
      await s.engine.start();
      expect(s.engine.state).toBe("running");
      const pids = s.engine.pids;
      await waitFor(() => calls >= 2, 10_000);
      expect(s.engine.state).toBe("running");
      expect(s.engine.pids).toEqual(pids);
      expect(s.engine.generation).toBe(1);
      expect(
        s.log.entries.some((e) => e.msg?.startsWith("The sync engine config step failed")),
      ).toBe(true);
    } finally {
      await s.close();
    }
  }, 60_000);

  it("stops at once during a restart backoff", async () => {
    // A restart delay (1 s and more) never ends with this clock: only stop() ends it.
    const clock: Clock = {
      now: () => Date.now(),
      sleep: (ms) => (ms >= 1000 ? new Promise<void>(() => undefined) : systemClock.sleep(ms)),
    };
    const s = await supervisor({ clock });
    try {
      await s.engine.start();
      const [pid] = s.engine.pids;
      process.kill(pid!, "SIGKILL");
      await waitFor(() => s.engine.state === "restarting", 10_000);
      const started = Date.now();
      await s.engine.stop();
      expect(Date.now() - started).toBeLessThan(5000);
      expect(s.engine.state).toBe("stopped");
    } finally {
      await s.close();
    }
  }, 60_000);

  it("replaces the config of syncthing generate that an awd stop left, before the first serve", async () => {
    const s = await supervisor({});
    try {
      // awd stopped after `generate` and before the rename of the AW config.xml.
      const home = join(s.base, "sync");
      await execa(binary, ["generate", `--home=${home}`, "--no-port-probing"], {
        env: { STNODEFAULTFOLDER: "1" },
      });
      const generated = await readFile(join(home, "config.xml"), "utf8");
      expect(generated).toContain("<natEnabled>true</natEnabled>");
      const id = await engineDeviceId(binary, home);
      await s.engine.start();
      expect(s.engine.state).toBe("running");
      expect(s.engine.deviceId).toBe(id);
      const text = await readFile(join(home, "config.xml"), "utf8");
      expect(isAwConfig(text, join(s.base, "run", "sync.sock"))).toBe(true);
      expect(
        s.log.entries.some((e) => e.msg?.startsWith("The engine config.xml was not an AW config")),
      ).toBe(true);
      const log = await readFile(join(s.base, "logs", "sync-engine.log"), "utf8");
      expect(log).toContain("GUI and API listening");
      expect(log.split("\n").filter((line) => LEAK_LINE.test(line))).toEqual([]);
    } finally {
      await s.close();
    }
  }, 60_000);

  it("is failed and tries again when the engine home cannot be prepared", async () => {
    // A binary that cannot run (for example of another architecture).
    const dir = await mkdtemp(join(tmpdir(), "awb-"));
    const broken = join(dir, "syncthing");
    await writeFile(broken, "#!/bin/sh\necho 'exec format error' >&2\nexit 126\n");
    await chmod(broken, 0o755);
    const s = await supervisor({ binary: broken });
    try {
      await s.engine.start();
      expect(s.engine.state).toBe("failed");
      expect(
        s.log.entries.some(
          (e) => e.msg === "The sync engine home was not prepared; awd tries again",
        ),
      ).toBe(true);
      // The restart loop tries the prepare again after the backoff (1 s).
      await waitFor(
        () => s.log.entries.some((e) => e.msg === "The sync engine restart failed"),
        10_000,
      );
      expect(s.engine.state).toBe("failed");
    } finally {
      await s.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("is failed with a clear message when the engine socket path is too long", async () => {
    const s = await supervisor({ runDir: "r".repeat(110) });
    try {
      await s.engine.start();
      expect(s.engine.state).toBe("failed");
      const entry = s.log.entries.find(
        (e) => e.msg === "The sync engine home was not prepared; awd tries again",
      );
      expect(String((entry?.obj as { err?: Error }).err?.message)).toMatch(
        /sync\.sock is longer than 103 bytes\. Use a shorter AW_HOME/,
      );
    } finally {
      await s.close();
    }
  }, 30_000);
});
