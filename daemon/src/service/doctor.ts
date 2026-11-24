// The setup check (openspec gap-install, setup-check; prd DEV-10, DEV-11): one check per part of
// the device, each with a fix line. The check functions are pure: they turn the result of a probe
// into a check. The probes run the commands (exec form), in awd for `GET /v1/doctor`, or in `aw
// doctor` when awd does not answer.
import type { DoctorCheck, DoctorReply } from "@aw/client/doctor";
import { systemClock } from "@aw/core";
import { execa } from "execa";
import { access, constants, readFile } from "node:fs/promises";
import { diskUse } from "../continuity/processes.ts";
import { localUnitContext } from "../install/context.ts";
import { localTmuxInstallCommand } from "../install/tmux.ts";
import { hostBinary, makeAdapter } from "../sessions/plugins.ts";
import type { Settings } from "../settings.ts";
import { unitStatus, type CommandRunner, type UnitKind } from "../units/units.ts";
import type { Daemon } from "./daemon.ts";

export type { DoctorCheck, DoctorReply };

/** The installed service unit, or null when none is installed. */
export interface UnitProbe {
  kind: UnitKind;
  loaded: boolean;
}

export type ClockProbe =
  | { kind: "ntp"; synced: boolean }
  | { kind: "offset"; seconds: number }
  | { kind: "no_server" }
  | { kind: "unknown"; reason: string };

export interface PeerProbe {
  device: string;
  connected: boolean;
  lastSeen?: string | undefined;
}

export interface SyncProbe {
  state: string;
  peers: PeerProbe[];
}

export interface DoctorProbes {
  platform: NodeJS.Platform;
  device: string;
  unit(): Promise<UnitProbe | null>;
  /** Linux: `loginctl` linger of the user (true, false, or null when not known). */
  linger(): Promise<boolean | null>;
  tmux(): Promise<string | null>;
  tmuxInstall(): Promise<string | null>;
  /** The Orca state when the bindings of this device ask for Orca, else null. */
  orca(): Promise<{ available: boolean; version: string | null; reason: string | null } | null>;
  agent(): Promise<{ available: boolean; binary: string; version: string | null }>;
  auth(): Promise<{ loggedIn: boolean; expiresAt: string | null }>;
  disk(): Promise<number | null>;
  diskLimit: number;
  clock(): Promise<ClockProbe>;
  /** The sync state and its peers, or null when only the binary is known (awd does not run). */
  sync(): Promise<SyncProbe>;
  /** macOS: the text of `pmset -g`. */
  power(): Promise<string | null>;
  /** macOS: the text of `fdesetup status`. */
  fileVault(): Promise<string | null>;
  /** The clock of the probes (the reach text uses it). */
  now(): number;
}

const check = (
  id: string,
  title: string,
  status: DoctorCheck["status"],
  detail: string,
  fix: string | null = null,
): DoctorCheck => ({ id, title, status, detail, fix });

export const AGT_14_TEXT =
  "A plan has a 5-hour limit and a weekly limit. One agent that works day and night uses more than a Pro or Max plan gives. For heavy 24/7 work, use an API key.";

// ---- Checks ---------------------------------------------------------------------------------

export function serviceCheck(
  platform: NodeJS.Platform,
  unit: UnitProbe | null,
  linger: boolean | null,
): DoctorCheck {
  const title = "Service";
  if (unit === null) {
    return check(
      "service",
      title,
      "fail",
      "No service unit is installed, so awd does not start at login or at boot.",
      platform === "darwin"
        ? "Run aw service install (a laptop), or sudo aw service install --headless (a computer with no login)."
        : "Run aw service install.",
    );
  }
  if (!unit.loaded) {
    return check(
      "service",
      title,
      "fail",
      `The ${unit.kind} unit is installed, but it is not loaded.`,
      "Run aw service install again.",
    );
  }
  if (unit.kind === "systemd" && linger === false) {
    return check(
      "service",
      title,
      "warn",
      "The systemd user unit runs, but it starts only after a login.",
      "Run loginctl enable-linger $USER once, so awd starts at boot.",
    );
  }
  const when = unit.kind === "launch-agent" ? "at login" : "at boot";
  return check("service", title, "ok", `The ${unit.kind} unit is loaded and starts awd ${when}.`);
}

