// The pairing test plan on 2 awd containers (e2e/compose.yaml; openspec add-identity-and-pairing).
// Run it with "task e2e". ubuntu-01 joins macbook-pro with a code only (no test peer). Each step
// writes one "EVIDENCE {json}" line to stdout.
import type { SyncStatusReply, ThreadReply } from "@aw/client";
import type { DeviceEntryView, IdentityView, PairingView } from "@aw/client/identity";
import { fromBase64, masterFromPhrase, signRecord, verifyRecord } from "@aw/identity";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import {
  aw,
  awJson,
  compose,
  copyBetween,
  exec,
  waitFor,
  WORKSPACE,
  type Device,
} from "./compose.ts";

const A: Device = "macbook-pro";
const B: Device = "ubuntu-01";
// A test value: it must never be in a file outside secure/ (encrypted) and the keystore.
const SECRET = "sk_test_docker_pairing_5be81d";
/** A valid engine device id for the simulated phone record (it never connects). */
const PHONE_SYNC_ID = "MWAQSX5-ZFSDHGU-35OVA2B-KC7KOTN-6WWXH2J-T652RXX-EB32OIJ-N5QZ2A5";

function evidence(step: string, data: Record<string, unknown>): void {
  process.stdout.write(`EVIDENCE ${JSON.stringify({ step, ...data })}\n`);
}

async function readFileIn(device: Device, path: string): Promise<string | null> {
  const result = await exec(device, ["cat", path]);
  return result.code === 0 ? result.stdout : null;
}

async function writeFileIn(device: Device, path: string, content: string): Promise<void> {
  const result = await exec(
    device,
    ["sh", "-c", 'mkdir -p "$(dirname "$1")" && cat > "$1"', "sh", path],
    content,
  );
  if (result.code !== 0) throw new Error(result.stderr);
}

/** The engine device ids that share a folder, from config.xml of a device. */
async function folderDevices(device: Device, folder: string): Promise<string[]> {
  const xml = (await readFileIn(device, "/aw/state/sync/config.xml")) ?? "";
  const start = xml.indexOf(`<folder id="${folder}"`);
  if (start < 0) return [];
  const block = xml.slice(start, xml.indexOf("</folder>", start));
  return [...block.matchAll(/<device id="([A-Z2-7-]{63})"/g)].map((m) => m[1]!);
}

async function engineDevices(device: Device): Promise<string[]> {
  const xml = (await readFileIn(device, "/aw/state/sync/config.xml")) ?? "";
  return [...xml.matchAll(/^\s*<device id="([A-Z2-7-]{63})" name=/gm)].map((m) => m[1]!);
}

const status = (device: Device) => awJson<SyncStatusReply>(device, ["sync", "status"]);

beforeAll(async () => {
  await compose(["down", "-v", "--remove-orphans"]);
  const up = await compose(["up", "-d", "--build"]);
  if (up.code !== 0) throw new Error(`docker compose up failed: ${up.stderr}`);
  for (const device of [A, B]) {
    await waitFor(
      async () => (await status(device)).engine === "running",
      60_000,
      `engine on ${device}`,
    );
  }
}, 600_000);

afterAll(async () => {
  await compose(["down", "-v", "--remove-orphans"]);
});

