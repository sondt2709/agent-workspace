// Pairing of a remote computer with one code (openspec add-identity-and-pairing, device-pairing):
// 2 awd with real pinned engines on 127.0.0.1, and a third device that tries the same code.
import { IdentityClient, type PairingView } from "@aw/client/identity";
import { systemClock, type Clock } from "@aw/core";
import {
  decodePairingCode,
  fromBase64,
  newDeviceKey,
  open,
  openText,
  signRequest,
  verifyRecord,
} from "@aw/identity";
import { ensureTestEngine, waitFor } from "@aw/sync-syncthing/testing";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { parse } from "yaml";
import { startTestDaemon, type TestDaemon } from "../testing.ts";

const SECRET = "sk_test_pairing_77d1b0";
const DEPLOY = "sk_test_after_rotation_5e02";
/** A sync id with valid check characters for a simulated third computer (never connects). */
const BUILD_SYNC_ID = "UJZDEGX-DNCF32H-EPF3DHO-DZDOCIE-S2JHTLG-MXGEDNB-73U55XT-PLPFT7K";

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

/** The clock of A: the test moves it forward past the request wait. */
const shift = { ms: 0 };
const clockA: Clock = { now: () => Date.now() + shift.ms, sleep: (ms) => systemClock.sleep(ms) };

async function node(device: string, workspace: boolean, clock?: Clock): Promise<TestDaemon> {
  const d = await startTestDaemon({
    device,
    workspace,
    ...(clock ? { clock } : {}),
    env: {
      AW_SYNC_ENGINE: await ensureTestEngine(),
      AW_SYNC_LISTEN: `tcp://127.0.0.1:${await freePort()}`,
      AW_SYNC_COMMUNITY: "off",
    },
  });
  await d.server.daemon.syncStarted;
  return d;
}

let a: TestDaemon;
let b: TestDaemon;
let c: TestDaemon;

beforeAll(async () => {
  [a, b, c] = await Promise.all([
    node("macbook-pro", true, clockA),
    node("ubuntu-01", false),
    node("mac-mini-lab", false),
  ]);
  await waitFor(
    () =>
      a.server.daemon
        .workspace()
        .deviceRecords()
        .some((r) => r.slug === "macbook-pro"),
    20_000,
  );
}, 90_000);

afterAll(async () => {
  await Promise.all([a?.close(), b?.close(), c?.close()]);
}, 60_000);

