// The service units of awd (docs/architecture.md 4.6.1, design decision 20): a systemd user unit
// on Linux, a LaunchAgent on a macOS laptop and a LaunchDaemon on a headless Mac. Each one starts
// awd with exec-form arguments and starts it again after an exit.
import { systemClock } from "@aw/core";
import { accessSync, constants } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

export const UNIT_LABEL = "com.agentworkspace.awd";
export const SYSTEMD_UNIT_NAME = "awd.service";
/** The user unit of the tmux server of the sessions (docs/architecture.md 3.3). */
export const SESSIONS_UNIT_NAME = "aw-sessions.service";

export type UnitKind = "systemd" | "launch-agent" | "launch-daemon";

export interface UnitContext {
  /** The absolute path of the Node binary. */
  nodePath: string;
  /** The absolute path of the awd entry point. */
  awdEntry: string;
  /** The state folder (AW_HOME). The unit sets it only when it is not the default. */
  awHome: string;
  /** True when awHome is not `<userHome>/.aw`. */
  customHome: boolean;
  userHome: string;
  /** The user name of a LaunchDaemon (`UserName`). */
  userName: string;
  /** The numeric user id, for `launchctl` domains. */
  uid: number;
  /** The tmux server of the sessions (Linux: its own unit), or null when no tmux was found. */
  sessions?: { tmux: string; socket: string; config: string } | null;
  /** The PATH of awd in the unit (servicePath). No PATH line when it is not set. */
  path?: string;
  /**
   * Other variables of the unit: the ones that the person added to the old unit by hand (for
   * example AW_DISK_FULL_PERCENT). AW keeps them at a new install (fc1-lead-2; owner question Q12
   * asks for a supported way).
   */
  env?: Record<string, string>;
}

/** The variables that AW itself writes in a unit: unitEnvOf leaves them out. */
const AW_UNIT_KEYS = new Set(["PATH", "AW_HOME", "HOME", "AW_KEYSTORE"]);

function unxml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/**
 * The variables of an old unit text that AW does not write itself: the EnvironmentVariables of a
 * plist, or the Environment= lines of a systemd unit.
 */
export function unitEnvOf(kind: UnitKind, text: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (kind === "systemd") {
    for (const line of text.split("\n")) {
      const match = /^Environment=(?:"((?:[^"\\]|\\.)*)"|(\S+))$/.exec(line.trim());
      const pair = match ? (match[1]?.replace(/\\(.)/g, "$1") ?? match[2]!) : null;
      const at = pair?.indexOf("=") ?? -1;
      if (pair && at > 0) env[pair.slice(0, at)] = pair.slice(at + 1);
    }
  } else {
    const dict =
      /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(text)?.[1] ?? "";
    for (const m of dict.matchAll(/<key>([^<]*)<\/key>\s*<string>([^<]*)<\/string>/g)) {
      env[unxml(m[1]!)] = unxml(m[2]!);
    }
  }
  for (const key of Object.keys(env)) if (AW_UNIT_KEYS.has(key)) delete env[key];
  return env;
}