/** awd of a service unit has the PATH of the install (fix list 0-24). */
const PATH_AGAIN =
  " When it is installed, run aw service install again: the unit takes the PATH of the terminal.";

export function sessionHostChecks(
  tmux: string | null,
  install: string | null,
  orca: Awaited<ReturnType<DoctorProbes["orca"]>>,
): DoctorCheck[] {
  const checks = [
    tmux
      ? check("session_host", "Session host (tmux)", "ok", `tmux is at ${tmux}.`)
      : check(
          "session_host",
          "Session host (tmux)",
          "fail",
          "tmux is missing: AW sessions need it.",
          `${install ? `Install it: ${install}.` : "Install tmux with the package manager of this system."}${PATH_AGAIN}`,
        ),
  ];
  if (orca) {
    checks.push(
      orca.available
        ? check(
            "orca",
            "Session host (Orca)",
            "ok",
            `Orca ${orca.version ?? ""} is available.`.trim(),
          )
        : check(
            "orca",
            "Session host (Orca)",
            "warn",
            `The bindings of this device ask for Orca, but Orca is not available: ${orca.reason ?? "not found"}. The sessions run in tmux.`,
            "Install Orca, or set AW_ORCA to the Orca CLI, then restart awd.",
          ),
    );
  }
  return checks;
}

export function agentCheck(agent: Awaited<ReturnType<DoctorProbes["agent"]>>): DoctorCheck {
  return agent.available
    ? check("agent", "Claude Code", "ok", `${agent.binary} ${agent.version ?? ""}`.trim())
    : check(
        "agent",
        "Claude Code",
        "fail",
        `${agent.binary} --version did not answer.`,
        `Install Claude Code on this device.${PATH_AGAIN}`,
      );
}

export function loginCheck(
  auth: { loggedIn: boolean; expiresAt: string | null } | Error,
  now: number,
): DoctorCheck {
  const title = "Claude sign-in";
  const fix =
    "Run claude in a terminal on this device and sign in, or set an API key for heavy 24/7 work.";
  if (auth instanceof Error) {
    return check(
      "claude_login",
      title,
      "warn",
      `The sign-in state is not known: ${auth.message}`,
      fix,
    );
  }
  if (!auth.loggedIn)
    return check("claude_login", title, "fail", "Claude Code is not signed in.", fix);
  const end = auth.expiresAt === null ? null : Date.parse(auth.expiresAt);
  if (end !== null && Number.isFinite(end) && end <= now) {
    return check("claude_login", title, "fail", `The sign-in ended at ${auth.expiresAt}.`, fix);
  }
  if (end !== null && Number.isFinite(end) && end - now < 3 * 24 * 60 * 60 * 1000) {
    return check("claude_login", title, "warn", `The sign-in ends at ${auth.expiresAt}.`, fix);
  }
  return check("claude_login", title, "ok", "Claude Code is signed in.");
}

export function diskCheck(used: number | null, limit: number): DoctorCheck {
  if (used === null) return check("disk", "Disk", "skip", "The disk use is not known.");
  const percent = Math.round(used);
  const fix = "Free space on the disk of ~/.aw: remove old worktrees, logs or caches.";
  if (used >= limit) {
    return check(
      "disk",
      "Disk",
      "fail",
      `The disk is ${percent} % full: no new session starts.`,
      fix,
    );
  }
  if (used >= 90) return check("disk", "Disk", "warn", `The disk is ${percent} % full.`, fix);
  return check("disk", "Disk", "ok", `The disk is ${percent} % full.`);
}

export function clockCheck(platform: NodeJS.Platform, clock: ClockProbe): DoctorCheck {
  const title = "Clock";
  const macFix =
    "Turn on Set time and date automatically in System Settings > General > Date & Time.";
  switch (clock.kind) {
    case "ntp":
      return clock.synced
        ? check("clock", title, "ok", "The clock is synchronized with network time.")
        : check(
            "clock",
            title,
            "warn",
            "The clock is not synchronized with network time.",
            "Run sudo timedatectl set-ntp true.",
          );
    case "offset": {
      const seconds = Math.abs(clock.seconds);
      const detail = `The clock differs from the time server by ${seconds.toFixed(1)} s.`;
      if (seconds > 60) return check("clock", title, "fail", detail, macFix);
      if (seconds > 5) return check("clock", title, "warn", detail, macFix);
      return check("clock", title, "ok", detail);
    }
    case "no_server":
      return check(
        "clock",
        title,
        "warn",
        "No time server is set.",
        platform === "darwin" ? macFix : null,
      );
    case "unknown":
      return check("clock", title, "skip", `The clock state is not known: ${clock.reason}`);
  }
}

