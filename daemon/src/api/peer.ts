// The peer process check of the local API (design of add-mcp-server, decision 6): which process is
// at the other end of a connection on awd.sock, and is it in the process tree of a running session?
// Node has no SO_PEERCRED or LOCAL_PEERPID, so awd asks `lsof` (macOS) or `ss` (Linux) once per
// checked request. A failed check gives null: the caller rule treats the caller as the person.
import { execa } from "execa";
import { readlink } from "node:fs/promises";
import type { Socket } from "node:net";

export interface PeerTools {
  platform: NodeJS.Platform;
  /** Runs a program with exec-form arguments and returns its stdout. */
  run(file: string, args: string[]): Promise<string>;
  readlink(path: string): Promise<string>;
  pid: number;
}

export const systemPeerTools: PeerTools = {
  platform: process.platform,
  run: async (file, args) => {
    const result = await execa(file, args, { timeout: 5000, reject: false });
    // lsof exits 1 when one of the selected processes has no Unix socket: the list is still valid.
    const ok = result.exitCode === 0 || (file === "lsof" && result.exitCode === 1);
    if (!ok || result.timedOut) {
      throw new Error(`${file} failed: ${result.timedOut ? "timeout" : `exit ${result.exitCode}`}`);
    }
    return result.stdout;
  },
  readlink: (path) => readlink(path),
  pid: process.pid,
};

/** The file descriptor of the accepted socket, or null (libuv keeps it on the pipe handle). */
export function socketFd(socket: Socket): number | null {
  const handle = (socket as unknown as { _handle?: { fd?: unknown } })._handle;
  const fd = handle?.fd;
  return typeof fd === "number" && fd >= 0 ? fd : null;
}

/**
 * macOS: `lsof -F` gives for each Unix socket its address (`d0x…`) and its peer (`n->0x…`). The
 * peer of our socket is the socket whose `n->` names our address. With `candidates`, lsof lists only
 * the sockets of these processes (the session trees), not each Unix socket of the computer.
 */
async function peerDarwin(
  fd: number,
  tools: PeerTools,
  candidates: number[] | undefined,
): Promise<number | null> {
  const own = await tools.run("lsof", [
    "-nP",
    "-U",
    "-a",
    "-p",
    String(tools.pid),
    "-d",
    String(fd),
    "-F",
    "d",
  ]);
  const address = /^d(0x[0-9a-f]+)$/m.exec(own)?.[1];
  if (!address) return null;
  const others = candidates?.filter((pid) => pid !== tools.pid);
  if (others && others.length === 0) return null;
  const all = await tools.run(
    "lsof",
    others ? ["-nP", "-U", "-a", "-p", others.join(","), "-F", "pdn"] : ["-nP", "-U", "-F", "pdn"],
  );
  let pid: number | null = null;
  for (const line of all.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line === `n->${address}` && pid !== null && pid !== tools.pid) return pid;
  }
  return null;
}

/**
 * Linux: `/proc/self/fd/<fd>` names the inode of our socket. `ss -xpn` gives for each Unix socket
 * its inode, the inode of its peer and the process that holds it.
 */
async function peerLinux(fd: number, tools: PeerTools): Promise<number | null> {
  const link = await tools.readlink(`/proc/${tools.pid}/fd/${fd}`);
  const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1];
  if (!inode) return null;
  const rows = (await tools.run("ss", ["-xpn"]))
    .split("\n")
    .slice(1)
    .map((line) => {
      // u_str ESTAB 0 0 <local path or *> <inode> <peer path or *> <peer inode> users:((...,pid=N,...))
      const fields = line.trim().split(/\s+/);
      const users = /pid=(\d+)/.exec(line);
      return {
        local: fields[5] ?? "",
        peer: fields[7] ?? "",
        pid: users ? Number(users[1]) : null,
      };
    });
  const ours = rows.find((row) => row.local === inode);
  if (!ours) return null;
  const theirs = rows.find((row) => row.local === ours.peer);
  return theirs?.pid ?? null;
}

/**
 * The pid of the process at the other end of a Unix socket connection, or null. With `candidates`
 * (macOS), only these processes are looked at: null then means "none of them".
 */
export async function peerPid(
  socket: Socket,
  tools: PeerTools = systemPeerTools,
  candidates?: number[],
) {
  const fd = socketFd(socket);
  if (fd === null) return null;
  if (tools.platform === "darwin") return peerDarwin(fd, tools, candidates);
  if (tools.platform === "linux") return peerLinux(fd, tools);
  return null;
}

/** The parent of each process (`ps -A -o pid=,ppid=`). */
export async function parentTable(
  tools: PeerTools = systemPeerTools,
): Promise<Map<number, number>> {
  const parents = new Map<number, number>();
  for (const line of (await tools.run("ps", ["-A", "-o", "pid=,ppid="])).split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (match) parents.set(Number(match[1]), Number(match[2]));
  }
  return parents;
}

/** The first of `roots` that is `pid` or one of its parent processes, or null. */
export function ancestorIn(
  pid: number,
  parents: Map<number, number>,
  roots: ReadonlyMap<number, string>,
): string | null {
  const seen = new Set<number>();
  let current: number | undefined = pid;
  while (current !== undefined && current > 1 && !seen.has(current)) {
    const root = roots.get(current);
    if (root !== undefined) return root;
    seen.add(current);
    current = parents.get(current);
  }
  return null;
}

/** Each process of the trees of `roots`: the roots and all their child processes. */
export function descendants(roots: Iterable<number>, parents: Map<number, number>): number[] {
  const children = new Map<number, number[]>();
  for (const [pid, ppid] of parents) {
    const list = children.get(ppid);
    if (list) list.push(pid);
    else children.set(ppid, [pid]);
  }
  const found = new Set<number>();
  const queue = [...roots];
  while (queue.length > 0) {
    const pid = queue.pop()!;
    if (found.has(pid)) continue;
    found.add(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return [...found];
}
