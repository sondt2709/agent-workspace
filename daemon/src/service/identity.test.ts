// Identity, device records, credentials, the phone outbox and the revoke (openspec
// add-identity-and-pairing: device-identity, credentials) with a real awd and the pinned engine.
import { systemClock } from "@aw/core";
import {
  decodePairingCode,
  encodePairingCode,
  fromBase64,
  masterFromPhrase,
  newDeviceKey,
  open,
  openText,
  recipientOf,
  seal,
  sealCredential,
  signRecord,
  verifyRecord,
  type DeviceKey,
} from "@aw/identity";
import { ensureTestEngine } from "@aw/sync-syncthing/testing";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { parse, stringify } from "yaml";
import { createLogger } from "../log.ts";
import { writeCredentialFiles } from "../loop/credentials.ts";
import { loadSettings } from "../settings.ts";
import { otherDevice, startTestDaemon, waitFor, type TestDaemon } from "../testing.ts";
import { IdentityService } from "./identity.ts";

// A test value: it must never be in a file outside secure/ (encrypted) and the keystore.
const SECRET = "sk_test_identity_4f9a2c71e0";

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

/** Each file under a folder, with its bytes. */
async function allFiles(root: string): Promise<{ path: string; bytes: Buffer }[]> {
  const out: { path: string; bytes: Buffer }[] = [];
  const names = await readdir(root, { recursive: true });
  for (const name of names) {
    const path = join(root, name);
    // The engine writes and removes its temp files at any time: skip a file that is gone.
    const info = await stat(path).catch(() => null);
    const bytes = info?.isFile() ? await readFile(path).catch(() => null) : null;
    if (bytes) out.push({ path: name, bytes });
  }
  return out;
}

/** A sync id with valid check characters, as the engine makes them (one fixed test value). */
const UBUNTU_SYNC_ID = "CLYYKI3-6JVFTIF-CRK4YG6-AE5MVQQ-C2JKFAK-CS45ZZF-4RQXQCT-GNZA4QG";
const PIXEL_SYNC_ID = "MWAQSX5-ZFSDHGU-35OVA2B-KC7KOTN-6WWXH2J-T652RXX-EB32OIJ-N5QZ2A5";
const LAB_SYNC_ID = "UJZDEGX-DNCF32H-EPF3DHO-DZDOCIE-S2JHTLG-MXGEDNB-73U55XT-PLPFT7K";
const EDGE_SYNC_ID = "5NRSCRM-EBSEQFK-QNF5TAK-VWPOCL5-ZSWAWL3-RGEZFBQ-4Z53HNX-4RPKHQV";

let daemon: TestDaemon;
let master: ReturnType<typeof masterFromPhrase>;
let ws: string;

/** Writes a record that the master key signed, as if it arrived by sync. */
async function writeRecord(fields: Record<string, unknown>): Promise<void> {
  const record = signRecord(fields, master.secret);
  const dir = join(daemon.folder, "tasks", "devices", String(fields.slug));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "device.yaml"), stringify(record));
}

function recordOf(slug: string, role: string, key: DeviceKey, syncId: string) {
  return {
    kind: "device",
    schema: 1,
    slug,
    name: slug,
    role,
    keys: { ed25519: key.ed25519, x25519: key.x25519 },
    sync_device_id: syncId,
    seq: 1,
    revoked: false,
    revoked_at: null,
    addresses: ["tcp://127.0.0.1:1"],
    paired_at: "2026-11-23T08:00:00.000Z",
  };
}

const service = () => daemon.server.daemon.workspace();

beforeAll(async () => {
  daemon = await startTestDaemon({
    workspace: true,
    env: {
      AW_SYNC_ENGINE: await ensureTestEngine(),
      AW_SYNC_LISTEN: `tcp://127.0.0.1:${await freePort()}`,
      AW_SYNC_COMMUNITY: "off",
    },
  });
  await daemon.server.daemon.syncStarted;
  ws = service().id;
  await waitFor(
    () =>
      service()
        .deviceRecords()
        .some((r) => r.slug === "macbook-pro"),
    20_000,
  );
  master = masterFromPhrase(await daemon.server.daemon.identity.phrase());
}, 60_000);

afterAll(async () => {
  await daemon?.close();
}, 30_000);