describe("pair a remote computer", () => {
  it("pairs ubuntu-01 with a code, the check code and the approval", async () => {
    // Data on A before the pairing: a credential and a knowledge version.
    await a.aw(["credential", "add", "stripe-test"], { stdin: () => Promise.resolve(SECRET) });
    // 2 versions: only the history store of A has the first one after the second write.
    await a.aw(["kb", "write", "shared/rules/testing.md", "--file", "-"], {
      stdin: () => Promise.resolve("Run the tests once.\n"),
    });
    await a.aw(["kb", "write", "shared/rules/testing.md", "--file", "-"], {
      stdin: () => Promise.resolve("Run the tests twice.\n"),
    });
    const oldVersion = createHash("sha256").update("Run the tests once.\n").digest("hex");
    const ws = a.server.daemon.workspace().id;
    const apiA = new IdentityClient(a.client);
    const apiB = new IdentityClient(b.client);

    const start = JSON.parse(
      (await a.aw(["device", "add", "--no-wait", "--json"])).stdout,
    ) as PairingView;
    expect(start.state).toBe("waiting");
    const target = join(b.folder, "acme");
    // The code comes from stdin (`aw pair -`): it stays out of argv.
    const join_ = await b.aw(["pair", "-", "--path", target, "--no-wait", "--json"], {
      stdin: () => Promise.resolve(`${start.code!}\n`),
    });
    expect(join_.code).toBe(0);
    const joined = JSON.parse(join_.stdout) as PairingView;
    expect(joined.check_code).toMatch(/^\d{3} \d{3}$/);
    expect(join_.stderr).toContain(`aw device approve ${start.id} <check code>`);

    const shown = await waitFor(async () => {
      const p = await apiA.pairing(start.id);
      return p.state === "check" ? p : null;
    }, 60_000);
    expect(shown.check_code).toBe(joined.check_code);
    expect(shown.new_device).toEqual({ slug: "ubuntu-01", name: "MacBook Pro", role: "remote" });

    // The code is used: a third device that sends the same code gets no record.
    const third = await c.aw(["pair", start.code!, "--path", join(c.folder, "acme"), "--no-wait"]);
    expect(third.code).toBe(0);
    // A keeps the third device pending: it adds no device after the first valid request.
    const idC = c.server.daemon.sync.transport!.syncId!;
    const engineA = a.server.daemon.sync.transport!;
    await waitFor(async () => idC in (await engineA.pendingDevices()), 30_000);
    // 3 poll periods later, C is still only pending.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(idC in (await engineA.pendingDevices())).toBe(true);
    expect(engineA.peers.map((p) => p.sync_id)).not.toContain(idC);
    const wrong = await a.aw(["device", "approve", start.id, "000000"]);
    expect(wrong.code).toBe(1);
    expect(wrong.stderr).toContain("The check code is not the code of this pairing");

    // The human types the code as it prints, `482 913`: 2 arguments.
    expect(start.id).toMatch(/^[0-9a-f]{32}$/);
    const approve = await a.aw(["device", "approve", start.id, ...joined.check_code!.split(" ")]);
    expect(approve.code).toBe(0);
    const done = await waitFor(async () => {
      const p = await apiB.pairing(start.id);
      return p.state === "done" || p.state === "failed" ? p : null;
    }, 120_000);
    expect(done).toMatchObject({ state: "done", error: null });

    // B: the identity, the device, the workspace, both valid records.
    const identityB = await apiB.identity();
    const identityA = await apiA.identity();
    expect(identityB).toMatchObject({
      user: identityA.user,
      has_master_key: false,
      device: { slug: "ubuntu-01", role: "remote" },
    });
    expect(parse(await readFile(join(b.home, "config.yaml"), "utf8"))).toMatchObject({
      device: { slug: "ubuntu-01", role: "remote" },
      workspaces: [{ id: ws, path: target }],
    });
    const masterPublic = fromBase64(identityA.master_public!);
    for (const root of [a.server.daemon.workspace().root, target]) {
      for (const slug of ["macbook-pro", "ubuntu-01"]) {
        const raw = await waitFor(
          () =>
            readFile(join(root, "tasks/devices", slug, "device.yaml"), "utf8").catch(() => null),
          30_000,
        );
        expect(verifyRecord(parse(raw), masterPublic), `${root} ${slug}`).toBe(true);
      }
    }
    const devicesB = await apiB.devices("-");
    expect(devicesB.map((d) => `${d.slug}:${d.state}`)).toEqual([
      "macbook-pro:valid",
      "ubuntu-01:valid",
    ]);

    // The 3 folders sync, secure too: B opens the credential with the sealed key.
    await waitFor(
      async () => (await b.aw(["credential", "get", "stripe-test"])).stdout === `${SECRET}\n`,
      60_000,
    );
    const peerA = (await a.server.daemon.sync.transport!.status()).find(
      (p) => p.device === "ubuntu-01",
    )!;
    expect(peerA.folders!.map((f) => f.kind).sort()).toEqual(["knowledge", "secure", "tasks"]);

    // The knowledge history store: each version of A, never seen.json of A.
    const historyA = (await readdir(join(a.home, "history", ws))).filter((n) => n !== "seen.json");
    const historyB = await readdir(join(b.home, "history", ws));
    expect(historyA.length).toBeGreaterThan(0);
    for (const name of historyA) expect(historyB).toContain(name);
    // The old version is not in the knowledge folder: only the copy of the pairing gives it.
    expect(historyA).toContain(oldVersion);
    expect(historyB).toContain(oldVersion);

    // A task of A arrives on B.
    const task = await a.client.createTask("-", {
      project: "billing-api",
      title: "After pairing",
      first_message: "x",
    });
    await waitFor(async () => {
      // The test daemons run with no file watcher: merge the new files.
      await b.server.daemon.workspace().refresh();
      return (await b.client.tasks("-")).some((t) => t.id === task.task.id);
    }, 60_000);

    // No pairing folder is left, and the third device has no record.
    await waitFor(async () => (await apiA.pairing(start.id)).state === "done", 60_000);
    await waitFor(async () => {
      const folders = [
        ...a.server.daemon.sync.transport!.folders,
        ...b.server.daemon.sync.transport!.folders,
      ];
      const pairing = await Promise.all([
        readdir(join(a.home, "pairing")).catch(() => []),
        readdir(join(b.home, "pairing")).catch(() => []),
      ]);
      return (
        folders.every((f) => !f.workspace.startsWith("aw-pair")) && pairing.flat().length === 0
      );
    }, 30_000);
    expect(
      a.server.daemon
        .workspace()
        .deviceRecords()
        .map((r) => r.slug)
        .sort(),
    ).toEqual(["macbook-pro", "ubuntu-01"]);
    // A new signed record with another name and role: B takes them, its slug stays. The open
    // workspace of B (its sessions and its logs) reads the device of the record with no restart.
    const serviceA = a.server.daemon.workspace();
    const recordB = serviceA.deviceRecords().find((r) => r.slug === "ubuntu-01")!;
    const followRecord = async (seq: number, name: string, role: "local" | "remote") => {
      const record = a.server.daemon.identity.sign({ ...recordB, name, role, seq });
      await serviceA.write((files) =>
        files.writeDocument("tasks/devices/ubuntu-01/device.yaml", record),
      );
      await waitFor(async () => {
        await b.server.daemon.workspace().refresh();
        const config = parse(await readFile(join(b.home, "config.yaml"), "utf8")) as {
          device: { slug: string; name: string; role: string };
        };
        return (
          config.device.name === name &&
          config.device.slug === "ubuntu-01" &&
          config.device.role === role
        );
      }, 60_000);
      expect(b.server.daemon.workspace().device).toEqual({ slug: "ubuntu-01", role });
    };
    await followRecord(recordB.seq + 1, "ubuntu-01 lab", "local");
    await followRecord(recordB.seq + 2, "ubuntu-01 lab", "remote");

    // B has no master key: it shows no code (CLI exit 1, API 403 refused).
    const phrase = await b.aw(["identity", "phrase"]);
    expect(phrase.code).toBe(1);
    expect(phrase.stderr).toContain("This device has no master key");
    const remoteAdd = await b.aw(["device", "add", "--no-wait"]);
    expect(remoteAdd.code).toBe(1);
    expect(remoteAdd.stderr).toContain("master key");
    await expect(apiB.startPairing("-")).rejects.toMatchObject({ status: 403, code: "refused" });

    const thirdState = await new IdentityClient(c.client).pairing(start.id);
    expect(thirdState.state).toBe("waiting");
    await new IdentityClient(c.client).cancelPairing(start.id);
  }, 300_000);

  it("revokes a third computer: the remaining remote ubuntu-01 uses the rotated key", async () => {
    // A third computer build-01 (a simulated record) has the credential key, then A revokes it.
    const serviceA = a.server.daemon.workspace();
    const serviceB = b.server.daemon.workspace();
    const build = await newDeviceKey();
    const record = a.server.daemon.identity.sign({
      kind: "device",
      schema: 1,
      slug: "build-01",
      name: "build-01",
      role: "remote",
      keys: { ed25519: build.ed25519, x25519: build.x25519 },
      sync_device_id: BUILD_SYNC_ID,
      seq: 1,
      revoked: false,
      revoked_at: null,
      addresses: [],
      paired_at: new Date().toISOString(),
    });
    await serviceA.write((files) =>
      files.writeDocument("tasks/devices/build-01/device.yaml", record),
    );
    await a.server.daemon.credentials.sealKeyTo(serviceA, record);
    const oldKey = await openText(
      await readFile(join(serviceA.root, "secure/keys/build-01.age")),
      build.secret.x25519,
    );
    // B opened the credential with the old key before the revoke (the key is in its cache).
    expect((await b.aw(["credential", "get", "stripe-test"])).stdout).toBe(`${SECRET}\n`);

    expect((await a.aw(["device", "revoke", "build-01"])).code).toBe(0);
    // The rotation arrives on B: its key file and the credential files.
    await waitFor(async () => {
      const [keyA, keyB, file] = await Promise.all([
        readFile(join(serviceA.root, "secure/keys/ubuntu-01.age")),
        readFile(join(serviceB.root, "secure/keys/ubuntu-01.age")),
        readFile(join(serviceB.root, "secure/credentials/stripe-test.age")),
      ]);
      const rotated = await open(file, oldKey).then(
        () => false,
        () => true,
      );
      return keyA.equals(keyB) && rotated;
    }, 60_000);
    // B opens the rotated credential with no restart, and keeps the value for the redaction.
    expect((await b.aw(["credential", "get", "stripe-test"])).stdout).toBe(`${SECRET}\n`);
    expect(await b.server.daemon.credentials.refreshSecrets(serviceB)).toBeGreaterThanOrEqual(1);
    const task = await b.client.createTask("-", {
      project: "billing-api",
      title: "After the rotation",
      first_message: `Use ${SECRET}`,
    });
    expect(task.task.first_message).toContain("[redacted:stripe-test]");

    // A new value on B uses the new key: the revoked computer cannot open it, A can.
    const add = await b.aw(["credential", "add", "deploy-key"], {
      stdin: () => Promise.resolve(DEPLOY),
    });
    expect(add.code, add.stderr).toBe(0);
    const added = await readFile(join(serviceB.root, "secure/credentials/deploy-key.age"));
    await expect(open(added, oldKey)).rejects.toThrow();
    await waitFor(
      async () => (await a.aw(["credential", "get", "deploy-key"])).stdout === `${DEPLOY}\n`,
      60_000,
    );

    // A revoked device never pairs again: the third awd asks for the name build-01.
    const start = JSON.parse(
      (await a.aw(["device", "add", "--no-wait", "--json"])).stdout,
    ) as PairingView;
    const join_ = await c.aw([
      "pair",
      start.code!,
      "--path",
      join(c.folder, "acme"),
      "--slug",
      "build-01",
      "--no-wait",
      "--json",
    ]);
    expect(join_.code, join_.stderr).toBe(0);
    const joined = JSON.parse(join_.stdout) as PairingView;
    const apiA = new IdentityClient(a.client);
    await waitFor(async () => (await apiA.pairing(start.id)).state === "check", 60_000);
    const refused = await a.aw(["device", "approve", start.id, joined.check_code!]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("is revoked");
    expect(serviceA.deviceRecords().find((r) => r.slug === "build-01")).toMatchObject({
      revoked: true,
      seq: 2,
    });
    await apiA.cancelPairing(start.id);
    await new IdentityClient(c.client).cancelPairing(start.id);
  }, 300_000);

  it("removes a device that offers the pairing folder and writes no request, and accepts it again", async () => {
    const apiA = new IdentityClient(a.client);
    const start = JSON.parse(
      (await a.aw(["device", "add", "--no-wait", "--json"])).stdout,
    ) as PairingView;
    const offer = decodePairingCode(start.code!);
    // A fresh awd D offers the pairing folder by its engine only: an empty folder, no
    // request.json. (A fresh engine: an engine that A removed a short time ago can wait up to its
    // last reconnect interval before it dials again.)
    const d = await node("edge-01", false);
    onTestFinished(() => d.close());
    const engineD = d.server.daemon.sync.transport!;
    const empty = join(d.home, "silent-pairing");
    await mkdir(empty, { recursive: true });
    await engineD.addPairingDevice(offer.device.sync_id, offer.device.slug, offer.addresses);
    await engineD.addPairingFolder(`aw-pair-${offer.nonce}`, empty, offer.device.sync_id);
    const idD = engineD.syncId!;
    const count = (msg: string) =>
      a
        .logLines()
        .filter((l) => l.msg === msg && l.pairing === start.id && (l.device ?? idD) === idD).length;
    await waitFor(() => count("Pairing folder accepted") === 1, 60_000);
    // After the request wait, A removes D and its folder; the pairing still waits.
    shift.ms += 61_000;
    await waitFor(
      () => count("The device wrote no request in time: the device is removed") === 1,
      10_000,
    );
    expect((await apiA.pairing(start.id)).state).toBe("waiting");
    // D still offers the folder: A adds it again (a refused device is not blocked).
    await waitFor(() => count("Pairing folder accepted") === 2, 60_000);
    // D sends a valid request (signed with its own device key) with the name of the showing
    // device: the approval refuses it.
    const keyD = d.server.daemon.identity.device;
    const request = signRequest(
      {
        v: 1,
        nonce: offer.nonce,
        slug: "macbook-pro",
        name: "macbook-pro",
        role: "remote",
        keys: { ed25519: keyD.ed25519, x25519: keyD.x25519 },
        sync_id: idD,
        addresses: [],
      },
      offer.secret,
      fromBase64(keyD.secret.ed25519),
    );
    await writeFile(join(empty, "request.json"), JSON.stringify(request));
    await engineD.scanPairingFolder(`aw-pair-${offer.nonce}`);
    const shown = await waitFor(async () => {
      const p = await apiA.pairing(start.id);
      return p.state === "check" ? p : null;
    }, 60_000);
    expect(shown.new_device?.slug).toBe("macbook-pro");
    const refused = await a.aw(["device", "approve", start.id, shown.check_code!]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("names the showing device");
    await apiA.cancelPairing(start.id);
    await engineD.removePairingFolder(`aw-pair-${offer.nonce}`);
    await engineD.removePairingDevice(offer.device.sync_id);
  }, 180_000);

  it("keeps one open pairing per workspace; a running approval is not cancelled and does not expire", async () => {
    const apiA = new IdentityClient(a.client);
    const start = JSON.parse(
      (await a.aw(["device", "add", "--no-wait", "--json"])).stdout,
    ) as PairingView;
    // A second pairing of the same workspace is refused while the first one is open.
    await expect(apiA.startPairing("-")).rejects.toMatchObject({ status: 409, code: "conflict" });
    const second = await a.aw(["device", "add", "--no-wait"]);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain(`The pairing ${start.id} of this workspace is open`);

    // A fresh awd (an engine that A removed a short time ago can wait before it dials again).
    const e = await node("lab-02", false);
    onTestFinished(() => e.close());
    // The location holds other files, and its folder "acme" too (openspec workspace-folder).
    const work = join(e.folder, "work");
    await mkdir(join(work, "acme"), { recursive: true });
    await writeFile(join(work, "readme.txt"), "a file of the person\n");
    await writeFile(join(work, "acme", "report.pdf"), "a file of the person\n");
    // The old --path form refuses a folder with other files, before any change, and names --in.
    const exact = await e.aw(["pair", "-", "--path", work, "--no-wait"], {
      stdin: () => Promise.resolve(`${start.code!}\n`),
    });
    expect(exact.code).toBe(1);
    expect(exact.stderr).toContain(`--in ${work}`);
    const join_ = await e.aw(["pair", "-", "--in", work, "--no-wait", "--json"], {
      stdin: () => Promise.resolve(`${start.code!}\n`),
    });
    expect(join_.code, join_.stderr).toBe(0);
    const joined = JSON.parse(join_.stdout) as PairingView;
    const target = join(work, "acme-aw1");
    expect(joined.folder).toBe(target);
    expect(joined.folder_note).toBe(
      `${join(work, "acme")} is in use (other files), so AW uses ${target}.`,
    );
    expect(join_.stderr).toContain(`Folder: ${target}`);
    await waitFor(async () => (await apiA.pairing(start.id)).state === "check", 60_000);

    // The approval waits in its first step until the test releases it.
    const credentials = a.server.daemon.credentials;
    const requireKey = credentials.requireKey.bind(credentials);
    let entered = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    credentials.requireKey = async (service) => {
      entered = true;
      await gate;
      return requireKey(service);
    };
    onTestFinished(() => {
      credentials.requireKey = requireKey;
    });
    const approving = a.server.daemon.pairing.approve(start.id, joined.check_code!);
    await waitFor(() => entered, 10_000);
    const cancel = await a.aw(["device", "cancel", start.id]);
    expect(cancel.code).toBe(1);
    expect(cancel.stderr).toContain("is being approved now");
    // The code expires while the approval runs: 3 poll periods later the pairing is still open.
    shift.ms += 11 * 60_000;
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect((await apiA.pairing(start.id)).state).toBe("check");
    shift.ms -= 11 * 60_000;
    release();
    expect((await approving).state).toBe("approved");
    const done = await waitFor(async () => {
      const p = await new IdentityClient(e.client).pairing(start.id);
      return p.state === "done" || p.state === "failed" ? p : null;
    }, 120_000);
    expect(done).toMatchObject({ state: "done", error: null, folder: target });
    await waitFor(async () => (await apiA.pairing(start.id)).state === "done", 60_000);
    // The workspace is in acme-aw1; the files of the person stay where they were.
    expect((await e.client.workspaces()).map((w) => w.path)).toEqual([target]);
    expect(await readdir(join(work, "acme"))).toEqual(["report.pdf"]);
    expect((await readdir(work)).sort()).toEqual(["acme", "acme-aw1", "readme.txt"]);
    expect((await e.aw(["status"])).stdout).toContain(`  Folder: ${target}`);
  }, 300_000);

  it("gives a join and an init that choose at the same time 2 folders (workspace-folder check)", async () => {
    const apiA = new IdentityClient(a.client);
    const start = JSON.parse(
      (await a.aw(["device", "add", "--no-wait", "--json"])).stdout,
    ) as PairingView;
    onTestFinished(async () => {
      await apiA.cancelPairing(start.id).catch(() => undefined);
    });
    const f = await node("lab-03", false);
    // A close with an open join and a new workspace takes more than the default 10 s.
    onTestFinished(() => f.close(), 60_000);
    const apiF = new IdentityClient(f.client);
    // A barrier: the first 2 reads of the folder context wait for each other (3 s at most). With
    // no lock, the join and the init read the same free folder.
    const daemon = f.server.daemon;
    const read = daemon.folderContext.bind(daemon);
    let waiting = 0;
    let open!: () => void;
    const both = new Promise<void>((resolve) => (open = resolve));
    daemon.folderContext = async () => {
      waiting += 1;
      if (waiting === 2) open();
      if (waiting <= 2) await Promise.race([both, new Promise((r) => setTimeout(r, 3000))]);
      return read();
    };
    const work = join(f.folder, "work");
    const [joined, created] = await Promise.all([
      apiF.join({ code: start.code!, parent: work }),
      f.client.initWorkspace({ parent: work, name: "acme" }),
    ]);
    expect(new Set([joined.folder, created.workspace.path]).size).toBe(2);
    expect([joined.folder, created.workspace.path].sort()).toEqual([
      join(work, "acme"),
      join(work, "acme-aw1"),
    ]);

    // The folder of the join gets another workspace while the person approves: the join fails
    // after the approval and adds no sync folder.
    await mkdir(join(joined.folder!, "tasks"), { recursive: true });
    await writeFile(
      join(joined.folder!, "tasks", "workspace.yaml"),
      "kind: workspace\nschema: 1\nid: 01960000-0000-7000-8000-0000000000aa\nname: other\nkey_prefix: OT\n",
    );
    await waitFor(async () => (await apiA.pairing(start.id)).state === "check", 60_000);
    await apiA.approve(start.id, joined.check_code!);
    const end = await waitFor(async () => {
      const p = await apiF.pairing(start.id);
      return p.state === "failed" || p.state === "done" ? p : null;
    }, 60_000);
    expect(end.state).toBe("failed");
    expect(end.error).toContain(
      `${joined.folder!} has the workspace 01960000-0000-7000-8000-0000000000aa now`,
    );
    expect((await f.client.workspaces()).map((w) => w.path)).toEqual([created.workspace.path]);
  }, 180_000);
});
