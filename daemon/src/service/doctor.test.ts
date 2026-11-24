// The setup check (spec setup-check). The checks are pure functions of the probe results; the
// probes are fakes here. The pmset and sntp texts copy real output of macOS 26 (2026-11-23, a
// MacBook; the server address removed).
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../api/app.ts";
import { routeAccess, type Access } from "../api/caller.ts";
import { createLogger } from "../log.ts";
import { loadSettings } from "../settings.ts";
import { Daemon } from "./daemon.ts";
import {
  clockCheck,
  diskCheck,
  localProbes,
  loginCheck,
  macChecks,
  ntpServer,
  parseSntpOffset,
  pmsetValue,
  runDoctor,
  serviceCheck,
  sessionHostChecks,
  syncChecks,
  type DoctorProbes,
} from "./doctor.ts";

const PMSET_LAPTOP = `System-wide power settings:
Currently in use:
 standby              1
 Sleep On Power Button 1
 hibernatefile        /var/vm/sleepimage
 powernap             1
 networkoversleep     0
 disksleep            10
 sleep                1 (sleep prevented by caffeinate, powerd)
 hibernatemode        3
 ttyskeepawake        1
 displaysleep         10 (display sleep prevented by caffeinate)
 tcpkeepalive         1
 powermode            0
 womp                 1
`;

const NOW = Date.parse("2026-11-23T12:00:00Z");

describe("checks", () => {
  it("service: missing, not loaded, no linger, ok", () => {
    expect(serviceCheck("darwin", null, null)).toMatchObject({
      status: "fail",
      fix: expect.stringContaining("sudo aw service install --headless") as string,
    });
    expect(serviceCheck("linux", { kind: "systemd", loaded: false }, true).status).toBe("fail");
    expect(serviceCheck("linux", { kind: "systemd", loaded: true }, false)).toMatchObject({
      status: "warn",
      fix: expect.stringContaining("loginctl enable-linger") as string,
    });
    expect(serviceCheck("darwin", { kind: "launch-agent", loaded: true }, null).status).toBe("ok");
  });

  it("session host: a missing tmux names the install command; Orca only when asked", () => {
    const [tmux] = sessionHostChecks(null, "sudo apt install tmux", null);
    expect(tmux).toMatchObject({
      status: "fail",
      fix: "Install it: sudo apt install tmux. When it is installed, run aw service install again: the unit takes the PATH of the terminal.",
    });
    expect(sessionHostChecks("/usr/bin/tmux", null, null)).toHaveLength(1);
    const orca = sessionHostChecks("/usr/bin/tmux", null, {
      available: false,
      version: null,
      reason: "not found",
    });
    expect(orca[1]).toMatchObject({ id: "orca", status: "warn" });
  });

  it("Claude sign-in: logged out, ends soon, ended, unknown", () => {
    expect(loginCheck({ loggedIn: false, expiresAt: null }, NOW)).toMatchObject({
      status: "fail",
      fix: expect.stringContaining("Run claude in a terminal") as string,
    });
    expect(loginCheck({ loggedIn: true, expiresAt: "2026-11-24T12:00:00Z" }, NOW).status).toBe(
      "warn",
    );
    expect(loginCheck({ loggedIn: true, expiresAt: "2026-11-22T12:00:00Z" }, NOW).status).toBe(
      "fail",
    );
    expect(loginCheck({ loggedIn: true, expiresAt: null }, NOW).status).toBe("ok");
    expect(loginCheck(new Error("no JSON"), NOW).status).toBe("warn");
  });

  it("disk: warn from 90 %, fail from the limit", () => {
    expect(diskCheck(50, 95).status).toBe("ok");
    expect(diskCheck(91, 95).status).toBe("warn");
    expect(diskCheck(96, 95).status).toBe("fail");
    expect(diskCheck(null, 95).status).toBe("skip");
  });

  it("clock: ntp state, offset limits, no server", () => {
    expect(clockCheck("linux", { kind: "ntp", synced: false })).toMatchObject({
      status: "warn",
      fix: "Run sudo timedatectl set-ntp true.",
    });
    expect(clockCheck("darwin", { kind: "offset", seconds: 0.14 }).status).toBe("ok");
    expect(clockCheck("darwin", { kind: "offset", seconds: -12 }).status).toBe("warn");
    expect(clockCheck("darwin", { kind: "offset", seconds: 90 }).status).toBe("fail");
    expect(clockCheck("darwin", { kind: "no_server" }).status).toBe("warn");
    expect(parseSntpOffset("+0.145986 +/- 0.074665 time.example.com 192.0.2.1\n")).toBeCloseTo(
      0.145986,
    );
    expect(parseSntpOffset("sntp: no reply")).toBeNull();
    expect(ntpServer("server time.example.com\n")).toBe("time.example.com");
  });

  it("sync: a missing engine fails with aw engine install; a peer that is not connected warns", () => {
    const [engine] = syncChecks({ state: "not_installed", peers: [] }, NOW);
    expect(engine).toMatchObject({
      id: "sync_engine",
      status: "fail",
      fix: expect.stringContaining("aw engine install") as string,
    });
    const checks = syncChecks(
      {
        state: "running",
        peers: [
          { device: "ubuntu-01", connected: false, lastSeen: "2026-11-23T11:50:00Z" },
          { device: "pixel-9", connected: true },
        ],
      },
      NOW,
    );
    expect(checks[1]).toMatchObject({
      id: "device:ubuntu-01",
      status: "warn",
      detail: "Not connected. Last seen 10 min ago.",
      fix: expect.stringContaining("ubuntu-01 is on") as string,
    });
    expect(checks[2]).toMatchObject({ id: "device:pixel-9", status: "ok" });
  });

  it("sync: an installed engine with awd stopped is no second failure (gap-install low 8)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "awd-doctor-"));
    const engine = join(dir, "syncthing");
    await writeFile(engine, "#!/bin/sh\n");
    await chmod(engine, 0o755);
    const settings = loadSettings({ AW_HOME: dir, HOME: dir, AW_SYNC_ENGINE: engine });
    const probe = await localProbes(settings, "linux", 1000).sync();
    expect(syncChecks(probe, NOW)[0]).toMatchObject({
      id: "sync_engine",
      status: "skip",
      detail: "The sync engine is installed. awd does not answer, so its state is not known.",
    });
  });

  it("macOS: sleep warns only for a headless Mac; no autorestart line is skip; FileVault", () => {
    expect(pmsetValue(PMSET_LAPTOP, "sleep")).toBe(1);
    expect(pmsetValue(PMSET_LAPTOP, "autorestart")).toBeNull();
    const laptop = macChecks(PMSET_LAPTOP, "FileVault is On.\n", false);
    expect(laptop.map((c) => c.status)).toEqual(["ok", "skip", "ok"]);
    const server = macChecks(
      PMSET_LAPTOP.replace(" sleep                1", " sleep                10") +
        " autorestart          0\n",
      "FileVault is On.\n",
      true,
    );
    expect(server[0]).toMatchObject({ status: "warn", fix: "Run sudo pmset -a sleep 0." });
    expect(server[1]).toMatchObject({ status: "warn", fix: "Run sudo pmset -a autorestart 1." });
    expect(server[2]).toMatchObject({ id: "filevault", status: "warn" });
  });
});

