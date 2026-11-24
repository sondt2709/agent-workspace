// The process table from `ps`, for the process-group stop (docs/phase-1.md 9.7). AW never finds a
// session process by its command line (`pgrep -f`); it starts from the stored pids.
import { execa } from "execa";

export interface ProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
  /** The start time in ms (from the elapsed time, so ±1 s), or null when `ps` gave none. */
  started: number | null;
}

/** Parses `[[dd-]hh:]mm:ss` (the `etime` field of `ps`) into seconds, or null. */
export function parseElapsed(text: string): number | null {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(text);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds)
  );
}

/** Parses the output of `ps -A -o pid=,ppid=,pgid=[,etime=]`. */
export function parseProcessTable(text: string, now = Date.now()): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3 && parts.length !== 4) continue;
    const [pid, ppid, pgid] = parts.slice(0, 3).map(Number) as [number, number, number];
    if (![pid, ppid, pgid].every(Number.isInteger)) continue;
    const elapsed = parts[3] === undefined ? null : parseElapsed(parts[3]);
    rows.push({ pid, ppid, pgid, started: elapsed === null ? null : now - elapsed * 1000 });
  }
  return rows;
}

export async function processTable(): Promise<ProcessRow[]> {
  const result = await execa("ps", ["-A", "-o", "pid=,ppid=,pgid=,etime="], { reject: false });
  return parseProcessTable(String(result.stdout ?? ""));
}

function withDescendants(rows: ProcessRow[], start: Iterable<number>): Set<number> {
  const children = new Map<number, number[]>();
  for (const row of rows) {
    const list = children.get(row.ppid) ?? [];
    list.push(row.pid);
    children.set(row.ppid, list);
  }
  const found = new Set<number>();
  const stack = [...start];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (pid <= 1 || found.has(pid)) continue;
    found.add(pid);
    for (const child of children.get(pid) ?? []) if (!found.has(child)) stack.push(child);
  }
  return found;
}

/** The pids of the process `root` and each of its descendants, and of each member of `pgid`. */
export function sessionProcesses(rows: ProcessRow[], root: number, pgid: number): Set<number> {
  const start = pgid > 1 ? rows.filter((r) => r.pgid === pgid).map((r) => r.pid) : [];
  if (rows.some((r) => r.pid === root)) start.push(root);
  return withDescendants(rows, start);
}

/** Slack for the start time of `ps` (whole seconds) against the open time of the pane. */
export const START_SLACK_MS = 2000;

/**
 * The members of the process group `pgid` that started at or after `since`, and their
 * descendants. A member that started before the pane opened is another program that got a reused
 * pid: it is never in the set.
 */
export function groupProcessesSince(rows: ProcessRow[], pgid: number, since: number): Set<number> {
  if (pgid <= 1) return new Set();
  const members = rows
    .filter((r) => r.pgid === pgid && r.started !== null && r.started >= since - START_SLACK_MS)
    .map((r) => r.pid);
  return withDescendants(rows, members);
}

/** True when a process with the pid exists. */
export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    // The process is gone.
  }
}