export function syncChecks(sync: SyncProbe, now: number): DoctorCheck[] {
  const title = "Sync engine";
  const engine = ((): DoctorCheck => {
    switch (sync.state) {
      case "running":
        return check("sync_engine", title, "ok", "The sync engine runs.");
      case "not_installed":
        return check(
          "sync_engine",
          title,
          "fail",
          "The sync engine is not installed, so sync is off.",
          "Run aw engine install. awd starts the engine within 5 s.",
        );
      case "starting":
      case "restarting":
        return check(
          "sync_engine",
          title,
          "warn",
          `The sync engine is ${sync.state}.`,
          "Wait 1 minute and check again.",
        );
      case "not_configured":
        return check("sync_engine", title, "skip", "awd is starting.");
      case "installed":
        return check(
          "sync_engine",
          title,
          "skip",
          "The sync engine is installed. awd does not answer, so its state is not known.",
        );
      default:
        return check(
          "sync_engine",
          title,
          "fail",
          `The sync engine is ${sync.state}.`,
          "Read ~/.aw/logs/sync-engine.log, then restart awd with aw service install.",
        );
    }
  })();
  const peers = sync.peers.map((peer) => {
    const title = `Device ${peer.device}`;
    if (peer.connected) return check(`device:${peer.device}`, title, "ok", "Connected.");
    const seen = peer.lastSeen ? Date.parse(peer.lastSeen) : Number.NaN;
    const detail = Number.isFinite(seen)
      ? `Not connected. Last seen ${Math.max(0, Math.round((now - seen) / 60_000))} min ago.`
      : "Not connected.";
    return check(
      `device:${peer.device}`,
      title,
      "warn",
      detail,
      `Check that ${peer.device} is on and awd runs there (aw doctor on ${peer.device}), and that both devices are on the same LAN or Tailscale, or that community relays are on.`,
    );
  });
  return [engine, ...peers];
}

/** The number after a key in the `pmset -g` text, or null. */
export function pmsetValue(text: string, key: string): number | null {
  const match = new RegExp(`^\\s*${key}\\s+(\\d+)`, "m").exec(text);
  return match ? Number(match[1]) : null;
}

export function macChecks(
  power: string | null,
  fileVault: string | null,
  headless: boolean,
): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const sleep = power === null ? null : pmsetValue(power, "sleep");
  if (sleep === null) {
    checks.push(check("sleep", "Sleep", "skip", "pmset gave no sleep value."));
  } else if (sleep === 0) {
    checks.push(check("sleep", "Sleep", "ok", "This Mac does not sleep."));
  } else if (headless) {
    checks.push(
      check(
        "sleep",
        "Sleep",
        "warn",
        `This Mac sleeps after ${sleep} min, and the agents stop while it sleeps.`,
        "Run sudo pmset -a sleep 0.",
      ),
    );
  } else {
    checks.push(
      check(
        "sleep",
        "Sleep",
        "ok",
        `This laptop sleeps after ${sleep} min. Use Sync before you close it; the agents run on the other computers.`,
      ),
    );
  }
  const restart = power === null ? null : pmsetValue(power, "autorestart");
  if (restart === null) {
    checks.push(
      check(
        "autorestart",
        "Restart after a power failure",
        "skip",
        "This Mac has no such setting.",
      ),
    );
  } else if (restart === 0) {
    checks.push(
      check(
        "autorestart",
        "Restart after a power failure",
        "warn",
        "This Mac stays off after a power failure.",
        "Run sudo pmset -a autorestart 1.",
      ),
    );
  } else {
    checks.push(
      check(
        "autorestart",
        "Restart after a power failure",
        "ok",
        "This Mac starts again after a power failure.",
      ),
    );
  }
  const on = fileVault === null ? null : /FileVault is On/.test(fileVault);
  if (on === null) {
    checks.push(check("filevault", "FileVault", "skip", "fdesetup gave no state."));
  } else if (on && headless) {
    checks.push(
      check(
        "filevault",
        "FileVault",
        "warn",
        "FileVault is on: after a restart, this Mac waits for a login before awd starts.",
        "Log in after each restart, or turn off FileVault on a computer that must start with no person.",
      ),
    );
  } else {
    checks.push(
      check("filevault", "FileVault", "ok", on ? "FileVault is on." : "FileVault is off."),
    );
  }
  return checks;
}

