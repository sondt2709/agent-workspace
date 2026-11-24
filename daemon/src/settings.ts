// The settings module of daemon/ (docs/engineering-rules.md 5.8). It is the only reader of the
// environment for awd and aw. Each value has a local default.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
const LOG_LEVELS: readonly LogLevel[] = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
];

export interface Settings {
  /** The state folder of this device, never synced. `AW_HOME`, default `~/.aw`. */
  home: string;
  /** The socket of the local API: `<home>/run/awd.sock`. */
  socketPath: string;
  /** `AW_LOG_LEVEL`, default `info`. */
  logLevel: LogLevel;
  /** The home folder of the user: the default parent of the AW folder (`~/AW`) and the units. */
  userHome: string;
  /** True when `AW_HOME` is set, false for the default `<userHome>/.aw`. */
  homeFromEnv: boolean;
  /**
   * The user that ran `sudo` (`SUDO_USER`, `SUDO_UID`, `SUDO_GID`), or null. `aw service install
   * --headless` runs as root and makes the LaunchDaemon for this user.
   */
  sudoUser: { name: string; uid: number; gid: number } | null;
  /** The sync engine (docs/phase-1.md 6). */
  sync: SyncSettings;
  /** The sessions (design of add-claude-sessions-tmux, decision 17). */
  sessions: SessionSettings;
  /** The MCP server (design of add-mcp-server, decision 2). */
  mcp: McpSettings;
  /**
   * Where awd keeps the device key and the recovery phrase: `AW_KEYSTORE` `os` (the OS keystore)
   * or `file` (`<home>/keys/`, 0600). Default `os` on macOS with the default state folder, else
   * `file`: a headless computer has no session bus, and a state folder from `AW_HOME` (tests, a
   * second awd) must not change the keystore of the user. `<home>/keys/device` (after `aw service
   * move-keys`) also gives `file`, so no awd makes a second device key in the Keychain.
   */
  keystore: "os" | "file";
}

export interface McpSettings {
  /**
   * `AW_MCP_PORT`: the ports that awd tries in order. Unset: 7433 to 7442. A number: only that
   * port. `0`: any free port (the tests). `off`: an empty list, so no MCP server.
   */
  ports: number[];
  /** The file with the port of the MCP listener: `<home>/run/mcp.port`. */
  portFile: string;
  /**
   * The error of a bad `AW_MCP_PORT`, or null. Only awd fails on it (at its start): aw, aw-hook and
   * aw-launch do not use the port, and a bad value inherited into a session must not break them.
   */
  error: string | null;
}

/** The default MCP port and the last port of the fallback range (approved defaults 2026-11-22). */
export const MCP_PORT = 7433;
export const MCP_LAST_PORT = 7442;

function mcpSettings(env: Environment, home: string): McpSettings {
  const value = (env.AW_MCP_PORT ?? "").trim().toLowerCase();
  let ports: number[] = [];
  let error: string | null = null;
  if (value === "") {
    ports = Array.from({ length: MCP_LAST_PORT - MCP_PORT + 1 }, (_, i) => MCP_PORT + i);
  } else if (value === "off") ports = [];
  else if (/^[0-9]{1,5}$/.test(value) && Number(value) <= 65535) ports = [Number(value)];
  else error = `AW_MCP_PORT must be a port number, 0 or off, not ${env.AW_MCP_PORT}`;
  return { ports, portFile: join(home, "run", "mcp.port"), error };
}

export interface SyncSettings {
  /** The engine binary: `AW_SYNC_ENGINE`, else `<home>/engine/syncthing`. */
  engine: string;
  /** True when `AW_SYNC_ENGINE` names the binary. */
  engineFromEnv: boolean;
  /** The listen address of the engine: `AW_SYNC_LISTEN`, default `tcp://0.0.0.0:22300`. */
  listen: string;
  /**
   * "Use community discovery and relay servers": `AW_SYNC_COMMUNITY` `on` (default) or `off`. When
   * the variable is not set, `sync.community` of `config.yaml` wins (gap-setup).
   */
  community: boolean;
  /** True when `AW_SYNC_COMMUNITY` is set: then the switch of the apps is read-only. */
  communityFromEnv: boolean;
  /**
   * `AW_SYNC_TEST_PEERS` `on` or `off` (default): allow `POST /v1/sync/peers` (`aw sync peer add`),
   * which shares each folder, `secure` too, with a device id that has no signed device record.
   * A test path until identity-pairing adds peers.
   */
  testPeers: boolean;
}

