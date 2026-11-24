// The hook spool (design decision 2): one JSON file per hook event in
// `~/.aw/sessions/<session>/spool/`. The hook writes it with a temp file and a rename and exits, so
// no event is lost while awd is down. awd handles the files in name order and moves each one to
// `spool/done/`.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const spoolEntry = z.object({
  event: z.string().min(1),
  /** The wall time of the hook in ms (only for the file name order and the log). */
  at: z.number(),
  payload: z.unknown(),
  /** The gate id that the hook gave to the agent (AskUserQuestion, ExitPlanMode). */
  gate: z.string().nullable().default(null),
  /** The reason when the AW guard of the hook denied the tool call (openspec session-options). */
  denied: z.string().nullable().default(null),
});
export type SpoolEntry = z.infer<typeof spoolEntry>;

let sequence = 0;

/** The file name: the time in microseconds, a counter and the pid, so the names sort in order. */
export function spoolName(atMicros: number, pid: number, event: string): string {
  sequence = (sequence + 1) % 1_000_000;
  return `${String(Math.round(atMicros)).padStart(17, "0")}-${String(sequence).padStart(6, "0")}-${pid}-${event.replace(/[^A-Za-z]/g, "")}.json`;
}

export async function writeSpool(
  dir: string,
  entry: z.input<typeof spoolEntry>,
  atMicros: number,
): Promise<string> {
  const name = spoolName(atMicros, process.pid, entry.event);
  const temp = join(dir, `.${name}.tmp`);
  await writeFile(temp, JSON.stringify(entry), { mode: 0o600 });
  await rename(temp, join(dir, name));
  return name;
}

/**
 * The event id of one step of a spool file: a UUIDv7 with the time of the hook and 74 bits of the
 * sha256 of the key (session, file, step). The same file and step give the same id, so a retry
 * of the file can see that its event is in the log.
 */
export function hookEventId(atMs: number, key: string): string {
  const hash = createHash("sha256").update(key).digest("hex");
  const ms = Math.max(0, Math.floor(atMs)).toString(16).padStart(12, "0").slice(-12);
  const variant = ((Number.parseInt(hash[3]!, 16) & 0x3) | 0x8).toString(16);
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7${hash.slice(0, 3)}-${variant}${hash.slice(4, 7)}-${hash.slice(7, 19)}`;
}

export interface SpoolFile {
  name: string;
  entry: SpoolEntry | null;
}

/** The spool files in name order. A file that does not parse has `entry: null`. */
export async function readSpool(dir: string): Promise<SpoolFile[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json") && !n.startsWith("."));
  } catch {
    return [];
  }
  const files: SpoolFile[] = [];
  for (const name of names.sort()) {
    try {
      const parsed = spoolEntry.safeParse(JSON.parse(await readFile(join(dir, name), "utf8")));
      files.push({ name, entry: parsed.success ? parsed.data : null });
    } catch {
      files.push({ name, entry: null });
    }
  }
  return files;
}

export async function markDone(dir: string, name: string): Promise<void> {
  await rename(join(dir, name), join(dir, "done", name)).catch(() => undefined);
}

/** Moves a file that AW cannot handle to `spool/failed/`, so the next files of the queue go on. */
export async function markFailed(dir: string, name: string): Promise<string> {
  const failed = join(dir, "failed");
  await mkdir(failed, { recursive: true, mode: 0o700 });
  await rename(join(dir, name), join(failed, name)).catch(() => undefined);
  return join(failed, name);
}

/** Removes the handled files older than the age (at start). */
export async function pruneDone(dir: string, now: number, maxAgeMs: number): Promise<number> {
  let removed = 0;
  const done = join(dir, "done");
  for (const name of await readdir(done).catch(() => [] as string[])) {
    const info = await stat(join(done, name)).catch(() => null);
    if (info && now - info.mtimeMs > maxAgeMs) {
      await rm(join(done, name), { force: true });
      removed++;
    }
  }
  return removed;
}