function fakeProbes(overrides: Partial<DoctorProbes> = {}): DoctorProbes {
  return {
    platform: "linux",
    device: "ubuntu-01",
    unit: () => Promise.resolve({ kind: "systemd", loaded: true }),
    linger: () => Promise.resolve(true),
    tmux: () => Promise.resolve("/usr/bin/tmux"),
    tmuxInstall: () => Promise.resolve("sudo apt install tmux"),
    orca: () => Promise.resolve(null),
    agent: () => Promise.resolve({ available: true, binary: "claude", version: "2.1.330" }),
    auth: () => Promise.resolve({ loggedIn: true, expiresAt: null }),
    disk: () => Promise.resolve(40),
    diskLimit: 95,
    clock: () => Promise.resolve({ kind: "ntp", synced: true }),
    sync: () => Promise.resolve({ state: "running", peers: [] }),
    power: () => Promise.resolve(null),
    fileVault: () => Promise.resolve(null),
    now: () => NOW,
    ...overrides,
  };
}

describe("runDoctor", () => {
  it("is ok when each check passes, and not ok with one failed check", async () => {
    const ok = await runDoctor(fakeProbes());
    expect(ok.ok).toBe(true);
    expect(ok.checks.map((c) => c.id)).toEqual([
      "service",
      "session_host",
      "agent",
      "claude_login",
      "disk",
      "clock",
      "sync_engine",
    ]);
    const bad = await runDoctor(
      fakeProbes({ sync: () => Promise.resolve({ state: "not_installed", peers: [] }) }),
    );
    expect(bad.ok).toBe(false);
  });

  it("turns a probe that throws into a warning, and skips the sign-in with no agent", async () => {
    const reply = await runDoctor(
      fakeProbes({
        clock: () => Promise.reject(new Error("timedatectl hung")),
        agent: () => Promise.resolve({ available: false, binary: "claude", version: null }),
      }),
    );
    expect(reply.checks.find((c) => c.id === "clock")).toMatchObject({
      status: "warn",
      detail: "The check did not run: timedatectl hung",
    });
    expect(reply.checks.find((c) => c.id === "claude_login")?.status).toBe("skip");
  });

  it("adds the 3 macOS checks on macOS", async () => {
    const reply = await runDoctor(
      fakeProbes({
        platform: "darwin",
        unit: () => Promise.resolve({ kind: "launch-agent", loaded: true }),
        power: () => Promise.resolve(PMSET_LAPTOP),
        fileVault: () => Promise.resolve("FileVault is Off.\n"),
      }),
    );
    expect(reply.checks.slice(-3).map((c) => c.id)).toEqual(["sleep", "autorestart", "filevault"]);
  });
});

describe("route", () => {
  it("GET /v1/doctor is a person route", async () => {
    // The app needs a daemon object. It never starts, so no file or socket is touched.
    const daemon = new Daemon({
      settings: loadSettings({ AW_HOME: "/nonexistent/aw", HOME: "/nonexistent" }),
      log: createLogger("silent"),
      watch: false,
      heartbeat: false,
    });
    const access = new Map<string, Access>();
    const app = await createApp(daemon, {
      onRoute: (route) => {
        for (const method of [route.method].flat()) {
          access.set(`${method} ${route.url}`, routeAccess(method, route.access));
        }
      },
    });
    await app.ready();
    await app.close();
    expect(access.get("GET /v1/doctor")).toBe("person");
  });
});