describe("pairing between 2 awd containers", () => {
  let ws: string;
  let idA: string;
  let idB: string;
  let masterPublic: Uint8Array;
  let task: string;

  it("1. pairs ubuntu-01 with a code only, and the sync starts", async () => {
    expect((await aw(A, ["workspace", "init", WORKSPACE, "--name", "demo"])).code).toBe(0);
    expect((await aw(A, ["project", "add", "demo-api"])).code).toBe(0);
    const add = await exec(A, ["aw", "credential", "add", "stripe-test"], `${SECRET}\n`);
    expect(add.code, add.stderr).toBe(0);
    const identityA = await awJson<IdentityView>(A, ["identity", "show"]);
    masterPublic = fromBase64(identityA.master_public!);
    [idA, idB] = [(await status(A)).sync_id!, (await status(B)).sync_id!];
    ws = (await awJson<{ id: string }[]>(A, ["workspace", "list"]))[0]!.id;
    await waitFor(
      async () =>
        (await readFileIn(A, `${WORKSPACE}/tasks/devices/macbook-pro/device.yaml`)) !== null,
      30_000,
      "the own record of A",
    );

    const started = Date.now();
    const offer = await awJson<PairingView>(A, ["device", "add", "--no-wait"]);
    const joined = await awJson<PairingView>(B, [
      "pair",
      offer.code!,
      "--path",
      WORKSPACE,
      "--no-wait",
    ]);
    // A waits for the request: the check code appears on both sides.
    const request = await waitFor(
      async () => {
        const result = await aw(A, ["--json", "device", "approve", offer.id, joined.check_code!]);
        return result.code === 0 ? (JSON.parse(result.stdout) as PairingView) : null;
      },
      60_000,
      "the request of ubuntu-01 and the approval",
      1000,
    );
    expect(request.state).toBe("approved");
    const approvedAfter = Date.now() - started;
    const done = await waitFor(
      async () => {
        const list = await aw(B, ["--json", "workspace", "list"]);
        if (list.code !== 0) return null;
        const spaces = JSON.parse(list.stdout) as { id: string; ready: boolean }[];
        return spaces.some((s) => s.id === ws && s.ready) ? spaces : null;
      },
      120_000,
      "the workspace registered on ubuntu-01",
    );
    expect(done.length).toBe(1);
    const connected = await waitFor(
      async () => (await status(A)).peers.find((p) => p.device === B && p.connected) ?? null,
      60_000,
      "A connected to B",
    );
    evidence("pairing", {
      approved_after_ms: approvedAfter,
      registered_after_ms: Date.now() - started,
      check_code: joined.check_code,
      peer: connected.text,
    });

    const created = await awJson<{ task: { id: string } }>(A, [
      "task",
      "create",
      "--project",
      "demo-api",
      "--title",
      "After pairing",
      "--first-message",
      "Run the tests.",
    ]);
    task = created.task.id;
    await waitFor(
      async () => (await aw(B, ["task", "show", task])).code === 0,
      60_000,
      "the task on ubuntu-01",
    );
  });

  it("2. both devices have both records with a valid master-key signature", async () => {
    for (const device of [A, B]) {
      for (const slug of [A, B]) {
        const text = await waitFor(
          () => readFileIn(device, `${WORKSPACE}/tasks/devices/${slug}/device.yaml`),
          30_000,
          `${slug} record on ${device}`,
        );
        expect(verifyRecord(parse(text), masterPublic), `${slug} on ${device}`).toBe(true);
      }
      const list = await awJson<DeviceEntryView[]>(device, ["device", "list"]);
      expect(list.map((d) => `${d.slug}:${d.role}:${d.state}`)).toEqual([
        "macbook-pro:local:valid",
        "ubuntu-01:remote:valid",
      ]);
    }
    const identityB = await awJson<IdentityView>(B, ["identity", "show"]);
    expect(identityB).toMatchObject({ has_master_key: false, device: { slug: B, role: "remote" } });
    expect((await aw(B, ["identity", "phrase"])).code).toBe(1);
  });

  it("3. the secure folder is shared only between computers", async () => {
    // A phone record (signed with the master key) arrives on A.
    const { phrase } = await awJson<{ phrase: string }>(A, ["identity", "phrase"]);
    const master = masterFromPhrase(phrase);
    const phone = signRecord(
      {
        kind: "device",
        schema: 1,
        slug: "pixel-9",
        name: "Pixel 9",
        role: "mobile",
        keys: {
          ed25519: Buffer.alloc(32, 3).toString("base64"),
          x25519: Buffer.alloc(32, 4).toString("base64"),
        },
        sync_device_id: PHONE_SYNC_ID,
        seq: 1,
        revoked: false,
        revoked_at: null,
        addresses: [],
        paired_at: "2026-11-23T08:00:00.000Z",
      },
      master.secret,
    );
    await writeFileIn(A, `${WORKSPACE}/tasks/devices/pixel-9/device.yaml`, stringify(phone));
    await waitFor(
      async () => (await folderDevices(A, `aw-${ws}-tasks`)).includes(PHONE_SYNC_ID),
      30_000,
      "the phone in the tasks folder",
    );
    const secure = await folderDevices(A, `aw-${ws}-secure`);
    expect(secure.sort()).toEqual([idA, idB].sort());
    expect(await folderDevices(A, `aw-${ws}-knowledge`)).toContain(PHONE_SYNC_ID);
    // B opens the credential with the key sealed to its device key.
    const value = await waitFor(
      async () => {
        const result = await aw(B, ["credential", "get", "stripe-test"]);
        return result.code === 0 ? result.stdout : null;
      },
      60_000,
      "the credential on ubuntu-01",
    );
    expect(value).toBe(`${SECRET}\n`);
    evidence("secure-folder", {
      secure_devices: secure.length,
      phone_in_secure: secure.includes(PHONE_SYNC_ID),
    });
  });

  it("4. revoke ubuntu-01: the peer is removed and its later events do not count", async () => {
    const before = await aw(B, [
      "task",
      "edit",
      task,
      "--title",
      "Edit from ubuntu-01 before the revoke",
    ]);
    expect(before.code, before.stderr).toBe(0);
    await waitFor(
      async () => {
        const shown = await awJson<{ title: string }>(A, ["task", "show", task]);
        return shown.title === "Edit from ubuntu-01 before the revoke";
      },
      60_000,
      "the edit of B on A",
    );

    const revoke = await aw(A, ["device", "revoke", B]);
    expect(revoke.code, revoke.stderr).toBe(0);
    const removedAt = Date.now();
    await waitFor(async () => !(await engineDevices(A)).includes(idB), 20_000, "B removed from A");
    evidence("revoke", { peer_removed_ms: Date.now() - removedAt });
    expect((await status(A)).peers.map((p) => p.device)).not.toContain(B);
    const list = await awJson<DeviceEntryView[]>(A, ["device", "list"]);
    expect(list.find((d) => d.slug === B)).toMatchObject({ state: "revoked", seq: 2 });

    // B writes after the revoke; the file reaches A through another path (a copy). B has its own
    // revoke record, so its merge does not apply the edit either: aw says so with exit code 1
    // (principle 9), and the event is in the log of B.
    const after = await aw(B, [
      "task",
      "edit",
      task,
      "--title",
      "Edit from ubuntu-01 after the revoke",
    ]);
    expect(after.code, after.stderr).toBe(1);
    expect(after.stderr).toContain("but the merge did not apply it: device_revoked");
    await copyBetween(B, A, WORKSPACE, [`tasks/${task}/log/${B}.jsonl`]);
    const thread = await waitFor(
      async () => {
        const reply = await awJson<ThreadReply>(A, ["thread", task]);
        return reply.events.some((e) => e.reason === "device_revoked") ? reply : null;
      },
      30_000,
      "the revoked edit on A",
    );
    const edits = thread.events.filter((e) => e.type === "task.edited" && e.dev === B);
    expect(edits.map((e) => [e.applied, e.reason])).toEqual([
      [true, null],
      [false, "device_revoked"],
    ]);
    const shown = await awJson<{ title: string }>(A, ["task", "show", task]);
    expect(shown.title).toBe("Edit from ubuntu-01 before the revoke");
  });

  it("5. no test secret in any file outside the encrypted files, in no log", async () => {
    for (const device of [A, B]) {
      const grep = await exec(device, ["grep", "-rl", SECRET, "/aw"]);
      evidence("secret-grep", { device, files: grep.stdout.split("\n").filter(Boolean) });
      expect(grep.stdout).toBe("");
    }
    const logs = await compose(["logs", "--no-color"]);
    expect(logs.stdout.includes(SECRET)).toBe(false);
    expect(logs.stdout.includes("AGE-SECRET-KEY")).toBe(false);
    // No pairing folder is left.
    for (const device of [A, B]) {
      const left = await exec(device, ["sh", "-c", "ls /aw/state/pairing 2>/dev/null | wc -l"]);
      expect(left.stdout.trim()).toBe("0");
    }
  });
});
