// The revoke reaches the revoked device before its peer goes (openspec revoke-device): awd keeps
// the device as a peer while the engine delivers the new record, at most REVOKE_DELIVERY_MS.
import { systemClock } from "@aw/core";
import type { PeerRecord } from "@aw/plugin-api";
import type { DeviceDocument } from "@aw/schema";
import { describe, expect, it } from "vitest";
import { createLogger } from "../log.ts";
import type { CredentialService } from "./credentials.ts";
import { DeviceService, REVOKE_DELIVERY_MS } from "./devices.ts";
import type { IdentityService } from "./identity.ts";
import type { SyncService } from "./sync.ts";
import type { WorkspaceService } from "./workspace.ts";

const UBUNTU_SYNC_ID = "CLYYKI3-6JVFTIF-CRK4YG6-AE5MVQQ-C2JKFAK-CS45ZZF-4RQXQCT-GNZA4QG";
const LAB_SYNC_ID = "UJZDEGX-DNCF32H-EPF3DHO-DZDOCIE-S2JHTLG-MXGEDNB-73U55XT-PLPFT7K";

function record(slug: string, syncId: string, key: string): DeviceDocument {
  return {
    kind: "device",
    schema: 1,
    slug,
    name: slug,
    role: "remote",
    keys: { ed25519: key, x25519: key },
    sync_device_id: syncId,
    seq: 1,
    revoked: false,
    revoked_at: null,
    addresses: [],
    paired_at: "2026-11-23T08:00:00.000Z",
    signature: "c2ln",
  };
}

interface Delivery {
  device: string;
  workspace: string;
  path: string;
  timeoutMs: number;
  peersAtStart: string[];
  finish(delivered: boolean): void;
}