/** True when `dir` has an executable file `name`. */
function executableIn(dir: string, name: string): boolean {
  try {
    accessSync(join(dir, name), constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The tools that awd starts by name: their folders go into the unit PATH. */
const SERVICE_TOOLS = ["tmux", "claude", "git"];

/**
 * The PATH of a service unit (fix list 0-24, fc1-lead-2). launchd starts awd with `/usr/bin:/bin:
 * /usr/sbin:/sbin`, and a systemd user manager often misses `~/.local/bin`: awd then does not find
 * Homebrew tmux or `~/.local/bin/claude`. The unit gets the folder of node, the first folder of the
 * install PATH that has each tool (never a `/.orca/` shim folder with its own tmux, AGENTS.md
 * "Tests"), then the usual folders of tmux and Claude Code, then the system folders. It never
 * copies the whole PATH of the shell (about 40 folders, with shims before Homebrew).
 */
export function servicePath(
  input: { installPath: string; userHome: string; nodePath: string },
  has: (dir: string, name: string) => boolean = executableIn,
): string {
  const dirs = input.installPath
    .split(":")
    .filter((d) => isAbsolute(d) && !d.includes("\n") && !d.includes("/.orca/"));
  const found = SERVICE_TOOLS.map((tool) => dirs.find((d) => has(d, tool))).filter(
    (d): d is string => d !== undefined,
  );
  const folders = [
    dirname(input.nodePath),
    ...found,
    join(input.userHome, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].filter((f) => f.startsWith("/") && !f.includes("\n"));
  return [...new Set(folders)].join(":");
}

/** Runs a command with exec-form arguments. Tests give a fake runner. */
export type CommandRunner = (
  file: string,
  args: string[],
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

function xml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** systemd quotes each argument with spaces or quotes in double quotes. */
function systemdArg(value: string): string {
  return /[\s"'\\]/.test(value) ? `"${value.replace(/(["\\])/g, "\\$1")}"` : value;
}

export function unitKind(platform: NodeJS.Platform, headless: boolean): UnitKind {
  if (platform === "linux") return "systemd";
  if (platform === "darwin") return headless ? "launch-daemon" : "launch-agent";
  throw new Error(`No service unit for the platform ${platform}. AW runs on macOS and Linux.`);
}

export function unitPath(kind: UnitKind, context: UnitContext): string {
  switch (kind) {
    case "systemd":
      return join(context.userHome, ".config", "systemd", "user", SYSTEMD_UNIT_NAME);
    case "launch-agent":
      return join(context.userHome, "Library", "LaunchAgents", `${UNIT_LABEL}.plist`);
    case "launch-daemon":
      return join("/Library", "LaunchDaemons", `${UNIT_LABEL}.plist`);
  }
}

/** The systemd user unit. `loginctl enable-linger` makes it start at boot with no login. */
export function systemdUnit(context: UnitContext): string {
  const lines = [
    "# Generated by aw service install. Do not edit: run it again.",
    "[Unit]",
    "Description=Agent Workspace daemon (awd)",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${[context.nodePath, context.awdEntry].map(systemdArg).join(" ")}`,
    "Restart=always",
    "RestartSec=2",
    // control-group: a stop or a restart of awd kills each process in this unit's cgroup. So awd
    // starts the tmux server of the sessions in its own unit, aw-sessions.service (sessionsUnit,
    // docs/architecture.md 4.6.1 item 1); a tmux server in this cgroup would die with awd.
    "KillMode=control-group",
  ];
  for (const [key, value] of Object.entries(context.env ?? {})) {
    lines.push(`Environment=${systemdArg(`${key}=${value}`)}`);
  }
  if (context.customHome) lines.push(`Environment=${systemdArg(`AW_HOME=${context.awHome}`)}`);
  if (context.path) lines.push(`Environment=${systemdArg(`PATH=${context.path}`)}`);
  lines.push("", "[Install]", "WantedBy=default.target", "");
  return lines.join("\n");
}

function plist(entries: [string, string][]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    "<!-- Generated by aw service install. Do not edit: run it again. -->",
    '<plist version="1.0">',
    "<dict>",
    ...entries.map(([key, value]) => `  <key>${xml(key)}</key>\n  ${value}`),
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

const str = (value: string) => `<string>${xml(value)}</string>`;
const TRUE = "<true/>";

function launchdEntries(
  context: UnitContext,
  env: Record<string, string> = {},
): [string, string][] {
  const log = join(context.awHome, "logs", "awd.log");
  const entries: [string, string][] = [
    ["Label", str(UNIT_LABEL)],
    [
      "ProgramArguments",
      `<array>\n    ${str(context.nodePath)}\n    ${str(context.awdEntry)}\n  </array>`,
    ],
    ["RunAtLoad", TRUE],
    ["KeepAlive", TRUE],
    ["ThrottleInterval", "<integer>2</integer>"],
    ["StandardErrorPath", str(log)],
    ["StandardOutPath", str(log)],
  ];
  const variables = {
    ...context.env,
    ...env,
    ...(context.customHome ? { AW_HOME: context.awHome } : {}),
    ...(context.path ? { PATH: context.path } : {}),
  };
  if (Object.keys(variables).length > 0) {
    const items = Object.entries(variables)
      .map(([key, value]) => `    <key>${xml(key)}</key>\n    ${str(value)}`)
      .join("\n");
    entries.push(["EnvironmentVariables", `<dict>\n${items}\n  </dict>`]);
  }
  return entries;
}

/**
 * The LaunchAgent of a laptop: it runs while the user is logged in. AbandonProcessGroup: launchd
 * does not stop the processes that awd started (the tmux server) when awd exits.
 */
export function launchAgentPlist(context: UnitContext): string {
  return plist([...launchdEntries(context), ["AbandonProcessGroup", TRUE]]);
}

/**
 * The user unit of the tmux server of the sessions. awd starts it when it needs tmux, so the server
 * is in its own control group and a restart of awd stops no session. It never restarts by itself.
 */
export function sessionsUnit(sessions: { tmux: string; socket: string; config: string }): string {
  return [
    "# Generated by aw service install. Do not edit: run it again.",
    "[Unit]",
    "Description=Agent Workspace sessions (the tmux server of the AW sessions)",
    "",
    "[Service]",
    "Type=forking",
    `ExecStart=${[sessions.tmux, "-L", sessions.socket, "-f", sessions.config, "new-session", "-d", "-s", "aw", "-n", "aw-host", "--", "tail", "-f", "/dev/null"].map(systemdArg).join(" ")}`,
    "Restart=no",
    // A stop of this unit stops the tmux server; awd never stops or restarts it.
    "KillMode=process",
    "",
  ].join("\n");
}

/** The LaunchDaemon of a headless Mac: it starts at boot with no login. */
export function launchDaemonPlist(context: UnitContext): string {
  // launchd does not set HOME for a LaunchDaemon: awd needs it for ~/.aw. A LaunchDaemon has no
  // login Keychain, so awd keeps its keys in ~/.aw/keys/ (openspec gap-install).
  return plist([
    ...launchdEntries(context, { HOME: context.userHome, AW_KEYSTORE: "file" }),
    ["UserName", str(context.userName)],
    ["AbandonProcessGroup", TRUE],
  ]);
}

export function renderUnit(kind: UnitKind, context: UnitContext): string {
  if (kind === "systemd") return systemdUnit(context);
  return kind === "launch-agent" ? launchAgentPlist(context) : launchDaemonPlist(context);
}

/** The commands that load, unload and inspect a unit, in order. */
export function unitCommands(kind: UnitKind, context: UnitContext, path: string) {
  switch (kind) {
    case "systemd":
      return {
        load: [
          ["systemctl", ["--user", "daemon-reload"]],
          ["systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT_NAME]],
        ],
        unload: [
          ["systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT_NAME]],
          ["systemctl", ["--user", "daemon-reload"]],
        ],
        status: ["systemctl", ["--user", "is-active", SYSTEMD_UNIT_NAME]],
        restart: ["systemctl", ["--user", "restart", SYSTEMD_UNIT_NAME]],
      } as const;
    case "launch-agent":
      return {
        load: [["launchctl", ["bootstrap", `gui/${context.uid}`, path]]],
        unload: [["launchctl", ["bootout", `gui/${context.uid}/${UNIT_LABEL}`]]],
        status: ["launchctl", ["print", `gui/${context.uid}/${UNIT_LABEL}`]],
        restart: ["launchctl", ["kickstart", "-k", `gui/${context.uid}/${UNIT_LABEL}`]],
      } as const;
    case "launch-daemon":
      return {
        load: [["launchctl", ["bootstrap", "system", path]]],
        unload: [["launchctl", ["bootout", `system/${UNIT_LABEL}`]]],
        status: ["launchctl", ["print", `system/${UNIT_LABEL}`]],
        restart: ["launchctl", ["kickstart", "-k", `system/${UNIT_LABEL}`]],
      } as const;
  }
}

export interface UnitResult {
  kind: UnitKind;
  path: string;
  installed: boolean;
  loaded: boolean;
  /** The commands that ran, as text, for the output. */
  commands: string[];
  notes: string[];
}

async function runAll(
  runner: CommandRunner,
  commands: readonly (readonly [string, readonly string[]])[],
  done: string[],
  ignoreErrors = false,
): Promise<void> {
  for (const [file, args] of commands) {
    done.push([file, ...args].join(" "));
    const result = await runner(file, [...args]);
    if (result.exitCode !== 0 && !ignoreErrors) {
      throw new Error(
        `${file} ${args.join(" ")} failed with exit code ${result.exitCode}: ${result.stderr.trim()}`,
      );
    }
  }
}

/** Writes the unit file and loads it. */
/** The polls of `launchctl print` after a bootout, and the tries of the bootstrap. */
const LAUNCHD_GONE_POLLS = 40;
const LAUNCHD_POLL_MS = 250;
const BOOTSTRAP_TRIES = 4;

/**
 * launchd: waits until the label is gone after a bootout. A bootstrap right after a bootout fails
 * with "Bootstrap failed: 5: Input/output error" while launchd still stops the old job
 * (fc1-lead-1).
 */
async function waitUntilUnloaded(
  status: readonly [string, readonly string[]],
  runner: CommandRunner,
  sleep: (ms: number) => Promise<void>,
  done: string[],
): Promise<void> {
  for (let i = 0; i < LAUNCHD_GONE_POLLS; i++) {
    done.push([status[0], ...status[1]].join(" "));
    if ((await runner(status[0], [...status[1]])).exitCode !== 0) return;
    await sleep(LAUNCHD_POLL_MS);
  }
}

/** launchd: the bootstrap, again after 1, 2 and 4 s when launchd answers exit code 5. */
async function bootstrapWithRetry(
  load: readonly (readonly [string, readonly string[]])[],
  runner: CommandRunner,
  sleep: (ms: number) => Promise<void>,
  done: string[],
  ignoreErrors: boolean,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await runAll(runner, load, done, ignoreErrors);
      return;
    } catch (error) {
      if (attempt >= BOOTSTRAP_TRIES || !/exit code 5\b/.test((error as Error).message))
        throw error;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

export interface InstallOptions {
  /** The wait between the launchd polls and tries. Tests give a fake. */
  sleep?: (ms: number) => Promise<void>;
}

export async function installUnit(
  kind: UnitKind,
  context: UnitContext,
  runner: CommandRunner,
  options: InstallOptions = {},
): Promise<UnitResult> {
  const sleep = options.sleep ?? ((ms: number) => systemClock.sleep(ms));
  const path = unitPath(kind, context);
  const commands = unitCommands(kind, context, path);
  const done: string[] = [];
  const notes: string[] = [];
  await mkdir(dirname(path), { recursive: true });
  const text = renderUnit(kind, context);
  const old = await readFile(path, "utf8").catch(() => null);
  if (old !== null && old !== text) {
    // Unload the old unit first, so the new text takes effect.
    await runAll(runner, commands.unload, done, true);
    if (kind !== "systemd") await waitUntilUnloaded(commands.status, runner, sleep, done);
  }
  await writeFile(path, text, { mode: 0o644 });
  if (kind === "systemd" && context.sessions) {
    await writeFile(join(dirname(path), SESSIONS_UNIT_NAME), sessionsUnit(context.sessions), {
      mode: 0o644,
    });
    notes.push(`Wrote ${SESSIONS_UNIT_NAME}: awd starts it when a session starts.`);
  }
  if (kind === "systemd") await runAll(runner, commands.load, done);
  else await bootstrapWithRetry(commands.load, runner, sleep, done, old === text);
  if (kind === "systemd") {
    // Only when linger is not on already (verify-journeys finding 18).
    const linger = await runner("loginctl", [
      "show-user",
      context.userName,
      "-p",
      "Linger",
      "--value",
    ]).catch(() => null);
    if (linger?.stdout.trim() !== "yes") {
      notes.push(
        `Run "loginctl enable-linger ${context.userName}" once, so awd starts at boot with no login.`,
      );
    }
  }
  return { kind, path, installed: true, loaded: true, commands: done, notes };
}

/** Unloads the unit and removes its file. */
export async function uninstallUnit(
  kind: UnitKind,
  context: UnitContext,
  runner: CommandRunner,
): Promise<UnitResult> {
  const path = unitPath(kind, context);
  const done: string[] = [];
  await runAll(runner, unitCommands(kind, context, path).unload, done, true);
  if (kind === "systemd") {
    // Stop the tmux server of the sessions before its unit file goes, then reload: else the
    // server and the agents keep running with a deleted unit.
    await runAll(runner, [["systemctl", ["--user", "stop", SESSIONS_UNIT_NAME]]], done, true);
  } else if (context.sessions) {
    // macOS: launchd does not stop the tmux server (AbandonProcessGroup). Stop it as on Linux, so
    // no agent runs on with no awd (verify-journeys finding 19).
    const { tmux, socket } = context.sessions;
    await runAll(runner, [[tmux, ["-L", socket, "kill-server"]]], done, true);
  }
  await rm(path, { force: true });
  if (kind === "systemd") {
    await rm(join(dirname(path), SESSIONS_UNIT_NAME), { force: true });
    await runAll(runner, [["systemctl", ["--user", "daemon-reload"]]], done, true);
  }
  return { kind, path, installed: false, loaded: false, commands: done, notes: [] };
}

/** Restarts the loaded unit, so awd starts again (for example to start a new sync engine). */
export async function restartUnit(
  kind: UnitKind,
  context: UnitContext,
  runner: CommandRunner,
): Promise<string> {
  const [file, args] = unitCommands(kind, context, unitPath(kind, context)).restart;
  const done: string[] = [];
  await runAll(runner, [[file, args]], done);
  return done[0]!;
}

/** Reports whether the unit file exists and the service manager has it loaded. */
export async function unitStatus(
  kind: UnitKind,
  context: UnitContext,
  runner: CommandRunner,
): Promise<UnitResult> {
  const path = unitPath(kind, context);
  const installed = await readFile(path, "utf8").then(
    () => true,
    () => false,
  );
  const [file, args] = unitCommands(kind, context, path).status;
  const result = await runner(file, [...args]);
  return {
    kind,
    path,
    installed,
    loaded: result.exitCode === 0,
    commands: [[file, ...args].join(" ")],
    notes: [],
  };
}
