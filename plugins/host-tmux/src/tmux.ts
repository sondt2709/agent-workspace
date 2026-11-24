// The tmux session host (docs/phase-1.md 9.1, 9.4, 9.7; docs/architecture.md 4.6.2). A private
// socket, a config with remain-on-exit, exec-form windows, input by load-buffer and paste-buffer,
// and a stop of the whole process group.
import type {
  HostInfo,
  OpenOptions,
  PaneRef,
  PaneState,
  SessionHost,
  StopOptions,
} from "@aw/plugin-api";
import { execa } from "execa";
import { constants } from "node:fs";
import { access, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import {
  groupProcessesSince,
  processExists,
  processTable,
  sessionProcesses,
  signal,
} from "./process-table.ts";

/** The tmux session that holds the AW windows. */
export const TMUX_SESSION = "aw";
/** The idle first window of the session: tmux needs one window per session. */
export const HOST_WINDOW = "aw-host";
export const DEFAULT_SOCKET = "aw";

/** The config of the AW tmux server. */
export const TMUX_CONFIG = [
  "# Written by awd. The tmux server of the AW sessions (docs/phase-1.md 9.1).",
  "set -g exit-empty off",
  "set -g remain-on-exit on",
  "set -g default-size 200x50",
  "set -g history-limit 5000",
  "",
].join("\n");

/** The command of the idle first window. */
export const HOST_COMMAND = ["tail", "-f", "/dev/null"];

/**
 * The first `tmux` in PATH that is not in a `/.orca/` folder. In some agent sessions `tmux` in
 * PATH is a shim of another tool (AGENTS.md "Tests").
 */
export async function findTmux(path: string | undefined): Promise<string | null> {
  for (const dir of (path ?? "").split(delimiter)) {
    if (!dir || dir.includes("/.orca/")) continue;
    const candidate = join(dir, "tmux");
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not in this folder.
    }
  }
  return null;
}

/** The arguments that start the AW tmux server (also the ExecStart of aw-sessions.service). */
export function serverStartArgs(socket: string, configFile: string): string[] {
  return [
    "-L",
    socket,
    "-f",
    configFile,
    "new-session",
    "-d",
    "-s",
    TMUX_SESSION,
    "-n",
    HOST_WINDOW,
    "--",
    ...HOST_COMMAND,
  ];
}

export interface TmuxHostOptions {
  /** The tmux binary, or null when none was found. */
  binary: string | null;
  /** The socket name (`tmux -L`). */
  socket: string;
  /** The config file that awd writes. */
  configFile: string;
  /**
   * Starts the server in its own unit (Linux: `systemctl --user start aw-sessions.service`).
   * Returns false when no unit exists; then the host starts tmux directly.
   */
  startInUnit?: () => Promise<boolean>;
  /** Waits; tests can give a fake. Default setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** A warning for the log of awd (for example, a pane line that AW skips). */
  warn?: (message: string) => void;
}

/**
 * The separator of the `-F` formats. tmux before 3.4 prints a tab of a format as `_` (tmux 3.2a of
 * Ubuntu 22.04, 3.3a of Debian 12), so AW uses the printable `|`. A person or an agent can give a
 * window a name with `|`, so `window_name` is the last field, and the rest of the line is its
 * name (fix list 0-40).
 */
const SEP = "|";
const PANE_FIELDS = [
  "window_id",
  "pane_id",
  "pane_pid",
  "pane_dead",
  "pane_dead_status",
  "window_name",
] as const;
const OPEN_FIELDS = ["window_id", "pane_id", "pane_pid"] as const;
const FIELDS = PANE_FIELDS.map((f) => `#{${f}}`).join(SEP);
const OPEN_FORMAT = OPEN_FIELDS.map((f) => `#{${f}}`).join(SEP);

/**
 * Splits one line of a `-F` format into its fields. A line with another field count is refused: a
 * partial parse would give wrong panes. The error names the tmux version.
 */
export function parseFields(line: string, count: number, version: string | null): string[] {
  const fields = line.split(SEP);
  if (fields.length !== count) {
    throw new TmuxError(
      `tmux ${version ?? "(unknown version)"} gave ${fields.length} fields, not ${count}: ${line}`,
      "",
    );
  }
  return fields;
}
const KEY_NAME = /^[A-Za-z0-9-]{1,16}$/;

export class TmuxError extends Error {
  readonly stderr: string;

  constructor(message: string, stderr: string) {
    super(message);
    this.name = "TmuxError";
    this.stderr = stderr;
  }
}

export class TmuxHost implements SessionHost {
  readonly name = "tmux";
  readonly #options: TmuxHostOptions;
  readonly #sleep: (ms: number) => Promise<void>;
  #buffer = 0;

