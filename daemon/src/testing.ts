// Test helpers: a daemon on a temp socket with a fixed device, and a writer for the log lines of
// another device. Not exported from the package index.
import { AwClient } from "@aw/client";
import { openWorkspace, systemClock, type Clock, type WorkspaceFiles } from "@aw/core";
import type { DeviceRole } from "@aw/schema";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { stringify } from "yaml";
import type { PeerTools } from "./api/peer.ts";
import { run, type CliIo } from "./cli/run.ts";
import { createLogger, type Logger } from "./log.ts";
import { startServer, type RunningServer } from "./server.ts";
import type { DaemonOptions } from "./service/daemon.ts";
import { loadSettings, type Settings } from "./settings.ts";
import { ensurePrivateFolder, type AwdConfig } from "./state.ts";

/** A temp folder with a short path: a socket path has at most 103 bytes. */
export function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** A logger that keeps each JSON line in memory. */
export function memoryLogger(level: "info" | "debug" | "warn" = "warn"): {
  log: Logger;
  lines: () => Record<string, unknown>[];
} {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk.toString("utf8"));
      done();
    },
  });
  return {
    log: createLogger(level, stream),
    lines: () =>
      chunks
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

/** Writes `config.yaml` with a fixed device before the first start. */
export async function writeTestConfig(
  settings: Settings,
  device = "macbook-pro",
  workspaces: AwdConfig["workspaces"] = [],
): Promise<void> {
  await ensurePrivateFolder(settings.home);
  const config: AwdConfig = {
    kind: "awd-config",
    schema: 1,
    device: { slug: device, name: "MacBook Pro", role: "local" },
    workspaces,
  };
  await writeFile(join(settings.home, "config.yaml"), stringify(config));
}

export interface TestDaemon {
  home: string;
  /** HOME of the test daemon: its own folder, so `~/AW` is not in AW_HOME. */
  userHome: string;
  folder: string;
  settings: Settings;
  server: RunningServer;
  client: AwClient;
  logLines: () => Record<string, unknown>[];
  /** Runs the aw CLI in process; returns the exit code and the output. */
  aw(
    argv: string[],
    options?: Partial<CliIo>,
  ): Promise<{ code: number; stdout: string; stderr: string }>;
  restart(): Promise<void>;
  close(): Promise<void>;
}

export interface TestDaemonOptions {
  clock?: Clock;
  watch?: boolean;
  heartbeat?: boolean;
  /** Create the workspace `acme` with the project `billing-api`. */
  workspace?: boolean;
  /** Run the agent sessions. Default false. */
  sessions?: boolean;
  /** The environment of the settings (merged on AW_HOME and HOME). */
  env?: Record<string, string>;
  permissionTimeoutMs?: number;
  startRetryMs?: number;
  prepareRetryMs?: number;
  /** The tools of the peer process check (default: the real lsof, ss and ps). */
  peerTools?: PeerTools;
  /** The device slug of `config.yaml` (default macbook-pro). */
  device?: string;
  hostNoticeMs?: number;
  /** The Inbox: a fake source and a short step (openspec inbox-mattermost). */
  openSource?: DaemonOptions["openSource"];
  inboxTickMs?: number;
}

export async function startTestDaemon(options: TestDaemonOptions = {}): Promise<TestDaemon> {
  const home = await tempDir("awh-");
  const userHome = await tempDir("awu-");
  const folder = await tempDir("awf-");
  const settings = loadSettings({
    PATH: process.env.PATH,
    // Any free MCP port: test daemons run in parallel (add-mcp-server).
    AW_MCP_PORT: "0",
    // A full disk of the test computer must not stop the sessions of the tests (add-continuity).
    AW_DISK_FULL_PERCENT: "100",
    ...options.env,
    AW_HOME: home,
    HOME: userHome,
  });
  await writeTestConfig(settings, options.device);
  const memory = memoryLogger("info");
  const start = () =>
    startServer({
      settings,
      log: memory.log,
      clock: options.clock ?? systemClock,
      watch: options.watch ?? false,
      heartbeat: options.heartbeat ?? false,
      bootTime: "2026-11-22T08:00:00.000Z",
      sessions: options.sessions ?? false,
      ...(options.permissionTimeoutMs === undefined
        ? {}
        : { permissionTimeoutMs: options.permissionTimeoutMs }),
      ...(options.startRetryMs === undefined ? {} : { startRetryMs: options.startRetryMs }),
      ...(options.prepareRetryMs === undefined ? {} : { prepareRetryMs: options.prepareRetryMs }),
      ...(options.peerTools ? { peerTools: options.peerTools } : {}),
      ...(options.hostNoticeMs === undefined ? {} : { hostNoticeMs: options.hostNoticeMs }),
      ...(options.openSource ? { openSource: options.openSource } : {}),
      ...(options.inboxTickMs === undefined ? {} : { inboxTickMs: options.inboxTickMs }),
    });
  let server = await start();
  const client = new AwClient({ socketPath: settings.socketPath });
  if (options.workspace) {
    await client.initWorkspace({ path: folder, name: "acme" });
    // The tests of gates and hooks need the gated mode: the product default is skip
    // (openspec polish-skip-default), so the test project sets default.
    await client.addProject("-", {
      slug: "billing-api",
      name: "Billing API",
      permission_mode: "default",
    });
  }
  const daemon: TestDaemon = {
    home,
    userHome,
    folder,
    settings,
    get server() {
      return server;
    },
    client,
    logLines: memory.lines,
    async aw(argv, io = {}) {
      let stdout = "";
      let stderr = "";
      const code = await run(argv, {
        stdout: (text) => (stdout += text),
        stderr: (text) => (stderr += text),
        env: { ...options.env, AW_HOME: home, HOME: userHome },
        cwd: folder,
        ...io,
      });
      return { code, stdout, stderr };
    },
    async restart() {
      await server.close();
      server = await start();
    },
    async close() {
      await server.close();
      await rm(home, { recursive: true, force: true });
      await rm(userHome, { recursive: true, force: true });
      await rm(folder, { recursive: true, force: true });
    },
  };
  return daemon;
}

/** The files API of another device in the same folder, as its own awd would write. */
export function otherDevice(
  root: string,
  device: string,
  options: { role?: DeviceRole; clock?: Clock } = {},
): WorkspaceFiles {
  return openWorkspace({
    root,
    device,
    role: options.role ?? "remote",
    clock: options.clock ?? systemClock,
    taskOwner: () => device,
  });
}

/** Waits until `check` returns true, at most `timeoutMs` (real time: for the file watcher). */
export async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`The condition was not true after ${timeoutMs} ms`);
}
