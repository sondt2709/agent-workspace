// The push service of the gate owner (add-task-loop decision 13): the key file, the subscriptions of
// push.yaml for this computer and its current key, and the send with a fake push service.
import type { FetchLike } from "@aw/push-webpush";
import type { DeviceDocument } from "@aw/schema";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger } from "../log.ts";
import type { WorkspaceService } from "../service/workspace.ts";
import { loadVapidKeys, PushService } from "./push.ts";

const UA_KEY =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";

function pushYaml(entries: { computer: string; key: string; endpoint: string }[]): string {
  return [
    "kind: push",
    "schema: 1",
    'device: "pixel-9"',
    "subscriptions:",
    ...entries.flatMap((e) => [
      `  - computer: "${e.computer}"`,
      `    endpoint: "${e.endpoint}"`,
      `    p256dh: "${UA_KEY}"`,
      '    auth: "BTBZMqHH6r4Tts7J_aSIgg"',
      `    vapid_public_key: "${e.key}"`,
      "    distributor: null",
      '    updated: "2026-11-23T10:00:00.000Z"',
    ]),
    "",
  ].join("\n");
}

const PHONE_ID = "MWAQSX5-ZFSDHGU-35OVA2B-KC7KOTN-6WWXH2J-T652RXX-EB32OIJ-N5QZ2A5";

function record(slug: string, fields: Partial<DeviceDocument> = {}): DeviceDocument {
  return {
    kind: "device",
    schema: 1,
    slug,
    name: slug,
    role: "mobile",
    keys: { ed25519: `${slug}-ed`, x25519: `${slug}-x` },
    sync_device_id: PHONE_ID,
    seq: 1,
    revoked: false,
    revoked_at: null,
    addresses: [],
    paired_at: "2026-11-23T08:00:00.000Z",
    signature: "c2ln",
    ...fields,
  };
}

function workspace(root: string, records: DeviceDocument[]): WorkspaceService {
  return {
    root,
    device: { slug: "macbook-pro", role: "local" },
    deviceRecords: () => records,
  } as unknown as WorkspaceService;
}