  constructor(options: TmuxHostOptions) {
    this.#options = options;
    this.#sleep =
      options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  get socket(): string {
    return this.#options.socket;
  }

  async #tmux(args: string[], input?: string) {
    const binary = this.#options.binary;
    if (!binary) throw new TmuxError("No tmux binary was found", "");
    const result = await execa(binary, ["-L", this.#options.socket, ...args], {
      reject: false,
      timeout: 15_000,
      ...(input === undefined ? {} : { input }),
    });
    return {
      code: result.exitCode ?? 1,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  }

  /** The fields of one format line; the tmux version is read only for the error of a bad line. */
  async #fields(line: string, count: number): Promise<string[]> {
    const fields = line.split(SEP);
    return fields.length === count ? fields : parseFields(line, count, await this.#version());
  }

  /** The version of the tmux binary (`tmux -V`), for an error text; null when it does not run. */
  async #version(): Promise<string | null> {
    const result = await this.#tmux(["-V"]).catch(() => null);
    return result?.code === 0 ? result.stdout.trim().replace(/^tmux\s+/, "") : null;
  }

  async #run(args: string[], input?: string): Promise<string> {
    const result = await this.#tmux(args, input);
    if (result.code !== 0) {
      throw new TmuxError(`tmux ${args[0]} failed: ${result.stderr.trim()}`, result.stderr);
    }
    return result.stdout;
  }

  async detect(): Promise<HostInfo> {
    const binary = this.#options.binary;
    if (!binary) {
      return {
        name: this.name,
        available: false,
        binary: null,
        version: null,
        survivesDaemonRestart: true,
        reason: "No tmux binary in PATH (set AW_TMUX)",
      };
    }
    const result = await execa(binary, ["-V"], { reject: false });
    const version = /tmux\s+(\S+)/.exec(String(result.stdout ?? ""))?.[1] ?? null;
    return {
      name: this.name,
      available: result.exitCode === 0,
      binary,
      version,
      survivesDaemonRestart: true,
      reason: result.exitCode === 0 ? null : String(result.stderr ?? "").trim(),
    };
  }

  /** Starts the server and the session `aw` when they do not run. */
  async ensureServer(): Promise<void> {
    if ((await this.#tmux(["has-session", "-t", `=${TMUX_SESSION}`])).code === 0) return;
    await writeFile(this.#options.configFile, TMUX_CONFIG, { mode: 0o600 });
    const inUnit =
      this.#options.startInUnit !== undefined &&
      (await this.#options.startInUnit()) &&
      (await this.#tmux(["has-session", "-t", `=${TMUX_SESSION}`])).code === 0;
    if (!inUnit) {
      const result = await this.#tmux(
        serverStartArgs(this.#options.socket, this.#options.configFile).slice(2),
      );
      // Another awd call can start it at the same time: "duplicate session" is a success.
      if (result.code !== 0 && !/duplicate session/.test(result.stderr)) {
        throw new TmuxError(
          `The tmux server did not start: ${result.stderr.trim()}`,
          result.stderr,
        );
      }
    }
    // A server that was running with no session did not read the config: set it now.
    for (const line of TMUX_CONFIG.split("\n")) {
      const parts = line.split(" ");
      if (parts[0] === "set") await this.#run(parts);
    }
  }

  async open(options: OpenOptions): Promise<PaneRef> {
    if (options.command.length < 2) {
      throw new TmuxError("A window command needs 2 or more arguments, so no shell runs", "");
    }
    await this.ensureServer();
    // The OS wall time on purpose, not the clock module of awd: stop() compares it with the start
    // times of processes from `ps`. awd keeps its own clock time of the open (record.opened_at).
    const opened = Date.now();
    const env = Object.entries(options.env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
    const out = await this.#run([
      "new-window",
      "-d",
      "-t",
      `=${TMUX_SESSION}:`,
      "-n",
      options.name,
      "-c",
      options.cwd,
      ...env,
      "-P",
      "-F",
      OPEN_FORMAT,
      "--",
      ...options.command,
    ]);
    const [window, pane, pidText] = await this.#fields(out.trim(), OPEN_FIELDS.length);
    const pid = Number(pidText);
    if (!window || !pane || !Number.isInteger(pid)) {
      throw new TmuxError(`tmux new-window gave no ids: ${out}`, "");
    }
    return { host: this.name, window, pane, pid, pgid: await this.#pgid(pid), opened };
  }

  async #pgid(pid: number): Promise<number> {
    const result = await execa("ps", ["-o", "pgid=", "-p", String(pid)], { reject: false });
    const pgid = Number(String(result.stdout ?? "").trim());
    // tmux makes each pane process the leader of a new session and process group.
    return Number.isInteger(pgid) && pgid > 1 ? pgid : pid;
  }

  /**
   * The panes of the AW session. A line with too few fields is skipped and logged: one bad window
   * must never stop the checks of each other session (fix list 0-40).
   */
  async list(): Promise<PaneState[]> {
    if (!this.#options.binary) return [];
    const result = await this.#tmux(["list-panes", "-s", "-t", `=${TMUX_SESSION}`, "-F", FIELDS]);
    if (result.code !== 0) return [];
    const panes: PaneState[] = [];
    for (const line of result.stdout.split("\n")) {
      if (line === "") continue;
      const parts = line.split(SEP);
      if (parts.length < PANE_FIELDS.length) {
        this.#options.warn?.(
          `tmux ${(await this.#version()) ?? "(unknown version)"} gave a pane line with ${parts.length} fields, not ${PANE_FIELDS.length}: AW skips it`,
        );
        continue;
      }
      const [window, pane, pid, dead, status] = parts;
      const name = parts.slice(PANE_FIELDS.length - 1).join(SEP);
      if (!name || !window || !pane || name === HOST_WINDOW) continue;
      panes.push({
        name,
        window,
        pane,
        pid: Number(pid),
        dead: dead === "1",
        status: dead === "1" && status !== "" && status !== undefined ? Number(status) : null,
      });
    }
    return panes;
  }

  async alive(ref: PaneRef): Promise<boolean> {
    const pane = (await this.list()).find((p) => p.pane === ref.pane && p.pid === ref.pid);
    return pane !== undefined && !pane.dead;
  }

  async capture(ref: PaneRef, lines: number): Promise<string> {
    return this.#run(["capture-pane", "-p", "-J", "-t", ref.pane, "-S", `-${lines}`]);
  }

  async paste(ref: PaneRef, text: string): Promise<void> {
    const name = `aw-${process.pid}-${++this.#buffer}`;
    await this.#run(["load-buffer", "-b", name, "-"], text);
    await this.#run(["paste-buffer", "-p", "-d", "-b", name, "-t", ref.pane]);
  }

  async keys(ref: PaneRef, keys: string[]): Promise<void> {
    for (const key of keys) {
      if (!KEY_NAME.test(key)) throw new TmuxError(`${key} is not a key name`, "");
    }
    await this.#run(["send-keys", "-t", ref.pane, ...keys]);
  }

  /**
   * SIGTERM to the process group, SIGKILL after the grace time, then SIGKILL to each remaining
   * descendant. The tree is read before the first signal: a killed parent gives its children to
   * pid 1, and then they are not descendants any more.
   *
   * The stored pids are only true while the tmux server lists the pane with the same pid. With no
   * such pane (a reboot, `kill-server`, a closed window) they can belong to another program now,
   * so nothing is signalled. In a dead pane the pid is free: only the members of its process group
   * that started after the pane opened are signalled, one by one.
   */
  async stop(ref: PaneRef, options: StopOptions = {}): Promise<void> {
    const grace = options.graceMs ?? 5000;
    const pane = (await this.list()).find((p) => p.pane === ref.pane && p.pid === ref.pid);
    if (!pane) return;
    if (pane.dead) {
      if (ref.opened === undefined) return;
      const opened = ref.opened;
      const before = groupProcessesSince(await processTable(), ref.pgid, opened);
      for (const pid of before) signal(pid, "SIGTERM");
      const end = Date.now() + grace;
      while (Date.now() < end && [...before].some(processExists)) await this.#sleep(100);
      const after = groupProcessesSince(await processTable(), ref.pgid, opened);
      for (const pid of new Set([...before, ...after])) {
        if (processExists(pid)) signal(pid, "SIGKILL");
      }
      return;
    }
    const before = sessionProcesses(await processTable(), ref.pid, ref.pgid);
    if (ref.pgid > 1) signal(-ref.pgid, "SIGTERM");
    else signal(ref.pid, "SIGTERM");
    const end = Date.now() + grace;
    while (Date.now() < end && [...before].some(processExists)) await this.#sleep(100);
    if (ref.pgid > 1) signal(-ref.pgid, "SIGKILL");
    const after = sessionProcesses(await processTable(), ref.pid, ref.pgid);
    for (const pid of new Set([...before, ...after])) {
      if (processExists(pid)) signal(pid, "SIGKILL");
    }
  }

  async close(ref: PaneRef): Promise<void> {
    await this.#tmux(["kill-window", "-t", ref.window]);
  }

  /** Stops the whole tmux server of this socket (tests and `aw service uninstall`). */
  async killServer(): Promise<void> {
    if (this.#options.binary) await this.#tmux(["kill-server"]);
  }
}
