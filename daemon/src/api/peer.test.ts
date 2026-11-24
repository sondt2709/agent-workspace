// Tests of the peer process check (add-mcp-server, decision 6): the parsers with captured outputs,
// the parent chain, and a real connection on this computer.
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "../testing.ts";
import {
  ancestorIn,
  descendants,
  parentTable,
  peerPid,
  systemPeerTools,
  type PeerTools,
} from "./peer.ts";

// Captured on macOS 26 (Darwin 25.6) on 2026-11-23: a Python Unix socket server (pid 91485, the
// accepted socket on fd 4) and its client (pid 91486). Commands: `lsof -nP -U -a -p 91485 -d 4 -F d`
// and `lsof -nP -U -F pdn` (only the 2 processes of the pair are kept). The socket path is /tmp.
const LSOF_OWN = "p91485\nf4\nd0xbfbad36d9d097647\n";
const LSOF_ALL = [
  "p91485",
  "f3",
  "d0xeece2d177ba4db4",
  "n/tmp/aw-peer-capture.sock",
  "f4",
  "d0xbfbad36d9d097647",
  "n/tmp/aw-peer-capture.sock",
  "p91486",
  "f3",
  "d0xf820ac0523b15a16",
  "n->0xbfbad36d9d097647",
  "",
].join("\n");

// Captured on the Linux remote device (Debian 12, iproute2 6.1.0) on 2026-11-23: a Python Unix
// socket server (pid 4076446, the accepted socket on fd 4, `/proc/self/fd/4` = socket:[77638207])
// and its client (pid 4076449). Command: `ss -xpn`, the header and the 2 lines of the pair (the
// column padding is shorter). The socket path is /tmp.
const SS_PID = 4076446;
const SS = [
  "Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process",
  'u_str ESTAB 0      0      * 77639597            * 77638207 users:(("python3",pid=4076449,fd=3))',
  'u_str ESTAB 0      0      /tmp/aw-peer-capture.sock 77638207            * 77639597 users:(("python3",pid=4076446,fd=4))',
  "",
].join("\n");

function fakeTools(platform: NodeJS.Platform, outputs: Record<string, string>): PeerTools {
  return {
    platform,
    pid: platform === "darwin" ? 91485 : SS_PID,
    run: (file, args) => {
      const key = `${file} ${args.join(" ")}`;
      const out = outputs[key];
      return out === undefined
        ? Promise.reject(new Error(`no output for ${key}`))
        : Promise.resolve(out);
    },
    readlink: () => Promise.resolve("socket:[77638207]"),
  };
}

const socketWithFd = (fd: number) => ({ _handle: { fd } }) as unknown as Socket;

describe("peer process check", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  it("finds the peer pid in the lsof output of macOS", async () => {
    const tools = fakeTools("darwin", {
      "lsof -nP -U -a -p 91485 -d 4 -F d": LSOF_OWN,
      "lsof -nP -U -F pdn": LSOF_ALL,
    });
    expect(await peerPid(socketWithFd(4), tools)).toBe(91486);
    // A socket with no peer line gives null, never a wrong pid.
    const none = fakeTools("darwin", {
      "lsof -nP -U -a -p 91485 -d 4 -F d": LSOF_OWN,
      "lsof -nP -U -F pdn": LSOF_ALL.replace("n->0xbfbad36d9d097647", "n->0x1"),
    });
    expect(await peerPid(socketWithFd(4), none)).toBeNull();
  });

  it("lists only the sockets of the session processes on macOS", async () => {
    const client = LSOF_ALL.split("\n").slice(7).join("\n");
    const tools = fakeTools("darwin", {
      "lsof -nP -U -a -p 91485 -d 4 -F d": LSOF_OWN,
      // No output for the full listing: a call of it fails the test.
      "lsof -nP -U -a -p 91486,700 -F pdn": client,
      "lsof -nP -U -a -p 700 -F pdn": "p700\nf3\nd0x5\nn->0x6\n",
    });
    expect(await peerPid(socketWithFd(4), tools, [91486, 700])).toBe(91486);
    // The peer is not a session process: null (the person), with no full listing.
    expect(await peerPid(socketWithFd(4), tools, [700])).toBeNull();
    // Only awd itself: no second lsof.
    expect(await peerPid(socketWithFd(4), tools, [91485])).toBeNull();
  });

  it("lists the processes of the session trees", () => {
    const parents = new Map([
      [500, 400],
      [400, 300],
      [300, 1],
      [700, 1],
      [800, 700],
      [600, 300],
    ]);
    expect(descendants([300], parents).sort()).toEqual([300, 400, 500, 600]);
    expect(descendants([300, 700], parents).sort()).toEqual([300, 400, 500, 600, 700, 800]);
    expect(descendants([], parents)).toEqual([]);
  });

  it("finds the peer pid in the ss output of Linux", async () => {
    const tools = fakeTools("linux", { "ss -xpn": SS });
    expect(await peerPid(socketWithFd(4), tools)).toBe(4076449);
    expect(
      await peerPid(
        socketWithFd(109),
        fakeTools("linux", { "ss -xpn": SS.split("\n").slice(0, 2).join("\n") }),
      ),
    ).toBeNull();
  });

  it("gives null with no file descriptor or on another platform", async () => {
    expect(await peerPid({} as Socket, systemPeerTools)).toBeNull();
    expect(await peerPid(socketWithFd(3), fakeTools("win32", {}))).toBeNull();
  });

  it("walks the parent chain to a session pane", () => {
    const parents = new Map([
      [500, 400],
      [400, 300],
      [300, 1],
      [700, 1],
    ]);
    const roots = new Map([[300, "session-a"]]);
    expect(ancestorIn(500, parents, roots)).toBe("session-a");
    expect(ancestorIn(300, parents, roots)).toBe("session-a");
    expect(ancestorIn(700, parents, roots)).toBeNull();
    // A loop in a bad table ends.
    expect(
      ancestorIn(
        10,
        new Map([
          [10, 11],
          [11, 10],
        ]),
        roots,
      ),
    ).toBeNull();
  });

  it.skipIf(process.platform !== "darwin" && process.platform !== "linux")(
    "finds a real client process and its parent on this computer",
    async () => {
      dir = await tempDir("awp-");
      const path = join(dir, "peer.sock");
      const accepted = new Promise<Socket>((resolve) => {
        const server = createServer((socket) => {
          server.close();
          resolve(socket);
        });
        server.listen(path);
      });
      const child = spawn(
        process.execPath,
        [
          "-e",
          `require("node:net").connect(${JSON.stringify(path)}); setTimeout(() => {}, 10000);`,
        ],
        { stdio: "ignore" },
      );
      try {
        const socket = await accepted;
        const pid = await peerPid(socket);
        expect(pid).toBe(child.pid);
        const parents = await parentTable();
        expect(parents.get(child.pid!)).toBe(process.pid);
        expect(ancestorIn(pid!, parents, new Map([[process.pid, "this"]]))).toBe("this");
        // With the session processes as candidates: found when the client is one of them.
        const tree = descendants([process.pid], parents);
        expect(tree).toContain(child.pid);
        expect(await peerPid(socket, systemPeerTools, tree)).toBe(child.pid);
        if (process.platform === "darwin") {
          expect(await peerPid(socket, systemPeerTools, [process.pid])).toBeNull();
        }
        socket.destroy();
      } finally {
        child.kill();
      }
    },
    20_000,
  );
});