describe("push service", () => {
  it("keeps one VAPID key pair in keys/vapid.json with mode 0600", async () => {
    const home = await mkdtemp(join(tmpdir(), "aw-push-"));
    const keys = await loadVapidKeys(home);
    expect(keys.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    expect(await loadVapidKeys(home)).toEqual(keys);
    expect((await stat(join(home, "keys", "vapid.json"))).mode & 0o777).toBe(0o600);
  });

  it("sends only to the subscriptions of this computer with its current key", async () => {
    const home = await mkdtemp(join(tmpdir(), "aw-push-"));
    const root = await mkdtemp(join(tmpdir(), "aw-ws-"));
    const keys = await loadVapidKeys(home);
    await mkdir(join(root, "tasks", "devices", "pixel-9"), { recursive: true });
    await writeFile(
      join(root, "tasks", "devices", "pixel-9", "push.yaml"),
      pushYaml([
        { computer: "macbook-pro", key: keys.publicKey, endpoint: "https://push.example.test/a" },
        { computer: "macbook-pro", key: UA_KEY, endpoint: "https://push.example.test/old" },
        { computer: "ubuntu-01", key: keys.publicKey, endpoint: "https://push.example.test/b" },
      ]),
    );
    // A broken file of another phone is skipped.
    await mkdir(join(root, "tasks", "devices", "pixel-8"), { recursive: true });
    await writeFile(join(root, "tasks", "devices", "pixel-8", "push.yaml"), "kind: push\n");
    const urls: string[] = [];
    const auth: string[] = [];
    const fetch: FetchLike = (url, init) => {
      urls.push(url);
      auth.push(init.headers.Authorization ?? "");
      return Promise.resolve({ status: 201, text: () => Promise.resolve("") });
    };
    const service = workspace(root, [record("pixel-9"), record("pixel-8")]);
    const push = new PushService({
      home,
      log: createLogger("silent"),
      now: () => Date.now(),
      fetch,
    });
    const sent = await push.send(service, {
      event: null,
      task: "t",
      key: "AW-7",
      kind: "gate",
      gate_kind: "question",
      text: "Which limit?",
    });
    expect(sent).toBe(1);
    expect(urls).toEqual(["https://push.example.test/a"]);
    // The VAPID sub is always the fixed address: no setting names a person (owner decision Q9).
    const jwt = /^vapid t=([^,]+),/.exec(auth[0]!)![1]!;
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8")) as {
      sub: string;
    };
    expect(claims.sub).toBe("mailto:noreply@example.com");
    expect(await readFile(join(home, "keys", "vapid.json"), "utf8")).toContain(keys.publicKey);
  });

  describe("revoked phones (openspec revoke-device)", () => {
    async function setup() {
      const home = await mkdtemp(join(tmpdir(), "aw-push-"));
      const root = await mkdtemp(join(tmpdir(), "aw-ws-"));
      const keys = await loadVapidKeys(home);
      await mkdir(join(root, "tasks", "devices", "pixel-9"), { recursive: true });
      await writeFile(
        join(root, "tasks", "devices", "pixel-9", "push.yaml"),
        pushYaml([
          { computer: "macbook-pro", key: keys.publicKey, endpoint: "https://push.example.test/a" },
        ]),
      );
      return { home, root };
    }

    function push(home: string, others: () => WorkspaceService[] = () => []) {
      return new PushService({
        home,
        log: createLogger("silent"),
        now: () => Date.now(),
        workspaces: others,
      });
    }

    it("sends to a phone with a valid record", async () => {
      const { home, root } = await setup();
      const subs = await push(home).subscriptions(workspace(root, [record("pixel-9")]));
      expect(subs.map((s) => s.endpoint)).toEqual(["https://push.example.test/a"]);
    });

    it("sends nothing to a phone that this workspace revoked", async () => {
      const { home, root } = await setup();
      const revoked = record("pixel-9", {
        revoked: true,
        revoked_at: "2026-11-23T09:00:00.000Z#0000",
        seq: 2,
      });
      expect(await push(home).subscriptions(workspace(root, [revoked]))).toEqual([]);
    });

    it("sends nothing to a phone that another open workspace revoked", async () => {
      const { home, root } = await setup();
      const other = workspace(await mkdtemp(join(tmpdir(), "aw-ws-")), [
        record("pixel-9", { revoked: true, revoked_at: "2026-11-23T09:00:00.000Z#0000" }),
      ]);
      const service = workspace(root, [record("pixel-9")]);
      expect(await push(home, () => [service, other]).subscriptions(service)).toEqual([]);
      // The same sync id under another slug counts too.
      const renamed = workspace(await mkdtemp(join(tmpdir(), "aw-ws-")), [
        record("old-phone", { revoked: true, keys: { ed25519: "x", x25519: "y" } }),
      ]);
      expect(await push(home, () => [renamed]).subscriptions(service)).toEqual([]);
    });

    it("sends nothing to a push.yaml under the record of a computer", async () => {
      // A revoked phone plants its subscription under the folder of a valid computer record.
      const { home, root } = await setup();
      await mkdir(join(root, "tasks", "devices", "ubuntu-01"), { recursive: true });
      await writeFile(
        join(root, "tasks", "devices", "ubuntu-01", "push.yaml"),
        (await readFile(join(root, "tasks", "devices", "pixel-9", "push.yaml"), "utf8")).replace(
          'device: "pixel-9"',
          'device: "ubuntu-01"',
        ),
      );
      const revoked = record("pixel-9", { revoked: true, revoked_at: "2026-11-23T09:00:00Z#0000" });
      const computer = record("ubuntu-01", {
        role: "remote",
        sync_device_id: "CLYYKI3-6JVFTIF-CRK4YG6-AE5MVQQ-C2JKFAK-CS45ZZF-4RQXQCT-GNZA4QG",
      });
      expect(await push(home).subscriptions(workspace(root, [revoked, computer]))).toEqual([]);
    });

    it("sends nothing to a push.yaml with no device record", async () => {
      const { home, root } = await setup();
      expect(await push(home).subscriptions(workspace(root, [record("pixel-8")]))).toEqual([]);
    });
  });
});