// ---- The run --------------------------------------------------------------------------------

/** Runs one probe; a probe that throws gives the error. */
async function attempt<T>(probe: () => Promise<T>): Promise<T | Error> {
  try {
    return await probe();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

const failed = (id: string, title: string, error: Error) =>
  check(id, title, "warn", `The check did not run: ${error.message}`);

/** Runs each probe and returns the checks. */
export async function runDoctor(probes: DoctorProbes): Promise<DoctorReply> {
  const now = probes.now();
  const darwin = probes.platform === "darwin";
  // All probes run at once: the 2 calls of the agent can take 15 s each, and the client of the
  // route waits at most 30 s.
  const [unit, linger, tmux, orca, agent, auth, disk, clock, sync, power, fileVault] =
    await Promise.all([
      attempt(() => probes.unit()),
      probes.platform === "linux" ? attempt(() => probes.linger()) : Promise.resolve(null),
      attempt(() => probes.tmux()),
      attempt(() => probes.orca()),
      attempt(() => probes.agent()),
      attempt(() => probes.auth()),
      attempt(() => probes.disk()),
      attempt(() => probes.clock()),
      attempt(() => probes.sync()),
      darwin ? attempt(() => probes.power()) : Promise.resolve(null),
      darwin ? attempt(() => probes.fileVault()) : Promise.resolve(null),
    ]);
  const install = tmux === null ? await attempt(() => probes.tmuxInstall()) : null;
  const checks: DoctorCheck[] = [];
  checks.push(
    unit instanceof Error
      ? failed("service", "Service", unit)
      : serviceCheck(probes.platform, unit, linger instanceof Error ? null : linger),
  );
  checks.push(
    ...(tmux instanceof Error
      ? [failed("session_host", "Session host (tmux)", tmux)]
      : sessionHostChecks(
          tmux,
          install instanceof Error ? null : install,
          orca instanceof Error ? null : orca,
        )),
  );
  checks.push(agent instanceof Error ? failed("agent", "Claude Code", agent) : agentCheck(agent));
  if (!(agent instanceof Error) && agent.available) {
    checks.push(loginCheck(auth, now));
  } else {
    checks.push(check("claude_login", "Claude sign-in", "skip", "Claude Code is not available."));
  }
  checks.push(
    disk instanceof Error ? failed("disk", "Disk", disk) : diskCheck(disk, probes.diskLimit),
  );
  checks.push(
    clock instanceof Error ? failed("clock", "Clock", clock) : clockCheck(probes.platform, clock),
  );
  checks.push(
    ...(sync instanceof Error
      ? [failed("sync_engine", "Sync engine", sync)]
      : syncChecks(sync, now)),
  );
  if (darwin) {
    const headless = !(unit instanceof Error) && unit?.kind === "launch-daemon";
    checks.push(
      ...macChecks(
        power instanceof Error ? null : power,
        fileVault instanceof Error ? null : fileVault,
        headless,
      ),
    );
  }
  return { device: probes.device, ok: checks.every((c) => c.status !== "fail"), checks };
}

// ---- The probes of this computer ------------------------------------------------------------

async function text(file: string, args: string[], timeout = 10_000): Promise<string | null> {
  const result = await execa(file, args, { reject: false, timeout });
  return result.exitCode === 0 ? String(result.stdout ?? "") : null;
}

const commandRunner: CommandRunner = async (file, args) => {
  const result = await execa(file, args, { reject: false, timeout: 10_000 });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
};

/** The installed unit of this user: on macOS the LaunchDaemon first, then the LaunchAgent. */
export async function probeUnit(
  settings: Settings,
  platform: NodeJS.Platform,
  uid: number,
  runner: CommandRunner = commandRunner,
): Promise<UnitProbe | null> {
  const kinds: UnitKind[] =
    platform === "darwin"
      ? ["launch-daemon", "launch-agent"]
      : platform === "linux"
        ? ["systemd"]
        : [];
  const context = localUnitContext(settings, uid);
  for (const kind of kinds) {
    const status = await unitStatus(kind, context, runner);
    if (status.installed) return { kind, loaded: status.loaded };
  }
  return null;
}

/** Parses the offset of `sntp` (`+0.145986 +/- 0.074665 <server> <address>`), or null. */
export function parseSntpOffset(output: string): number | null {
  const match = /^\s*([+-]?\d+(?:\.\d+)?)\s+\+\/-/m.exec(output);
  return match ? Number(match[1]) : null;
}

/** The first `server` of an ntp.conf text, or null. */
export function ntpServer(conf: string): string | null {
  const match = /^\s*server\s+(\S+)/m.exec(conf);
  return match ? match[1]! : null;
}

export async function probeClock(platform: NodeJS.Platform): Promise<ClockProbe> {
  if (platform === "linux") {
    const value = await text("timedatectl", ["show", "-p", "NTPSynchronized", "--value"]).catch(
      () => null,
    );
    if (value === null) return { kind: "unknown", reason: "timedatectl did not answer" };
    return { kind: "ntp", synced: value.trim() === "yes" };
  }
  if (platform === "darwin") {
    // The time server that macOS already uses: no new third party.
    const server = ntpServer(await readFile("/etc/ntp.conf", "utf8").catch(() => ""));
    if (server === null) return { kind: "no_server" };
    const output = await text("sntp", ["-t", "3", server]).catch(() => null);
    const offset = output === null ? null : parseSntpOffset(output);
    return offset === null
      ? { kind: "unknown", reason: `sntp gave no offset for ${server}` }
      : { kind: "offset", seconds: offset };
  }
  return { kind: "unknown", reason: `no clock check for ${platform}` };
}

/** The probes that run with no awd: the unit, tmux, the engine binary, the disk, the clock. */
export function localProbes(
  settings: Settings,
  platform: NodeJS.Platform,
  uid: number,
): DoctorProbes {
  const adapter = makeAdapter(settings);
  return {
    platform,
    device: "this device",
    unit: () => probeUnit(settings, platform, uid),
    linger: async () => {
      const value = await text("loginctl", [
        "show-user",
        String(uid),
        "-p",
        "Linger",
        "--value",
      ]).catch(() => null);
      return value === null ? null : value.trim() === "yes";
    },
    tmux: () => hostBinary(settings),
    tmuxInstall: () => localTmuxInstallCommand(platform),
    orca: () => Promise.resolve(null),
    agent: async () => {
      const info = await adapter.detect();
      return { available: info.available, binary: info.binary, version: info.version };
    },
    auth: () => adapter.authStatus(),
    disk: () => diskUse(settings.home),
    diskLimit: settings.sessions.diskFullPercent,
    clock: () => probeClock(platform),
    sync: async () => {
      const installed = await access(settings.sync.engine, constants.X_OK).then(
        () => true,
        () => false,
      );
      // awd does not answer: only the binary is known (gap-install low 8).
      return { state: installed ? "installed" : "not_installed", peers: [] };
    },
    power: () => (platform === "darwin" ? text("pmset", ["-g"]) : Promise.resolve(null)),
    fileVault: () => (platform === "darwin" ? text("fdesetup", ["status"]) : Promise.resolve(null)),
    now: () => systemClock.now(),
  };
}

/** The probes of awd: the local probes, with the sync state, the peers and Orca of awd. */
export function daemonProbes(daemon: Daemon): DoctorProbes {
  const uid = process.getuid?.() ?? 0;
  const base = localProbes(daemon.settings, process.platform, uid);
  return {
    ...base,
    device: daemon.device.slug,
    now: () => daemon.clock.now(),
    orca: async () => {
      for (const summary of daemon.workspaces()) {
        if (!summary.ready) continue;
        const ws = daemon.workspace(summary.id);
        const me = ws.device.slug;
        if (ws.bindings().some((b) => b.device === me && b.use_orca)) {
          return (
            (await daemon.sessions?.orcaState(ws.id)) ?? {
              available: false,
              version: null,
              reason: "the sessions of this device are not ready",
            }
          );
        }
      }
      return null;
    },
    sync: async () => {
      if (!daemon.started) return { state: "not_configured", peers: [] };
      const status = await daemon.sync.status();
      return {
        state: status.engine,
        peers: status.peers.map((p) => ({
          device: p.device,
          connected: p.connected,
          lastSeen: p.lastSeen,
        })),
      };
    },
  };
}
