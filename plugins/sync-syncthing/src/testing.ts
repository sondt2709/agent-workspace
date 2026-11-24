// Test helpers: the pinned engine of this computer (fetched once into the cache) and a test node
// with its own AW_HOME, port and workspace folder. Not in the package index.
import { openWorkspace, systemClock, type WorkspaceFiles } from "@aw/core";
import type { SyncDeviceRole } from "@aw/plugin-api";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SyncLogger } from "./supervisor.ts";
import { SyncthingTransport } from "./transport.ts";

export { ensureTestEngine } from "./pins.ts";
export { commandName } from "./supervisor.ts";

/** A free TCP port on 127.0.0.1. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** A logger that keeps the entries in memory. */
export function memoryLog(): SyncLogger & {
  entries: { level: string; obj: object; msg?: string }[];
} {
  const entries: { level: string; obj: object; msg?: string }[] = [];
  const add = (level: string) => (obj: object, msg?: string) => {
    entries.push({ level, obj, ...(msg === undefined ? {} : { msg }) });
  };
  return {
    entries,
    debug: add("debug"),
    info: add("info"),
    warn: add("warn"),
    error: add("error"),
  };
}

export interface TestNode {
  slug: string;
  role: SyncDeviceRole;
  home: string;
  root: string;
  port: number;
  transport: SyncthingTransport;
  files: WorkspaceFiles;
  log: ReturnType<typeof memoryLog>;
  /** Stops the engine and removes the folders. */
  close(): Promise<void>;
}

/** A device with its own AW_HOME (short, for the socket path), a workspace folder and a port. */
export async function testNode(input: {
  binary: string;
  slug: string;
  role: SyncDeviceRole;
  workspace: string;
  deviceOrder?: string[];
  /** Keep the peers in `sync-peers.json` (the transport default) or not (awd). */
  persistPeers?: boolean;
}): Promise<TestNode> {
  const base = await mkdtemp(join(tmpdir(), "aws-"));
  const home = join(base, "h");
  const root = join(base, "w");
  for (const kind of ["tasks", "knowledge", "secure"])
    await mkdir(join(root, kind), { recursive: true });
  const port = await freePort();
  const log = memoryLog();
  let files: WorkspaceFiles | null = null;
  const transport = new SyncthingTransport({
    binary: input.binary,
    home,
    device: { slug: input.slug, role: input.role },
    listen: `tcp://127.0.0.1:${port}`,
    community: false,
    clock: systemClock,
    log,
    files: (ws) => (ws === input.workspace ? (files ?? undefined) : undefined),
    deviceOrder: () => input.deviceOrder ?? [],
    ...(input.persistPeers === undefined ? {} : { persistPeers: input.persistPeers }),
  });
  files = openWorkspace({
    root,
    device: input.slug,
    role: input.role === "mobile" ? "mobile" : input.role,
    clock: systemClock,
    onWrite: transport.writeHook(input.workspace),
  });
  return {
    slug: input.slug,
    role: input.role,
    home,
    root,
    port,
    transport,
    files,
    log,
    async close() {
      await transport.stop().catch(() => undefined);
      await rm(base, { recursive: true, force: true });
    },
  };
}

/** Waits until the check returns a value that is not false, null or undefined. */
export async function waitFor<T>(
  check: () => Promise<T | null | undefined | false> | T | null | undefined | false,
  timeoutMs = 30_000,
  stepMs = 100,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      const value = await check();
      if (value !== null && value !== undefined && value !== false) return value;
    } catch (error) {
      last = error;
    }
    if (Date.now() > until) {
      throw new Error(
        `waitFor timed out after ${timeoutMs} ms${last instanceof Error ? `: ${last.message}` : ""}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}
