// The rotation of awd.log (openspec gap-install, awd-service: logs). launchd writes the stdout and
// stderr of awd to `<AW_HOME>/logs/awd.log` and keeps the file open with O_APPEND, so a rename would
// not start a new file. awd copies the file to `awd.log.1` and truncates it to 0 bytes. systemd sends
// the output to the journal: on Linux the file does not exist and the check does nothing.
import type { Clock } from "@aw/core";
import { open, rename, rm, stat, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "./log.ts";

/** Rotate above this size. */
export const LOG_MAX_BYTES = 10 * 1024 * 1024;
/** The number of old files. */
export const LOG_KEEP = 3;
/** The time between 2 checks. */
export const LOG_CHECK_MS = 5 * 60 * 1000;

/** The log file of the launchd unit. */
export const awdLogPath = (awHome: string) => join(awHome, "logs", "awd.log");

const size = (path: string) =>
  stat(path).then(
    (info) => info.size,
    () => null,
  );

/** Copies the last `maxBytes` of a file to `to`. */
async function copyTail(from: string, to: string, maxBytes: number): Promise<void> {
  const source = await open(from, "r");
  try {
    const { size: total } = await source.stat();
    const length = Math.min(total, maxBytes);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await source.read(buffer, 0, length, total - length);
    await writeFile(to, buffer.subarray(0, bytesRead));
  } finally {
    await source.close();
  }
}

/**
 * Rotates the file when it has more than `maxBytes`: `.2` → `.3`, `.1` → `.2`, the last `maxBytes`
 * to `.1`, then a truncate to 0. Lines written between the copy and the truncate are lost. The
 * truncate also runs when the copy fails (a full disk): the rotation must free the space (fix list
 * 0-25); the error then goes to the caller. Returns true when it rotated.
 */
export async function rotateLog(
  path: string,
  maxBytes = LOG_MAX_BYTES,
  keep = LOG_KEEP,
  copy: (from: string, to: string, maxBytes: number) => Promise<void> = copyTail,
): Promise<boolean> {
  const current = await size(path);
  if (current === null || current <= maxBytes) return false;
  let copying = false;
  try {
    await rm(`${path}.${keep}`, { force: true });
    for (let n = keep - 1; n >= 1; n -= 1) {
      await rename(`${path}.${n}`, `${path}.${n + 1}`).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    copying = true;
    await copy(path, `${path}.1`, maxBytes);
  } catch (error) {
    // A part of a copy is no log: remove it.
    if (copying) await rm(`${path}.1`, { force: true }).catch(() => undefined);
    await truncate(path, 0);
    throw error;
  }
  await truncate(path, 0);
  return true;
}

/** Checks the log at start and every `LOG_CHECK_MS` until `close()`. */
export class LogRotator {
  readonly #path: string;
  readonly #clock: Clock;
  readonly #log: Logger;
  #closed = false;

  constructor(options: { path: string; clock: Clock; log: Logger }) {
    this.#path = options.path;
    this.#clock = options.clock;
    this.#log = options.log;
  }

  async check(): Promise<boolean> {
    try {
      const rotated = await rotateLog(this.#path);
      if (rotated) this.#log.info({ file: this.#path }, "The log file was rotated");
      return rotated;
    } catch (error) {
      this.#log.warn(
        { err: error, file: this.#path },
        "The log rotation failed: AW emptied the log file, and its old lines are not kept",
      );
      return false;
    }
  }

  start(): void {
    void (async () => {
      while (!this.#closed) {
        await this.check();
        // Short sleeps: a stop of awd does not wait for one long timer.
        for (let waited = 0; waited < LOG_CHECK_MS && !this.#closed; waited += 1000) {
          await this.#clock.sleep(1000);
        }
      }
    })();
  }

  close(): void {
    this.#closed = true;
  }
}
