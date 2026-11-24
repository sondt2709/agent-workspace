// The process of a pane by its pid (design of add-continuity decision 6): never a process search.
import { execa } from "execa";
import { statfs } from "node:fs/promises";

export interface ProcessInfo {
  pgid: number;
  args: string;
}

/** `ps -o pgid=,args= -p <pid>`, or null when the process is gone. */
export async function processInfo(pid: number): Promise<ProcessInfo | null> {
  const result = await execa("ps", ["-o", "pgid=,args=", "-p", String(pid)], { reject: false });
  return parseProcessLine(String(result.stdout ?? ""));
}

export function parseProcessLine(text: string): ProcessInfo | null {
  const match = /^\s*(\d+)\s+(.*)$/.exec(text.split("\n")[0] ?? "");
  if (!match) return null;
  return { pgid: Number(match[1]), args: match[2]!.trim() };
}

/** True when the arguments name this session id as a separate word. */
export function runsSession(args: string, session: string): boolean {
  return args.split(/\s+/).includes(session);
}

/** The used part of the file system of a path, in percent, or null. */
export async function diskUse(path: string): Promise<number | null> {
  try {
    const stats = await statfs(path);
    const total = stats.blocks * stats.bsize;
    if (total <= 0) return null;
    // `bavail` is what a normal user can still write (df "Use%" uses it the same way).
    const used = (stats.blocks - stats.bfree) * stats.bsize;
    const usable = used + stats.bavail * stats.bsize;
    return usable > 0 ? Math.min(100, (used / usable) * 100) : null;
  } catch {
    return null;
  }
}