/** The default listen port of the AW engine: not 22000, so a Syncthing of the user stays free. */
export const DEFAULT_SYNC_LISTEN = "tcp://0.0.0.0:22300";

function syncSettings(env: Environment, home: string): SyncSettings {
  const engine = env.AW_SYNC_ENGINE ?? "";
  const listen = env.AW_SYNC_LISTEN ?? DEFAULT_SYNC_LISTEN;
  if (!/^tcp[46]?:\/\/\S+:\d+$/.test(listen)) {
    throw new Error(`AW_SYNC_LISTEN must be tcp://<address>:<port>, not ${listen}`);
  }
  const communityFromEnv = (env.AW_SYNC_COMMUNITY ?? "") !== "";
  const community = (communityFromEnv ? env.AW_SYNC_COMMUNITY! : "on").toLowerCase();
  if (community !== "on" && community !== "off") {
    throw new Error(`AW_SYNC_COMMUNITY must be one of on, off, not ${community}`);
  }
  const testPeers = (env.AW_SYNC_TEST_PEERS ?? "off").toLowerCase();
  if (testPeers !== "on" && testPeers !== "off") {
    throw new Error(`AW_SYNC_TEST_PEERS must be one of on, off, not ${testPeers}`);
  }
  return {
    engine: engine.length > 0 ? resolve(engine) : join(home, "engine", "syncthing"),
    engineFromEnv: engine.length > 0,
    listen,
    community: community === "on",
    communityFromEnv,
    testPeers: testPeers === "on",
  };
}

export interface SessionSettings {
  /** `AW_TMUX`: the tmux binary, or null to search PATH (a `/.orca/` shim is skipped). */
  tmux: string | null;
  /** `AW_TMUX_SOCKET`: the tmux socket name, default `aw`. */
  tmuxSocket: string;
  /**
   * `AW_ORCA`: the Orca CLI, or null to look in the macOS app bundle, then for `orca-ide` and
   * `orca` in PATH (add-orca-session-host).
   */
  orca: string | null;
  /** `AW_CLAUDE`: the agent binary, default `claude` in PATH. Tests give the fake agent. */
  claude: string;
  /** `AW_CLAUDE_MODEL`: an optional `--model` value, for example `haiku`. */
  claudeModel: string | null;
  /** `CLAUDE_CONFIG_DIR` of the agent, default `<userHome>/.claude` (the transcripts). */
  claudeConfigDir: string;
  /**
   * `CLAUDE_CONFIG_DIR` when awd has it, else null. Only then does a session get it: the variable
   * also moves the state file of Claude Code (add-continuity, decision 7).
   */
  claudeConfigEnv: string | null;
  /** `AW_MAX_WORKING`: working sessions per agent on this device, default 2 (add-continuity). */
  maxWorking: number;
  /** `AW_DISK_FULL_PERCENT`: no new session at this disk use of AW_HOME, default 95. */
  diskFullPercent: number;
  /** PATH of awd: aw-launch gives it to the session, with the plugin bin folder first. */
  path: string;
  /** `AW_SESSION`, `AW_TASK`, `AW_WORKSPACE`: the session of an agent command, or null. */
  session: { id: string; task: string | null; workspace: string | null } | null;
  /**
   * `AW_MCP_TOKEN`: the session token, or null. awd takes the identity of the agent only from it,
   * so the CLI sends it also when `AW_SESSION` is not set (add-mcp-server).
   */
  token: string | null;
}

function text(value: string | undefined): string | null {
  return value !== undefined && value.length > 0 ? value : null;
}

