// The pairing steps of the transport with 2 real pinned engines (openspec add-identity-and-pairing,
// sync-engine "Peers"): a pending device, the pairing folder, then the peers from awd.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureTestEngine, testNode, waitFor, type TestNode } from "./testing.ts";

const WS = "0193a7c2-5b1e-7c3a-9f20-6d1e2a4b8c02";
const PAIR = "aw-pair-AAAAAAAAAAAAAAAAAAAAAA";
let a: TestNode;
let b: TestNode;

/** Writes a reply of the engine to AW_CAPTURE_DIR, for the evidence of a fixture. */
async function capture(name: string, value: unknown): Promise<void> {
  const dir = process.env.AW_CAPTURE_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

beforeAll(async () => {
  const binary = await ensureTestEngine();
  a = await testNode({
    binary,
    slug: "macbook-pro",
    role: "local",
    workspace: WS,
    persistPeers: false,
  });
  b = await testNode({
    binary,
    slug: "ubuntu-01",
    role: "remote",
    workspace: WS,
    persistPeers: false,
  });
  await Promise.all([a.transport.start(), b.transport.start()]);
  await a.transport.addWorkspace(WS, a.root);
  await b.transport.addWorkspace(WS, b.root);
}, 120_000);

afterAll(async () => {
  await Promise.all([a?.close(), b?.close()]);
}, 30_000);

describe("pairing through the engine", () => {
  it("finds a pending device, accepts its pairing folder and gets its request file", async () => {
    const pathB = join(b.home, "pairing", "b");
    const pathA = join(a.home, "pairing", "a");
    await mkdir(pathB, { recursive: true });
    await mkdir(pathA, { recursive: true });
    await writeFile(join(pathB, "request.json"), '{"v":1}\n');
    // B knows A from the code: its device id and its address.
    await b.transport.addPairingDevice(a.transport.syncId!, "pairing", [
      `tcp://127.0.0.1:${a.port}`,
    ]);
    await b.transport.addPairingFolder(PAIR, pathB, a.transport.syncId!);
    expect(await b.transport.reconnectInterval()).toBe(5);

    const pending = await waitFor(async () => {
      const devices = await a.transport.pendingDevices();
      return b.transport.syncId! in devices ? devices : null;
    }, 60_000);
    await capture("pending-devices", pending);
    expect(pending[b.transport.syncId!]).toMatchObject({ name: "ubuntu-01" });

    await a.transport.addPairingDevice(b.transport.syncId!, "pairing", []);
    const folders = await waitFor(async () => {
      const offered = await a.transport.pendingFolders();
      return offered[PAIR]?.offeredBy[b.transport.syncId!] ? offered : null;
    }, 60_000);
    await capture("pending-folders", folders);
    await a.transport.addPairingFolder(PAIR, pathA, b.transport.syncId!);
    const request = await waitFor(
      () => readFile(join(pathA, "request.json"), "utf8").catch(() => null),
      60_000,
    );
    expect(request).toBe('{"v":1}\n');

    // The pairing device gets no workspace folder.
    const status = await a.transport.status();
    expect(status).toEqual([]);

    await writeFile(join(pathA, "response.json"), '{"v":1,"approved":true}\n');
    await a.transport.scanPairingFolder(PAIR);
    await waitFor(() => readFile(join(pathB, "response.json"), "utf8").catch(() => null), 60_000);
  }, 180_000);

  it("shares the workspace folders after setPeers, and removes the device after an empty list", async () => {
    await a.transport.setPeers([
      { device: "ubuntu-01", sync_id: b.transport.syncId!, role: "remote", addresses: ["dynamic"] },
    ]);
    await b.transport.setPeers([
      {
        device: "macbook-pro",
        sync_id: a.transport.syncId!,
        role: "local",
        addresses: [`tcp://127.0.0.1:${a.port}`, "dynamic"],
      },
    ]);
    await a.transport.removePairingFolder(PAIR);
    await b.transport.removePairingFolder(PAIR);
    await a.transport.removePairingDevice(b.transport.syncId!);
    await b.transport.removePairingDevice(a.transport.syncId!);
    const peer = await waitFor(async () => {
      const [first] = await a.transport.status();
      return first?.connected ? first : null;
    }, 60_000);
    expect(peer.folders!.map((f) => f.kind).sort()).toEqual(["knowledge", "secure", "tasks"]);
    await expect(stat(join(a.home, "sync-peers.json"))).rejects.toThrow(/ENOENT/);

    await a.transport.setPeers([]);
    expect(await a.transport.status()).toEqual([]);
    const config = await readFile(join(a.home, "sync", "config.xml"), "utf8");
    await waitFor(
      async () =>
        !(await readFile(join(a.home, "sync", "config.xml"), "utf8")).includes(b.transport.syncId!),
    );
    expect(config.length).toBeGreaterThan(0);
  }, 120_000);
});