describe("identity of the local device", () => {
  it("makes the device key, the master key, the own signed record and the credential key", async () => {
    const show = await daemon.aw(["identity", "show", "--json"]);
    expect(show.code).toBe(0);
    const identity = JSON.parse(show.stdout) as Record<string, unknown>;
    expect(identity).toMatchObject({ has_master_key: true, keystore: "file", user: master.user });

    const text = await readFile(
      join(daemon.folder, "tasks/devices/macbook-pro/device.yaml"),
      "utf8",
    );
    const raw = parse(text) as Record<string, unknown>;
    expect(verifyRecord(raw, master.public)).toBe(true);
    expect(raw).toMatchObject({ slug: "macbook-pro", role: "local", seq: 1, revoked: false });
    expect(raw.sync_device_id).toBe(daemon.server.daemon.sync.transport!.syncId);

    expect((await stat(join(daemon.home, "keys", "device"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(daemon.home, "keys"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(daemon.home, "identity.yaml"))).mode & 0o777).toBe(0o600);
    const sealed = await readFile(join(daemon.folder, "secure/keys/macbook-pro.age"));
    const key = await openText(sealed, daemon.server.daemon.identity.device.secret.x25519);
    expect(key.startsWith("AGE-SECRET-KEY-1")).toBe(true);

    const phrase = await daemon.aw(["identity", "phrase"]);
    expect(phrase.stdout.split("\n")[0]!.split(" ")).toHaveLength(24);
    const list = await daemon.aw(["device", "list"]);
    expect(list.stdout).toMatch(/^macbook-pro \(this device\) {2}local {2}valid {2}seq 1/);
  });

  it("keeps the last valid record when another device changes a signed record", async () => {
    // A device with no master key cannot write a record again: the changed record stays a sync
    // problem. The test daemon has the master key, so its restore step is off for this part.
    const noMaster = vi.spyOn(daemon.server.daemon.identity, "hasMaster", "get");
    noMaster.mockReturnValue(false);
    onTestFinished(() => noMaster.mockRestore());
    const key = await newDeviceKey();
    await writeRecord(recordOf("mac-mini-lab", "remote", key, LAB_SYNC_ID));
    await service().refresh();
    expect(
      service()
        .deviceRecords()
        .find((r) => r.slug === "mac-mini-lab")?.role,
    ).toBe("remote");
    const path = join(daemon.folder, "tasks/devices/mac-mini-lab/device.yaml");
    const changed = { ...(parse(await readFile(path, "utf8")) as object), role: "local" };
    await writeFile(path, stringify(changed));
    await service().refresh();
    expect(
      service()
        .deviceRecords()
        .find((r) => r.slug === "mac-mini-lab")?.role,
    ).toBe("remote");
    expect(service().view.issues).toContainEqual(
      expect.objectContaining({
        path: "tasks/devices/mac-mini-lab/device.yaml",
        reason: "bad_signature",
      }),
    );
    // The peer comes from the last valid record.
    await waitFor(
      async () =>
        (await daemon.server.daemon.sync.transport!.status()).some(
          (p) => p.device === "mac-mini-lab",
        ),
      10_000,
    );
    // The change is a sync problem in the device list, and the old record stays in use.
    expect((await daemon.aw(["device", "list"])).stdout).toMatch(
      /mac-mini-lab {2}remote {2}bad_signature/,
    );

    // The device with the master key writes the last valid record again (devices.ts
    // restoreRecords). Before kb-1 this restore raced the device list above.
    noMaster.mockRestore();
    await daemon.server.daemon.devices.reconcile(service());
    const raw = parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect(raw.role).toBe("remote");
    expect(verifyRecord(raw, master.public)).toBe(true);
    await service().refresh();
    expect(service().view.issues.some((i) => i.path?.endsWith("mac-mini-lab/device.yaml"))).toBe(
      false,
    );
    expect((await daemon.aw(["device", "list"])).stdout).toMatch(/mac-mini-lab {2}remote {2}valid/);
  });
});

describe("identity start", () => {
  it("repairs identity.yaml when the keystore has the phrase and the file has no user", async () => {
    const home = await mkdtemp(join(tmpdir(), "aw-repair-"));
    onTestFinished(() => rm(home, { recursive: true, force: true }));
    const settings = loadSettings({ AW_HOME: home, HOME: home, AW_KEYSTORE: "file" });
    const first = new IdentityService({ settings, log: createLogger("silent") });
    await first.load();
    await first.createMaster();
    const user = first.user;
    // A stop between the keystore write and the identity.yaml write.
    await writeFile(
      join(home, "identity.yaml"),
      stringify({ kind: "aw-identity", schema: 1, user: null, master_public: null }),
    );
    const again = new IdentityService({ settings, log: createLogger("silent") });
    await again.load();
    expect(again.user).toBe(user);
    expect(again.hasMaster).toBe(true);
    expect(parse(await readFile(join(home, "identity.yaml"), "utf8"))).toMatchObject({ user });
  });
});

describe("credentials", () => {
  it("adds a value from stdin, lists the name, gives the value, and redacts it", async () => {
    const add = await daemon.aw(["credential", "add", "stripe-test"], {
      stdin: () => Promise.resolve(`${SECRET}\n`),
    });
    expect(add.code).toBe(0);
    expect((await daemon.aw(["credential", "list"])).stdout).toMatch(
      /^stripe-test {2}added on macbook-pro/,
    );
    const get = await daemon.aw(["credential", "get", "stripe-test"]);
    expect(get.stdout).toBe(`${SECRET}\n`);

    const task = await daemon.client.createTask("-", {
      project: "billing-api",
      title: "Use the key",
      first_message: `Run the tests with STRIPE_KEY=${SECRET}`,
    });
    expect(task.task.first_message).toContain("[redacted:stripe-test]");
    const kb = await daemon.aw(["kb", "write", "shared/notes.md", "--file", "-"], {
      stdin: () => Promise.resolve(`The test key is ${SECRET}.\n`),
    });
    expect(kb.code).toBe(0);
    expect(await readFile(join(daemon.folder, "knowledge/shared/notes.md"), "utf8")).toContain(
      "[redacted:stripe-test]",
    );

    // The value is nowhere in clear text: not in the workspace folder, the state folder (also
    // the logs and the index), the log lines of awd.
    const files = [...(await allFiles(daemon.folder)), ...(await allFiles(daemon.home))];
    const leaks = files.filter((f) => f.bytes.includes(SECRET)).map((f) => f.path);
    expect(leaks).toEqual([]);
    expect(JSON.stringify(daemon.logLines())).not.toContain(SECRET);
  });

  it("keeps a value for the redaction while its file does not open (a half-synced rotation)", async () => {
    const credentials = daemon.server.daemon.credentials;
    const count = await credentials.refreshSecrets(service());
    expect(count).toBeGreaterThanOrEqual(1);
    const path = join(daemon.folder, "secure/credentials/stripe-test.age");
    const good = await readFile(path);
    // The file of another credential key arrives before the key file of this device.
    await writeFile(path, await seal(SECRET, [(await newDeviceKey()).recipient]));
    try {
      expect(await credentials.refreshSecrets(service())).toBe(count);
      const task = await daemon.client.createTask("-", {
        project: "billing-api",
        title: "Half rotation",
        first_message: `Key ${SECRET}`,
      });
      expect(task.task.first_message).toContain("[redacted:stripe-test]");
      const get = await daemon.aw(["credential", "get", "stripe-test"]);
      expect(get.code).toBe(1);
      expect(get.stderr).toContain("does not open");
    } finally {
      await writeFile(path, good);
    }
  });

  it("refuses a value in an argument and a bad name", async () => {
    const extra = await daemon.aw(["credential", "add", "x-key", SECRET]);
    expect(extra.code).toBe(2);
    const bad = await daemon.aw(["credential", "add", "Bad Name"], {
      stdin: () => Promise.resolve("v"),
    });
    expect(bad.code).toBe(2);
  });

  it("imports a sealed file of a phone once, with the sealed id", async () => {
    const phone = await newDeviceKey();
    await writeRecord(recordOf("pixel-9", "mobile", phone, PIXEL_SYNC_ID));
    await service().refresh();
    const files = otherDevice(daemon.folder, "pixel-9", { role: "mobile" });
    const id = files.newId();
    const computer = daemon.server.daemon.identity.device.recipient;
    await files.writeFile(
      `tasks/devices/pixel-9/sealed/${id}.age`,
      await sealCredential("github-token", "ghp_phone_value_91c3", [computer]),
    );
    // A file with an id that the event schema refuses, and a file with a name that is too long:
    // both are skipped, and they never stop the import of the good file.
    const outbox = join(daemon.folder, "tasks/devices/pixel-9/sealed");
    await writeFile(
      join(outbox, "Bad_Name.age"),
      await sealCredential("bad-id", "v_bad_id_1", [computer]),
    );
    const longId = files.newId();
    await files.writeFile(
      `tasks/devices/pixel-9/sealed/${longId}.age`,
      await sealCredential("x".repeat(70), "v_long_name_1", [computer]),
    );
    const credentials = daemon.server.daemon.credentials;
    expect(await credentials.importSealed(service())).toEqual(["github-token"]);
    expect(await credentials.importSealed(service())).toEqual([]);
    expect((await readdir(join(daemon.folder, "secure/credentials"))).sort()).not.toContain(
      `${"x".repeat(70)}.age`,
    );
    expect(await readdir(join(daemon.folder, "secure/credentials"))).not.toContain("bad-id.age");
    await rm(join(outbox, "Bad_Name.age"));
    await rm(join(outbox, `${longId}.age`));
    const row = service()
      .workspaceEvents()
      .find((r) => r.type === "credential.imported");
    expect(row?.event).toMatchObject({
      data: { name: "github-token", from: "pixel-9", sealed: id },
    });
    expect((await daemon.aw(["credential", "get", "github-token"])).stdout).toBe(
      "ghp_phone_value_91c3\n",
    );
    expect((await daemon.aw(["credential", "list"])).stdout).toContain(
      "github-token  imported on macbook-pro",
    );
  });

  it("removes a credential file and writes credential.removed", async () => {
    await daemon.aw(["credential", "add", "temp-key"], { stdin: () => Promise.resolve("v123") });
    expect((await daemon.aw(["credential", "remove", "temp-key"])).code).toBe(0);
    await expect(stat(join(daemon.folder, "secure/credentials/temp-key.age"))).rejects.toThrow(
      /ENOENT/,
    );
    expect((await daemon.aw(["credential", "get", "temp-key"])).code).toBe(2);
  });
});

describe("credentials of a session start (task-loop)", () => {
  it("gives the values that open as 0600 files, names a missing one, and keeps a given value in the redaction", async () => {
    const credentials = daemon.server.daemon.credentials;
    const GIVEN = "sk_test_session_9090";
    const add = await daemon.aw(["credential", "add", "session-key"], {
      stdin: () => Promise.resolve(`${GIVEN}\n`),
    });
    expect(add.code).toBe(0);
    const values = await credentials.sessionValues(service(), [
      "session-key",
      "no-such-key",
      "session-key",
    ]);
    expect([...values]).toEqual([["session-key", GIVEN]]);
    const root = await mkdtemp(join(tmpdir(), "aw-cred-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const dir = join(root, "credentials");
    const names = ["session-key", "no-such-key"];
    expect(await writeCredentialFiles(dir, names, values)).toEqual(["no-such-key"]);
    expect(await readdir(dir)).toEqual(["session-key"]);
    expect(await readFile(join(dir, "session-key"), "utf8")).toBe(GIVEN);
    expect((await stat(join(dir, "session-key"))).mode & 0o777).toBe(0o600);
    const missing = daemon
      .logLines()
      .find((l) => l.msg === "A credential of a session has no value on this device");
    expect(missing).toMatchObject({ credential: "no-such-key", reason: "not_found" });

    // The session file can keep the old value: after a remove, the redaction still has it.
    expect((await daemon.aw(["credential", "remove", "session-key"])).code).toBe(0);
    await credentials.refreshSecrets(service());
    const task = await daemon.client.createTask("-", {
      project: "billing-api",
      title: "Old key",
      first_message: `Key ${GIVEN}`,
    });
    expect(task.task.first_message).toBe("Key [redacted:session-key]");
    expect(JSON.stringify(daemon.logLines())).not.toContain(GIVEN);
  });
});

describe("revoke", () => {
  it("revokes ubuntu-01: a signed record, the peer removed, a new key, later events ignored", async () => {
    const ubuntu = await newDeviceKey();
    await writeRecord(recordOf("ubuntu-01", "remote", ubuntu, UBUNTU_SYNC_ID));
    await service().refresh();
    const record = service()
      .deviceRecords()
      .find((r) => r.slug === "ubuntu-01")!;
    await daemon.server.daemon.credentials.sealKeyTo(service(), record);
    const oldKey = await openText(
      await readFile(join(daemon.folder, "secure/keys/ubuntu-01.age")),
      ubuntu.secret.x25519,
    );
    const engine = daemon.server.daemon.sync.transport!;
    await waitFor(
      async () => (await engine.status()).some((p) => p.device === "ubuntu-01"),
      10_000,
    );

    // A task with a comment of ubuntu-01 before the revoke.
    const task = await daemon.client.createTask("-", {
      project: "billing-api",
      title: "Revoke test",
      first_message: "x",
    });
    const remote = otherDevice(daemon.folder, "ubuntu-01", { clock: systemClock });
    const log = `tasks/${task.task.id}/log/ubuntu-01.jsonl`;
    await remote.writeEvent(log, "comment.added", { text: "before" }, { task: task.task.id });

    const recordPath = join(daemon.folder, "tasks/devices/ubuntu-01/device.yaml");
    const validText = await readFile(recordPath, "utf8");
    // A credential file that does not open here (another key): the revoke names it.
    const lostPath = join(daemon.folder, "secure/credentials/lost-key.age");
    await writeFile(lostPath, await seal("v_lost_1", [(await newDeviceKey()).recipient]));
    const revoke = await daemon.aw(["device", "revoke", "ubuntu-01"]);
    expect(revoke.code).toBe(0);
    expect(revoke.stdout).toMatch(/Revoked ubuntu-01 \(seq 2\)\. 2 credentials use a new key/);
    expect(revoke.stdout).toContain("keep the old key: lost-key");
    // No engine runs in this test, so ubuntu-01 never confirms its record.
    expect(revoke.stdout).toContain(
      "ubuntu-01 did not get the revoke, so its agent sessions continue. Stop them on that device",
    );
    await rm(lostPath);

    // A file that another computer wrote with the old key during the revoke: the device with the
    // master key opens it with the old key and writes it again with the new key.
    const latePath = join(daemon.folder, "secure/credentials/late-key.age");
    await writeFile(latePath, await seal("v_late_1", [await recipientOf(oldKey)]));
    await daemon.server.daemon.credentials.refreshSecrets(service());
    await expect(open(await readFile(latePath), oldKey)).rejects.toThrow();
    expect((await daemon.aw(["credential", "get", "late-key"])).stdout).toBe("v_late_1\n");
    await rm(latePath);
    const raw = parse(
      await readFile(join(daemon.folder, "tasks/devices/ubuntu-01/device.yaml"), "utf8"),
    ) as Record<string, unknown>;
    expect(verifyRecord(raw, master.public)).toBe(true);
    expect(raw).toMatchObject({ revoked: true, seq: 2 });

    // The engine has no device ubuntu-01.
    await waitFor(
      async () => !(await engine.status()).some((p) => p.device === "ubuntu-01"),
      10_000,
    );
    // The credentials open with the new key, not with the key that ubuntu-01 has.
    const file = await readFile(join(daemon.folder, "secure/credentials/stripe-test.age"));
    await expect(open(file, oldKey)).rejects.toThrow();
    expect((await daemon.aw(["credential", "get", "stripe-test"])).stdout).toBe(`${SECRET}\n`);

    // A later event of ubuntu-01 does not count.
    remote.hlc.observe(String(raw.revoked_at));
    await remote.writeEvent(log, "comment.added", { text: "after" }, { task: task.task.id });
    await service().refresh();
    const thread = await daemon.client.thread("-", task.task.id);
    const comments = thread.events.filter((e) => e.type === "comment.added");
    expect(comments.map((c) => [c.applied, c.reason])).toEqual([
      [true, null],
      [false, "device_revoked"],
    ]);
    expect((await daemon.aw(["device", "list"])).stdout).toMatch(
      /ubuntu-01 {2}remote {2}revoked {2}seq 2/,
    );
    expect((await daemon.aw(["device", "revoke", "macbook-pro"])).code).toBe(2);

    // The revoked device removes the revoke file, then writes its old valid record (seq 1) back:
    // the revoke stays, and the device with the master key writes the revoke record again.
    const revokedText = await readFile(recordPath, "utf8");
    const restored = async () => {
      await service().refresh();
      return (await readFile(recordPath, "utf8").catch(() => null)) === revokedText;
    };
    await rm(recordPath);
    await service().refresh();
    expect(
      service()
        .deviceRecords()
        .find((r) => r.slug === "ubuntu-01"),
    ).toMatchObject({
      revoked: true,
      seq: 2,
    });
    await waitFor(restored, 10_000);
    await writeFile(recordPath, validText);
    await service().refresh();
    expect(
      service()
        .deviceRecords()
        .find((r) => r.slug === "ubuntu-01"),
    ).toMatchObject({
      revoked: true,
      seq: 2,
    });
    await waitFor(restored, 10_000);
    await remote.writeEvent(log, "comment.added", { text: "after replay" }, { task: task.task.id });
    await service().refresh();
    const again = await daemon.client.thread("-", task.task.id);
    expect(again.events.filter((e) => e.type === "comment.added").map((c) => c.applied)).toEqual([
      true,
      false,
      false,
    ]);
    // 3 s later the engine still has no device ubuntu-01.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect((await engine.status()).some((p) => p.device === "ubuntu-01")).toBe(false);
  }, 20_000);
});

describe("pairing code", () => {
  it("refuses an expired code and a device without the master key", async () => {
    const start = await daemon.aw(["device", "add", "--no-wait", "--json"]);
    expect(start.code).toBe(0);
    const started = JSON.parse(start.stdout) as { id: string; code: string; qr_svg: string };
    expect(started.qr_svg.startsWith("<svg")).toBe(true);
    const offer = decodePairingCode(started.code);
    expect(offer).toMatchObject({ workspace: { id: ws }, device: { slug: "macbook-pro" } });
    expect(fromBase64(offer.master)).toEqual(master.public);
    const expired = encodePairingCode({ ...offer, expires: "2026-01-01T00:00:00.000Z" });
    const join = await daemon.aw(["pair", expired]);
    expect(join.code).toBe(2);
    expect(join.stderr).toContain("expired");
    // This device has the master key: it cannot join another identity.
    const own = await daemon.aw(["pair", started.code, "--no-wait"]);
    expect(own.code).toBe(1);
    expect((await daemon.aw(["device", "cancel", started.id])).code).toBe(0);
  });
});

// Last: a second workspace makes the default workspace selection ambiguous for the tests above.
describe("more than one workspace", () => {
  it("never makes a device a peer again when one workspace revokes it", async () => {
    const first = service();
    const beta = await mkdtemp(join(tmpdir(), "aw-beta-"));
    onTestFinished(() => rm(beta, { recursive: true, force: true }));
    const init = await daemon.client.initWorkspace({ path: beta, name: "beta" });
    const second = daemon.server.daemon.workspace(init.workspace.id);
    await waitFor(() => second.ready, 10_000);
    const edge = await newDeviceKey();
    const write = async (root: string, fields: Record<string, unknown>) => {
      const dir = join(root, "tasks", "devices", "edge-01");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "device.yaml"), stringify(signRecord(fields, master.secret)));
    };
    // Each workspace has its own seq: seq 3 in the first, seq 1 then a revoke (seq 2) in beta.
    await write(first.root, { ...recordOf("edge-01", "remote", edge, EDGE_SYNC_ID), seq: 3 });
    await write(second.root, recordOf("edge-01", "remote", edge, EDGE_SYNC_ID));
    await first.refresh();
    await second.refresh();
    const engine = daemon.server.daemon.sync.transport!;
    await daemon.server.daemon.devices.refreshPeers();
    expect(engine.peers.map((p) => p.device)).toContain("edge-01");
    // The own credential key file of beta is missing: no credential opens, so the revoke names
    // each credential file as closed (it never says 0 credentials and nothing closed).
    await rm(join(second.root, "secure/keys/macbook-pro.age"));
    await mkdir(join(second.root, "secure/credentials"), { recursive: true });
    await writeFile(
      join(second.root, "secure/credentials/orphan.age"),
      await seal("v_orphan_1", [(await newDeviceKey()).recipient]),
    );
    const revoked = await daemon.server.daemon.devices.revoke(second, "edge-01");
    expect(revoked).toMatchObject({ credentials: 0, closed: ["orphan"] });
    await daemon.server.daemon.devices.refreshPeers();
    expect(engine.peers.map((p) => p.device)).not.toContain("edge-01");
    await waitFor(async () => !(await engine.status()).some((p) => p.device === "edge-01"), 10_000);
  });
});