function maxWorking(value: string | undefined): number {
  if (value === undefined || value === "") return 2;
  if (!/^[1-9][0-9]{0,2}$/.test(value)) {
    throw new Error(`AW_MAX_WORKING must be a whole number from 1 to 999, not ${value}`);
  }
  return Number(value);
}

function diskFull(value: string | undefined): number {
  if (value === undefined || value === "") return 95;
  if (!/^[0-9]{1,3}$/.test(value) || Number(value) < 50 || Number(value) > 100) {
    throw new Error(`AW_DISK_FULL_PERCENT must be a whole number from 50 to 100, not ${value}`);
  }
  return Number(value);
}

function sessionSettings(env: Environment, userHome: string): SessionSettings {
  const socket = env.AW_TMUX_SOCKET ?? "aw";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(socket)) {
    throw new Error(`AW_TMUX_SOCKET must match [A-Za-z0-9_-]{1,64}, not ${socket}`);
  }
  const session = text(env.AW_SESSION);
  return {
    tmux: text(env.AW_TMUX),
    tmuxSocket: socket,
    orca: text(env.AW_ORCA),
    claude: text(env.AW_CLAUDE) ?? "claude",
    claudeModel: text(env.AW_CLAUDE_MODEL),
    claudeConfigDir: text(env.CLAUDE_CONFIG_DIR) ?? join(userHome, ".claude"),
    claudeConfigEnv: text(env.CLAUDE_CONFIG_DIR),
    maxWorking: maxWorking(env.AW_MAX_WORKING),
    diskFullPercent: diskFull(env.AW_DISK_FULL_PERCENT),
    path: env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    session:
      session === null
        ? null
        : { id: session, task: text(env.AW_TASK), workspace: text(env.AW_WORKSPACE) },
    token: text(env.AW_MCP_TOKEN),
  };
}

export type Environment = Record<string, string | undefined>;

/** A whole number from a variable, or null. */
function wholeNumber(value: string | undefined): number | null {
  if (value === undefined || !/^[0-9]+$/.test(value)) return null;
  return Number(value);
}

function sudoUser(env: Environment): Settings["sudoUser"] {
  const name = env.SUDO_USER;
  const uid = wholeNumber(env.SUDO_UID);
  if (!name || uid === null) return null;
  return { name, uid, gid: wholeNumber(env.SUDO_GID) ?? uid };
}

function keystoreKind(
  env: Environment,
  platform: NodeJS.Platform,
  homeFromEnv: boolean,
  fileKey: () => boolean,
): "os" | "file" {
  const fallback = platform === "darwin" && !homeFromEnv && !fileKey() ? "os" : "file";
  const value = (env.AW_KEYSTORE ?? fallback).toLowerCase();
  if (value !== "os" && value !== "file") {
    throw new Error(`AW_KEYSTORE must be one of os, file, not ${value}`);
  }
  return value;
}

/** Reads the settings from an environment. The default is `process.env`. */
export function loadSettings(
  env: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
): Settings {
  const userHome = env.HOME && env.HOME.length > 0 ? env.HOME : homedir();
  const awHome = env.AW_HOME ?? "";
  const homeFromEnv = awHome.length > 0;
  const home = resolve(homeFromEnv ? awHome : join(userHome, ".aw"));
  const level = (env.AW_LOG_LEVEL ?? "info").toLowerCase();
  if (!LOG_LEVELS.includes(level as LogLevel)) {
    throw new Error(`AW_LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}, not ${level}`);
  }
  return {
    home,
    socketPath: join(home, "run", "awd.sock"),
    logLevel: level as LogLevel,
    userHome,
    homeFromEnv,
    sudoUser: sudoUser(env),
    sync: syncSettings(env, home),
    sessions: sessionSettings(env, userHome),
    mcp: mcpSettings(env, home),
    keystore: keystoreKind(env, platform, homeFromEnv, () => exists(join(home, "keys", "device"))),
  };
}

/**
 * A copy of the environment of this process: aw-launch gives it to the agent, with the session
 * variables on top. The settings module is the only reader of `process.env` (AGENTS.md).
 */
export function processEnvironment(): Environment {
  return { ...process.env };
}
