// The engine supervisor (docs/phase-1.md 6.1): awd starts the engine, checks
// `/rest/system/ping` every 10 s, restarts it with a backoff, records the pid of each engine
// process (ST10) and stops each one. Delays come from the clock module.
import type { Clock } from "@aw/core";
import { execa, type ResultPromise } from "execa";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import pRetry, { AbortError } from "p-retry";
import { prepareEngineHome, type EngineConfigInput, type EngineIdentity } from "./config.ts";
import { EngineRest } from "./rest.ts";

/** The health check period. */
export const HEALTH_MS = 10_000;
/** Failed checks in a row before a restart. */
export const HEALTH_FAILURES = 3;
/** The first and the longest restart delay. */
export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;
/** A run of this length resets the backoff. */
export const HEALTHY_RESET_MS = 60_000;
/** Restarts with no healthy minute before the state is `failed`. */
export const FAILED_AFTER = 10;
/** The wait between SIGTERM and SIGKILL. */
export const STOP_GRACE_MS = 10_000;
/** The longest Unix socket path (macOS: 104 bytes with the end byte; Linux allows 107). */
export const MAX_SOCKET_PATH_BYTES = 103;

export type EngineState =
  "not_installed" | "starting" | "running" | "restarting" | "stopped" | "failed";

/** The log methods that the plugin uses (pino has them). */
export interface SyncLogger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** The restart delay after `count` restarts with no healthy minute. */
export function backoffMs(count: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, count));
}

/** The children of each pid, from `ps` (exact pids, never a name match). */
export async function childPids(pids: number[]): Promise<number[]> {
  const result = await execa("ps", ["-A", "-o", "pid=,ppid="], { reject: false });
  const children: number[] = [];
  for (const line of result.stdout.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid !== undefined && ppid !== undefined && pids.includes(ppid)) children.push(pid);
  }
  return children;
}

/** The command name of a pid, or null when no such process runs. */
export async function commandName(pid: number): Promise<string | null> {
  const result = await execa("ps", ["-o", "comm=", "-p", String(pid)], { reject: false });
  const name = result.stdout.trim();
  return result.exitCode === 0 && name !== "" ? name : null;
}

/** The command line of a pid, or null when no such process runs. */
export async function commandArgs(pid: number): Promise<string | null> {
  const result = await execa("ps", ["-o", "args=", "-p", String(pid)], { reject: false });
  const args = result.stdout.trim();
  return result.exitCode === 0 && args !== "" ? args : null;
}

/**
 * True when a process is an AW engine of this home: a `syncthing` command with `--home=<home>`.
 * The user's own Syncthing has another home, so awd never stops it.
 */
export function isEngineOf(name: string | null, args: string | null, home: string): boolean {
  if (name === null || args === null || !/syncthing$/.test(name)) return false;
  return args.split(/\s+/).includes(`--home=${home}`);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    // The process is gone.
  }
}

export interface SupervisorOptions {
  binary: string;
  config: EngineConfigInput;
  /** The engine log file (with rotation). */
  logFile: string;
  clock: Clock;
  log: SyncLogger;
  /**
   * Called after each (re)start, when the REST API answers. An error does not stop the engine:
   * the supervisor logs it and calls it again at the next health check.
   */
  onStart?: (rest: EngineRest, generation: number) => Promise<void>;
  /** The health check period (default HEALTH_MS). */
  healthMs?: number;
  /** Called at each state change. */
  onState?: (state: EngineState) => void;
}

export class EngineSupervisor {
  readonly #options: SupervisorOptions;
  #state: EngineState = "stopped";
  #generation = 0;
  #identity: EngineIdentity | null = null;
  #rest: EngineRest | null = null;
  #child: ResultPromise | null = null;
  #pids: number[] = [];
  #stopping = false;
  #restarts = 0;
  #runningSince = 0;
  #restarting: Promise<void> | null = null;
  #healthRunning = false;
  #stderr = "";
  /** The generation whose onStart failed, or 0. */
  #configPending = 0;
  #configuring: Promise<void> | null = null;
  /** Resolves when stop() is called: a backoff wait ends at once. */
  #stopSignal: Promise<void> = Promise.resolve();
  #signalStop: () => void = () => undefined;

  constructor(options: SupervisorOptions) {
    this.#options = options;
  }

  get state(): EngineState {
    return this.#state;
  }

  get generation(): number {
    return this.#generation;
  }

  get deviceId(): string | null {
    return this.#identity?.deviceId ?? null;
  }

  /** The REST adapter of the running engine. */
  get rest(): EngineRest {
    if (!this.#rest || this.#state !== "running") {
      throw new Error(`The sync engine is not running (state ${this.#state})`);
    }
    return this.#rest;
  }

  get restOrNull(): EngineRest | null {
    return this.#state === "running" ? this.#rest : null;
  }

  /** The recorded pids of the engine processes. */
  get pids(): number[] {
    return [...this.#pids];
  }

  get #pidFile(): string {
    return join(this.#options.config.home, "aw-engine.pid");
  }

  #setState(state: EngineState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#options.onState?.(state);
  }