function setup(
  options: {
    /** The cached records of a workspace that is not open (a join in progress). */
    cached?: Record<string, DeviceDocument[]>;
    waitDelivered?: boolean;
    others?: WorkspaceService[];
    rotate?: (devices: DeviceService) => Promise<{ count: number; closed: string[] }>;
  } = {},
) {
  let records = [
    record("ubuntu-01", UBUNTU_SYNC_ID, "dWJ1bnR1"),
    record("mac-mini-lab", LAB_SYNC_ID, "bGFi"),
  ];
  const peerCalls: string[][] = [];
  const deliveries: Delivery[] = [];
  const service = {
    id: "ws-1",
    ready: true,
    root: "/nowhere",
    deviceRecords: () => records,
    write: async (run: (files: unknown) => Promise<unknown>) =>
      run({
        hlc: { now: () => "2026-11-23T10:00:00.000Z#0001" },
        writeDocument: (_path: string, doc: DeviceDocument) => {
          records = [...records.filter((r) => r.slug !== doc.slug), doc];
          return Promise.resolve();
        },
      }),
  } as unknown as WorkspaceService;
  const identity = {
    hasMaster: true,
    masterPublic: "bWFzdGVy",
    device: { ed25519: "bWU=" },
    sign: (fields: Record<string, unknown>) => ({ ...fields, signature: "c2ln" }),
    revokeFields: (r: DeviceDocument, at: string) => ({
      ...r,
      seq: r.seq + 1,
      revoked: true,
      revoked_at: at,
    }),
    cachedRecords: (ws: string) => Promise.resolve(options.cached?.[ws] ?? []),
  } as unknown as IdentityService;
  const credentials = {
    rotate: () =>
      options.rotate ? options.rotate(devices) : Promise.resolve({ count: 0, closed: [] }),
  } as unknown as CredentialService;
  const sync = {
    setPeers: (peers: PeerRecord[]) => {
      peerCalls.push(peers.map((p) => p.device));
      return Promise.resolve();
    },
    ...(options.waitDelivered === false
      ? // No running engine: SyncService answers false at once.
        { waitDelivered: () => Promise.resolve(false) }
      : {
          waitDelivered: (device: string, workspace: string, path: string, timeoutMs: number) =>
            new Promise<boolean>((resolve) => {
              deliveries.push({
                device,
                workspace,
                path,
                timeoutMs,
                peersAtStart: peerCalls.at(-1) ?? [],
                finish: resolve,
              });
            }),
        }),
  } as unknown as SyncService;
  const devices = new DeviceService({
    identity,
    credentials,
    sync: () => sync,
    clock: systemClock,
    log: createLogger("silent"),
    device: () => ({ slug: "macbook-pro", name: "MacBook Pro", role: "local" }),
    workspaces: () => [service, ...(options.others ?? [])],
    setDevice: () => Promise.resolve(),
  });
  return { devices, service, peerCalls, deliveries };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

describe("revoke delivery", () => {
  it("keeps the revoked device as a peer until the engine delivers its record, then drops it", async () => {
    const { devices, service, peerCalls, deliveries } = setup();
    let done = false;
    const revoke = devices.revoke(service, "ubuntu-01").then((r) => {
      done = true;
      return r;
    });
    await until(() => deliveries.length === 1);
    expect(deliveries[0]).toMatchObject({
      device: UBUNTU_SYNC_ID,
      workspace: "ws-1",
      path: "tasks/devices/ubuntu-01/device.yaml",
      timeoutMs: REVOKE_DELIVERY_MS,
      peersAtStart: ["mac-mini-lab", "ubuntu-01"],
    });
    expect(REVOKE_DELIVERY_MS).toBe(10_000);
    // A refresh during the wait (a document change) keeps the peer.
    await devices.refreshPeers();
    expect(peerCalls.at(-1)).toEqual(["mac-mini-lab", "ubuntu-01"]);
    expect(done).toBe(false);
    deliveries[0]!.finish(true);
    const result = await revoke;
    expect(result.record).toMatchObject({ slug: "ubuntu-01", revoked: true, seq: 2 });
    expect(peerCalls.at(-1)).toEqual(["mac-mini-lab"]);
    await devices.refreshPeers();
    expect(peerCalls.at(-1)).toEqual(["mac-mini-lab"]);
  });

  it("waits for no delivery to a device that another workspace revoked before", async () => {
    const other = {
      id: "ws-2",
      ready: true,
      deviceRecords: () => [
        { ...record("ubuntu-01", UBUNTU_SYNC_ID, "dWJ1bnR1"), revoked: true, seq: 2 },
      ],
    } as unknown as WorkspaceService;
    const { devices, service, peerCalls, deliveries } = setup({ others: [other] });
    await devices.revoke(service, "ubuntu-01");
    expect(deliveries).toEqual([]);
    expect(peerCalls.every((call) => !call.includes("ubuntu-01"))).toBe(true);
  });

  it("waits for no delivery to a device that a workspace in a join revoked (low 1)", async () => {
    const revoked = { ...record("ubuntu-01", UBUNTU_SYNC_ID, "dWJ1bnR1"), revoked: true, seq: 2 };
    const { devices, service, peerCalls, deliveries } = setup({ cached: { "ws-join": [revoked] } });
    await devices.refreshPeers(["ws-join"]);
    await devices.revoke(service, "ubuntu-01");
    expect(deliveries).toEqual([]);
    expect(peerCalls.every((call) => !call.includes("ubuntu-01"))).toBe(true);
  });

  it("drops the peer also when the delivery fails", async () => {
    const { devices, service, peerCalls, deliveries } = setup();
    const revoke = devices.revoke(service, "ubuntu-01");
    await until(() => deliveries.length === 1);
    deliveries[0]!.finish(false);
    await revoke;
    expect(peerCalls.at(-1)).toEqual(["mac-mini-lab"]);
  });

  it("drops the peer at once when no engine runs", async () => {
    const { devices, service, peerCalls } = setup({ waitDelivered: false });
    await devices.revoke(service, "ubuntu-01");
    expect(peerCalls.at(-1)).toEqual(["mac-mini-lab"]);
  });

  it("drops the peer when the credential rotation fails after the record write", async () => {
    const { devices, service, peerCalls } = setup({
      // The record write starts a reconcile: its peer refresh keeps the device (it is in the
      // delivery set). Then the rotation fails, for example on a full disk.
      rotate: async (d) => {
        await d.refreshPeers();
        throw new Error("ENOSPC: no space left on device");
      },
    });
    await expect(devices.revoke(service, "ubuntu-01")).rejects.toThrow("ENOSPC");
    expect(peerCalls.at(-1)).toEqual(["mac-mini-lab"]);
  });

  it("tells whether the revoked device got its record", async () => {
    const online = setup();
    const revoke = online.devices.revoke(online.service, "ubuntu-01");
    await until(() => online.deliveries.length === 1);
    online.deliveries[0]!.finish(true);
    expect((await revoke).delivered).toBe(true);
    const offline = setup({ waitDelivered: false });
    expect((await offline.devices.revoke(offline.service, "ubuntu-01")).delivered).toBe(false);
  });
});
