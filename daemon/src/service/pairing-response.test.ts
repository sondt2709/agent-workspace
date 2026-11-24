// The new device refuses a pairing response with a record that the master key of the code did not
// sign, or with other keys for this device (openspec add-identity-and-pairing, device-pairing
// "Finish the pairing"). The showing device is simulated: the test writes response.json.
import { IdentityClient, type PairingView } from "@aw/client/identity";
import {
  encodePairingCode,
  masterFromPhrase,
  newDeviceKey,
  newPairingSecrets,
  newRecoveryPhrase,
  signRecord,
  toBase64,
} from "@aw/identity";
import { ensureTestEngine, waitFor } from "@aw/sync-syncthing/testing";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { startTestDaemon, type TestDaemon } from "../testing.ts";
import { folderName } from "./pairing.ts";

const SHOWING_SYNC_ID = "UJZDEGX-DNCF32H-EPF3DHO-DZDOCIE-S2JHTLG-MXGEDNB-73U55XT-PLPFT7K";
const WS = "01a205fd-92a3-7575-ad8b-66b8f8f056a0";
/** The id of another workspace of this device. */
const OTHER_WS = "019ab0c4-5e11-7d2a-9c43-2f6e0d8a1b77";

/** A folder of another workspace: `tasks/workspace.yaml` with its id, and its files. */
async function otherWorkspace(root: string): Promise<void> {
  await mkdir(join(root, "tasks"), { recursive: true });
  await writeFile(
    join(root, "tasks", "workspace.yaml"),
    `kind: workspace\nschema: 1\nid: ${OTHER_WS}\nname: beta\nkey_prefix: BET\n`,
  );
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

let d: TestDaemon;
const master = masterFromPhrase(newRecoveryPhrase());
const other = masterFromPhrase(newRecoveryPhrase());

beforeAll(async () => {
  d = await startTestDaemon({
    device: "ubuntu-01",
    env: {
      AW_SYNC_ENGINE: await ensureTestEngine(),
      AW_SYNC_LISTEN: `tcp://127.0.0.1:${await freePort()}`,
      AW_SYNC_COMMUNITY: "off",
    },
  });
  await d.server.daemon.syncStarted;
}, 60_000);

afterAll(async () => {
  await d?.close();
}, 30_000);

function record(
  slug: string,
  role: string,
  keys: { ed25519: string; x25519: string },
  syncId: string,
) {
  return {
    kind: "device",
    schema: 1,
    slug,
    name: slug,
    role,
    keys,
    sync_device_id: syncId,
    seq: 1,
    revoked: false,
    revoked_at: null,
    addresses: [],
    paired_at: "2026-11-23T08:00:00.000Z",
  };
}

/** Joins with a code of a simulated showing device, writes a response and waits for the end. */
function codeOf(name = "acme") {
  return encodePairingCode({
    v: 1,
    user: master.user,
    master: toBase64(master.public),
    workspace: { id: "01a205fd-92a3-7575-ad8b-66b8f8f056a0", name },
    device: {
      slug: "macbook-pro",
      ed25519: toBase64(new Uint8Array(32)),
      sync_id: SHOWING_SYNC_ID,
    },
    addresses: ["tcp://127.0.0.1:1"],
    ...newPairingSecrets(),
    expires: new Date(Date.now() + 600_000).toISOString(),
  });
}

async function joinWith(
  records: (showing: string, me: Record<string, unknown>) => unknown[],
  root = join(d.folder, "acme"),
) {
  const showing = await newDeviceKey();
  const { nonce, secret } = newPairingSecrets();
  const code = encodePairingCode({
    v: 1,
    user: master.user,
    master: toBase64(master.public),
    workspace: { id: "01a205fd-92a3-7575-ad8b-66b8f8f056a0", name: "acme" },
    device: { slug: "macbook-pro", ed25519: showing.ed25519, sync_id: SHOWING_SYNC_ID },
    addresses: ["tcp://127.0.0.1:1"],
    nonce,
    secret,
    expires: new Date(Date.now() + 600_000).toISOString(),
  });
  const joined = await d.aw(["--json", "pair", code, "--path", root, "--no-wait"]);
  expect(joined.code, joined.stderr).toBe(0);
  const p = JSON.parse(joined.stdout) as PairingView;
  const identity = d.server.daemon.identity;
  const me = record(
    "ubuntu-01",
    "remote",
    { ed25519: identity.device.ed25519, x25519: identity.device.x25519 },
    d.server.daemon.sync.transport!.syncId!,
  );
  const response = {
    v: 1,
    nonce,
    approved: true,
    reason: null,
    records: records(showing.ed25519, me),
    workspace: { id: "01a205fd-92a3-7575-ad8b-66b8f8f056a0", name: "acme" },
    history: 0,
  };
  await writeFile(join(d.home, "pairing", nonce, "response.json"), JSON.stringify(response));
  const api = new IdentityClient(d.client);
  return waitFor(async () => {
    const state = await api.pairing(p.id);
    return state.state === "failed" || state.state === "joining" || state.state === "done"
      ? state
      : null;
  }, 30_000);
}

describe("join input", () => {
  it("refuses a relative path before any change, and makes a safe default folder name", async () => {
    const api = new IdentityClient(d.client);
    await expect(api.join({ code: codeOf(), path: "work/acme" })).rejects.toMatchObject({
      status: 400,
    });
    expect((await api.identity()).user).toBeNull();
    expect(
      d.server.daemon.sync.transport!.folders.some((f) => f.workspace.startsWith("aw-pair")),
    ).toBe(false);
    expect(folderName("Team/Q4", "ws")).toBe("Team-Q4");
    expect(folderName("../../etc", "ws")).toBe("etc");
    expect(folderName("..", "ws")).toBe("ws");
    expect(folderName("a\\b", "ws")).toBe("a-b");
  });

  it("refuses a code whose workspace id is a path, before any change", async () => {
    const api = new IdentityClient(d.client);
    const offer = JSON.parse(
      Buffer.from(codeOf().slice("aw1:".length), "base64url").toString("utf8"),
    ) as { workspace: { id: string; name: string } };
    for (const id of ["../../.claude/settings", "../outside"]) {
      offer.workspace.id = id;
      const code = `aw1:${Buffer.from(JSON.stringify(offer)).toString("base64url")}`;
      await expect(api.join({ code, path: join(d.folder, "evil") })).rejects.toMatchObject({
        status: 400,
      });
      const cli = await d.aw(["pair", code, "--path", join(d.folder, "evil"), "--no-wait"]);
      expect(cli.code).toBe(2);
      expect(cli.stderr).toContain("workspace.id");
    }
    expect((await api.identity()).user).toBeNull();
    expect(await readdir(join(d.home, "records")).catch(() => [])).toEqual([]);
  });

  it("refuses a folder of another workspace and a folder with other files, before any change", async () => {
    const api = new IdentityClient(d.client);
    const beta = join(d.folder, "beta");
    await otherWorkspace(beta);
    const notes = join(d.folder, "notes");
    await mkdir(notes, { recursive: true });
    await writeFile(join(notes, "todo.txt"), "x");
    for (const path of [beta, notes]) {
      await expect(api.join({ code: codeOf(), path })).rejects.toMatchObject({
        status: 409,
        code: "conflict",
      });
      const cli = await d.aw(["pair", codeOf(), "--path", path, "--no-wait"]);
      expect(cli.code).toBe(1);
    }
    expect((await d.aw(["pair", codeOf(), "--path", beta, "--no-wait"])).stderr).toContain(
      "is the folder of another workspace",
    );
    expect((await api.identity()).user).toBeNull();
    expect(
      d.server.daemon.sync.transport!.folders.some((f) => f.workspace.startsWith("aw-pair")),
    ).toBe(false);
    expect(await readdir(join(d.home, "pairing")).catch(() => [])).toEqual([]);
    // A folder with only the empty workspace folders is accepted (a retry).
    const empty = join(d.folder, "empty");
    await mkdir(join(empty, "tasks"), { recursive: true });
    const ok = await api.join({ code: codeOf(), path: empty });
    expect(ok.state).toBe("waiting");
    await api.cancelPairing(ok.id);
  });

  it("ends the pairing when the engine does not add the pairing folder, so the same code works again", async () => {
    const api = new IdentityClient(d.client);
    const transport = d.server.daemon.sync.transport!;
    const add = transport.addPairingFolder.bind(transport);
    transport.addPairingFolder = () => Promise.reject(new Error("the engine restarts"));
    const code = codeOf();
    const path = join(d.folder, "retry");
    try {
      await expect(api.join({ code, path })).rejects.toMatchObject({ status: 503 });
    } finally {
      transport.addPairingFolder = add;
    }
    const id = JSON.parse(Buffer.from(code.slice(4), "base64url").toString("utf8")) as {
      nonce: string;
    };
    expect(await api.pairing(id.nonce)).toMatchObject({ state: "failed" });
    const again = await api.join({ code, path });
    expect(again.state).toBe("waiting");
    await api.cancelPairing(again.id);
  });

  it("refuses a second join with the same code while the first one runs", async () => {
    const api = new IdentityClient(d.client);
    const code = codeOf();
    const first = await api.join({ code, path: join(d.folder, "twice") });
    expect(first.state).toBe("waiting");
    await writeFile(join(d.home, "pairing", first.id, "marker"), "first");
    await expect(api.join({ code, path: join(d.folder, "twice") })).rejects.toMatchObject({
      status: 409,
      code: "conflict",
    });
    // The second call removed nothing of the first one.
    expect(await readFile(join(d.home, "pairing", first.id, "marker"), "utf8")).toBe("first");
    expect((await api.pairing(first.id)).state).toBe("waiting");
    await api.cancelPairing(first.id);
  });
});

describe("pairing response checks", () => {
  it("refuses records that another master key signed", async () => {
    const end = await joinWith((showingKey, me) => [
      signRecord(
        record(
          "macbook-pro",
          "local",
          { ed25519: showingKey, x25519: showingKey },
          SHOWING_SYNC_ID,
        ),
        other.secret,
      ),
      signRecord(me, other.secret),
    ]);
    expect(end.state).toBe("failed");
    expect(end.error).toContain("no valid signature of the master key");
  });

  it("refuses a record of this device with other keys", async () => {
    const stranger = await newDeviceKey();
    const end = await joinWith((showingKey, me) => [
      signRecord(
        record(
          "macbook-pro",
          "local",
          { ed25519: showingKey, x25519: showingKey },
          SHOWING_SYNC_ID,
        ),
        master.secret,
      ),
      signRecord(
        { ...me, keys: { ed25519: stranger.ed25519, x25519: stranger.x25519 } },
        master.secret,
      ),
    ]);
    expect(end.state).toBe("failed");
    expect(end.error).toContain("other keys");
    // No identity and no role change after a refused response.
    expect((await new IdentityClient(d.client).identity()).user).toBeNull();
    const config = parse(await readFile(join(d.home, "config.yaml"), "utf8")) as {
      device: { role: string };
    };
    expect(config.device.role).toBe("local");
  });

  // Last: the response is valid, so this device takes the identity.
  it("fails, and registers nothing, when the folder gets tasks/workspace.yaml of another workspace", async () => {
    const root = join(d.folder, "swapped");
    const joining = await joinWith(
      (showingKey, me) => [
        signRecord(
          record(
            "macbook-pro",
            "local",
            { ed25519: showingKey, x25519: showingKey },
            SHOWING_SYNC_ID,
          ),
          master.secret,
        ),
        signRecord(me, master.secret),
      ],
      root,
    );
    expect(joining.state).toBe("joining");
    const transport = d.server.daemon.sync.transport!;
    expect(transport.folders.filter((f) => f.workspace === WS)).toHaveLength(3);
    // The file of another workspace arrives in the folder (for example a copy by hand).
    await otherWorkspace(root);
    const end = await waitFor(async () => {
      const state = await new IdentityClient(d.client).pairing(joining.id);
      return state.state === "failed" || state.state === "done" ? state : null;
    }, 30_000);
    expect(end.state).toBe("failed");
    expect(end.error).toContain("is the file of another workspace");
    const config = parse(await readFile(join(d.home, "config.yaml"), "utf8")) as {
      workspaces?: unknown[];
    };
    expect(config.workspaces ?? []).toEqual([]);
    expect(transport.folders.filter((f) => f.workspace === WS)).toEqual([]);
  });
});