  /**
   * Prepares the home (first-start config), stops a stale engine, starts the engine. An error of
   * a step (for example `generate` of a binary of another architecture, or a full disk) does not
   * throw: the state is `failed`, the cause is logged, and the restart loop tries again.
   */
  async start(): Promise<void> {
    this.#stopping = false;
    this.#stopSignal = new Promise<void>((resolve) => {
      this.#signalStop = resolve;
    });
    this.#identity = null;
    this.#rest = null;
    this.#setState("starting");
    try {
      await this.#prepare();
      await this.#spawn();
    } catch (error) {
      // Not prepared: the restart loop sets the state `failed` at once.
      const prepared = this.#identity !== null;
      this.#options.log.error(
        { err: error },
        prepared
          ? "The sync engine did not start"
          : "The sync engine home was not prepared; awd tries again",
      );
      this.#scheduleRestart(prepared ? "start failed" : "prepare failed");
    }
    if (!this.#healthRunning) {
      this.#healthRunning = true;
      void this.#healthLoop().finally(() => {
        this.#healthRunning = false;
      });
    }
  }

  /** The folders, the engine home (config before the first serve) and a stale engine. */
  async #prepare(): Promise<void> {
    const socket = this.#options.config.socket;
    if (Buffer.byteLength(socket) > MAX_SOCKET_PATH_BYTES) {
      // The engine cannot bind it ("bind: invalid argument"). awd.sock is 1 byte shorter.
      throw new Error(
        `The sync engine socket path ${socket} is longer than ${MAX_SOCKET_PATH_BYTES} bytes. Use a shorter AW_HOME.`,
      );
    }
    await mkdir(dirname(this.#options.logFile), { recursive: true, mode: 0o700 });
    const run = dirname(this.#options.config.socket);
    await mkdir(run, { recursive: true, mode: 0o700 });
    await chmod(run, 0o700);
    // A stale engine first: it must not write config.xml after awd checked it.
    await this.#stopStale();
    const identity = await prepareEngineHome(this.#options.binary, this.#options.config);
    if (identity.replaced) {
      this.#options.log.warn(
        { home: this.#options.config.home },
        "The engine config.xml was not an AW config (for example an awd stop during the first start); awd wrote the AW config",
      );
    }
    this.#identity = identity;
    this.#rest = new EngineRest({ socket: identity.socket, apiKey: identity.apiKey });
  }

  /** Stops an engine that an earlier awd left (the pid file names it). */
  async #stopStale(): Promise<void> {
    const text = await readFile(this.#pidFile, "utf8").catch(() => "");
    const pids = text
      .split(/\s+/)
      .map(Number)
      .filter((pid) => Number.isInteger(pid) && pid > 0);
    const stale: number[] = [];
    const home = this.#options.config.home;
    for (const pid of pids) {
      // An old pid can now be another process, for example the user's own Syncthing after a
      // reboot: only a syncthing process with the home of this awd is stopped.
      if (isEngineOf(await commandName(pid), await commandArgs(pid), home)) stale.push(pid);
    }
    if (stale.length > 0) {
      this.#options.log.warn({ pids: stale }, "Stopping a sync engine of an earlier awd");
      await this.#kill(stale);
    }
    await rm(this.#pidFile, { force: true });
  }

  async #spawn(): Promise<void> {
    const { binary, config, logFile } = this.#options;
    if (this.#stopping) throw new AbortError("awd stops the sync engine");
    this.#stderr = "";
    const child = execa(
      binary,
      [
        "serve",
        `--home=${config.home}`,
        "--no-browser",
        "--no-upgrade",
        "--no-restart",
        `--log-file=${logFile}`,
        "--log-max-size=10485760",
        "--log-max-old-files=3",
      ],
      {
        env: { STNOUPGRADE: "1", STNODEFAULTFOLDER: "1" },
        extendEnv: true,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
        reject: false,
        cleanup: true,
        buffer: false,
      },
    );
    this.#child = child;
    child.stderr?.on("data", (chunk: Buffer) => {
      this.#stderr = (this.#stderr + chunk.toString("utf8")).slice(-2000);
    });
    const pid = child.pid;
    if (pid === undefined) throw new Error(`The sync engine ${binary} did not start`);
    this.#pids = [pid];
    void child.then((result) => this.#exited(child, result.exitCode, result.signal));

    const rest = this.#rest!;
    await pRetry(
      async () => {
        if (this.#child !== child || this.#stopping) throw new AbortError("The engine exited");
        await rest.ping(1000);
      },
      {
        retries: 300,
        minTimeout: 0,
        maxTimeout: 0,
        onFailedAttempt: () => this.#options.clock.sleep(100),
      },
    );
    // The device id of the running engine. config.xml also lists the peers (and the folder
    // devices before them), so the id never comes from the config text.
    const myId = await rest.myId();
    if (this.#identity && myId !== this.#identity.deviceId) {
      this.#options.log.warn(
        { config: this.#identity.deviceId, engine: myId },
        "The engine device id differs from the prepared id; the engine id is used",
      );
      this.#identity = { ...this.#identity, deviceId: myId };
    }
    this.#pids = [pid, ...(await childPids([pid]))];
    await writeFile(this.#pidFile, `${this.#pids.join("\n")}\n`, { mode: 0o600 });
    this.#generation += 1;
    this.#runningSince = this.#options.clock.now();
    this.#setState("running");
    this.#options.log.info(
      { pids: this.#pids, generation: this.#generation },
      "The sync engine runs",
    );
    await this.#configure(rest, this.#generation);
  }

  /**
   * Calls onStart. An error of a config step (for example a folder on a read-only mount) keeps
   * the engine running: the next health check tries the step again.
   */
  async #configure(rest: EngineRest, generation: number): Promise<void> {
    const onStart = this.#options.onStart;
    if (!onStart) return;
    if (this.#configuring) await this.#configuring.catch(() => undefined);
    if (generation !== this.#generation || this.#stopping) return;
    this.#configPending = 0;
    this.#configuring = onStart(rest, generation)
      .catch((error: unknown) => {
        if (generation !== this.#generation || this.#stopping) return;
        this.#configPending = generation;
        this.#options.log.error(
          { err: error, generation },
          "The sync engine config step failed; it runs again at the next health check",
        );
      })
      .finally(() => {
        this.#configuring = null;
      });
    await this.#configuring;
  }

  #exited(child: ResultPromise, code: number | undefined, sig: string | undefined): void {
    if (this.#child !== child) return;
    this.#child = null;
    if (this.#stopping) return;
    this.#options.log.warn(
      { code, signal: sig, stderr: this.#stderr.trim() || undefined },
      "The sync engine exited",
    );
    this.#scheduleRestart("exit");
  }

  /** Starts one restart loop; a second call while it runs does nothing. */
  #scheduleRestart(reason: string): void {
    if (this.#stopping || this.#restarting) return;
    const restarting = this.#restart(reason).finally(() => {
      if (this.#restarting === restarting) this.#restarting = null;
    });
    this.#restarting = restarting;
  }

  /** Restarts the engine with the backoff until a spawn succeeds or stop() is called. */
  async #restart(firstReason: string): Promise<void> {
    const { clock, log } = this.#options;
    let reason = firstReason;
    while (!this.#stopping) {
      if (clock.now() - this.#runningSince >= HEALTHY_RESET_MS && this.#runningSince > 0) {
        this.#restarts = 0;
      }
      // A home that was never prepared (for example `generate` failed) is `failed` at once.
      const failed = this.#restarts >= FAILED_AFTER || this.#identity === null;
      this.#setState(failed ? "failed" : "restarting");
      const delay = backoffMs(this.#restarts);
      this.#restarts += 1;
      log.warn({ reason, delay_ms: delay, restarts: this.#restarts }, "The sync engine restarts");
      await this.#kill(this.#pids);
      // stop() ends the wait at once.
      await Promise.race([clock.sleep(delay), this.#stopSignal]);
      if (this.#stopping) return;
      try {
        if (this.#identity === null) await this.#prepare();
        await this.#spawn();
        return;
      } catch (error) {
        log.error({ err: error }, "The sync engine restart failed");
        reason = this.#identity === null ? "prepare failed" : "restart failed";
      }
    }
  }

  async #healthLoop(): Promise<void> {
    let failures = 0;
    while (!this.#stopping) {
      await Promise.race([
        this.#options.clock.sleep(this.#options.healthMs ?? HEALTH_MS),
        this.#stopSignal,
      ]);
      if (this.#stopping) break;
      if (this.#state !== "running" || !this.#rest) {
        failures = 0;
        continue;
      }
      try {
        await this.#rest.ping(5000);
        failures = 0;
        if (this.#options.clock.now() - this.#runningSince >= HEALTHY_RESET_MS) this.#restarts = 0;
        if (this.#configPending === this.#generation) {
          await this.#configure(this.#rest, this.#generation);
        }
      } catch (error) {
        failures += 1;
        this.#options.log.warn({ err: error, failures }, "The sync engine health check failed");
        if (failures >= HEALTH_FAILURES) {
          failures = 0;
          this.#scheduleRestart("health check");
        }
      }
    }
  }

  /** SIGTERM to each pid, then SIGKILL after the grace time. */
  async #kill(pids: number[]): Promise<void> {
    const live = pids.filter(alive);
    if (live.length === 0) return;
    for (const pid of live) signal(pid, "SIGTERM");
    const until = this.#options.clock.now() + STOP_GRACE_MS;
    while (live.some(alive) && this.#options.clock.now() < until) {
      await this.#options.clock.sleep(100);
    }
    for (const pid of live.filter(alive)) signal(pid, "SIGKILL");
  }

  /** Stops the engine and the health loop. No engine process is left. */
  async stop(): Promise<void> {
    this.#stopping = true;
    this.#signalStop();
    await this.#restarting?.catch(() => undefined);
    const child = this.#child;
    await this.#kill(this.#pids);
    // A config step of the stopped engine fails fast once the socket is closed.
    await this.#configuring?.catch(() => undefined);
    if (child) await child.catch(() => undefined);
    this.#child = null;
    this.#pids = [];
    await rm(this.#pidFile, { force: true });
    this.#setState("stopped");
  }
}
