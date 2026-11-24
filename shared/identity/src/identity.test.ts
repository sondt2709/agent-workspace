import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  checkCode,
  checkRequest,
  decodePairingCode,
  deviceKeyOf,
  encodePairingCode,
  FileKeystore,
  fromBase64,
  isExpired,
  masterFromPhrase,
  newCredentialKey,
  newDeviceKey,
  newPairingSecrets,
  newRecoveryPhrase,
  open,
  openCredential,
  OpenError,
  openKeystore,
  PairingCodeError,
  PhraseError,
  recipientToX25519,
  seal,
  sealCredential,
  signRecord,
  signRequest,
  toBase64,
  verifyRecord,
  x25519ToRecipient,
  type PairingOffer,
} from "./index.ts";

// A fixed test phrase (BIP-39 test vector entropy 0x00…): never a real key.
const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

function record(overrides: Record<string, unknown> = {}) {
  return {
    kind: "device",
    schema: 1,
    slug: "ubuntu-01",
    name: "ubuntu-01",
    role: "remote",
    keys: {
      ed25519: toBase64(new Uint8Array(32).fill(2)),
      x25519: toBase64(new Uint8Array(32).fill(3)),
    },
    sync_device_id: "UBUNTU2-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA",
    seq: 1,
    revoked: false,
    revoked_at: null,
    addresses: ["tcp://192.0.2.10:22300"],
    paired_at: "2026-11-23T10:00:00.000Z",
    ...overrides,
  };
}

describe("master key and recovery phrase", () => {
  it("gives the same key and user id for the same phrase, in any letter case and spacing", () => {
    const a = masterFromPhrase(PHRASE);
    const b = masterFromPhrase(`  ${PHRASE.toUpperCase().replaceAll(" ", "   ")} `);
    expect(toBase64(a.public)).toBe(toBase64(b.public));
    expect(a.user).toBe(b.user);
    expect(a.user).toMatch(/^u[a-z2-7]{26}$/);
  });

  it("makes new phrases of 24 words with a different key each time", () => {
    const one = newRecoveryPhrase();
    const two = newRecoveryPhrase();
    expect(one.split(" ")).toHaveLength(24);
    expect(masterFromPhrase(one).user).not.toBe(masterFromPhrase(two).user);
  });

  it("refuses a phrase with one changed word", () => {
    const changed = PHRASE.replace(/art$/, "abandon");
    expect(() => masterFromPhrase(changed)).toThrow(PhraseError);
  });
});

describe("device keys", () => {
  it("stores a device key and opens the same public keys again", async () => {
    const key = await newDeviceKey();
    const again = await deviceKeyOf(key.secret);
    expect(again.ed25519).toBe(key.ed25519);
    expect(again.x25519).toBe(key.x25519);
    expect(x25519ToRecipient(key.x25519)).toBe(key.recipient);
    expect(toBase64(recipientToX25519(key.recipient))).toBe(key.x25519);
  });
});

describe("device records", () => {
  const master = masterFromPhrase(PHRASE);

  it("verifies a record that the master key signed, with the keys in any order", () => {
    const signed = signRecord(record(), master.secret);
    expect(verifyRecord(signed, master.public)).toBe(true);
    const reordered = Object.fromEntries(Object.entries(signed).reverse());
    expect(verifyRecord(reordered, master.public)).toBe(true);
  });

  it("refuses a changed field, an added field, another master key and no signature", () => {
    const signed = signRecord(record(), master.secret);
    expect(verifyRecord({ ...signed, role: "local" }, master.public)).toBe(false);
    expect(verifyRecord({ ...signed, extra: 1 }, master.public)).toBe(false);
    const other = masterFromPhrase(newRecoveryPhrase());
    expect(verifyRecord(signed, other.public)).toBe(false);
    const unsigned: Record<string, unknown> = { ...signed };
    delete unsigned.signature;
    expect(verifyRecord(unsigned, master.public)).toBe(false);
    expect(verifyRecord(null, master.public)).toBe(false);
    expect(verifyRecord({ ...signed, signature: "bm90IGEgc2lnbmF0dXJl" }, master.public)).toBe(
      false,
    );
  });

  it("writes canonical JSON with sorted keys and refuses a value that JSON cannot carry", () => {
    expect(canonicalJson({ b: [2, { d: 1, c: null }], a: "x" })).toBe(
      '{"a":"x","b":[2,{"c":null,"d":1}]}',
    );
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(TypeError);
  });
});

describe("pairing formats", () => {
  const master = masterFromPhrase(PHRASE);
  const offer = (expires: string): PairingOffer => ({
    v: 1,
    user: master.user,
    master: toBase64(master.public),
    workspace: { id: "0193a7c2-5b1e-7c3a-9f20-6d1e2a4b8c01", name: "acme" },
    device: {
      slug: "macbook-pro",
      ed25519: toBase64(new Uint8Array(32).fill(1)),
      sync_id: "AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA",
    },
    addresses: ["tcp://192.0.2.1:22300"],
    ...newPairingSecrets(),
    expires,
  });

  it("encodes and decodes a code with each field", () => {
    const data = offer("2026-11-23T10:10:00.000Z");
    const code = encodePairingCode(data);
    expect(code.startsWith("aw1:")).toBe(true);
    expect(decodePairingCode(code)).toEqual(data);
  });

  it("refuses another prefix, a damaged code and a code with a missing field", () => {
    const data = offer("2026-11-23T10:10:00.000Z");
    const code = encodePairingCode(data);
    expect(() => decodePairingCode(`aw2:${code.slice(4)}`)).toThrow(PairingCodeError);
    expect(() => decodePairingCode(`${code.slice(0, 20)}!${code.slice(21)}`)).toThrow(
      PairingCodeError,
    );
    const broken = `aw1:${Buffer.from(JSON.stringify({ ...data, secret: undefined })).toString("base64url")}`;
    expect(() => decodePairingCode(broken)).toThrow(/secret/);
  });

  it("finds an expired code at the expiry and after it", () => {
    const expires = "2026-11-23T10:10:00.000Z";
    expect(isExpired({ expires }, Date.parse(expires) - 1)).toBe(false);
    expect(isExpired({ expires }, Date.parse(expires))).toBe(true);
  });

  it("checks the HMAC of a request with the secret of the code only", async () => {
    const { nonce, secret } = newPairingSecrets();
    const device = await newDeviceKey();
    const request = signRequest(
      {
        v: 1,
        nonce,
        slug: "ubuntu-01",
        name: "ubuntu-01",
        role: "remote",
        keys: { ed25519: device.ed25519, x25519: device.x25519 },
        sync_id: "AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA",
        addresses: [],
      },
      secret,
      fromBase64(device.secret.ed25519),
    );
    expect(checkRequest(request, secret)).toBe(true);
    expect(checkRequest(request, newPairingSecrets().secret)).toBe(false);
    expect(checkRequest({ ...request, slug: "mac-mini-lab" }, secret)).toBe(false);
  });

  it("refuses a request with the public Ed25519 key of another device (no signature of its key)", async () => {
    const { nonce, secret } = newPairingSecrets();
    // The attacker has the code and the public keys of a known device, not its device secret.
    const known = await newDeviceKey();
    const attacker = await newDeviceKey();
    const fields = {
      v: 1 as const,
      nonce,
      slug: "ubuntu-01",
      name: "ubuntu-01",
      role: "remote" as const,
      keys: { ed25519: known.ed25519, x25519: attacker.x25519 },
      sync_id: "AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA",
      addresses: [],
    };
    // A valid HMAC, signed with the key of the attacker: refused.
    const forged = signRequest(fields, secret, fromBase64(attacker.secret.ed25519));
    expect(checkRequest(forged, secret)).toBe(false);
    // The owner of the key signs it: accepted.
    expect(
      checkRequest(signRequest(fields, secret, fromBase64(known.secret.ed25519)), secret),
    ).toBe(true);
  });

  it("gives the same 6-digit check code on both sides, and another code for each other request field", async () => {
    const { nonce } = newPairingSecrets();
    const showing = {
      ed25519: toBase64(new Uint8Array(32).fill(1)),
      sync_id: "AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA",
    };
    const request = {
      v: 1 as const,
      nonce,
      slug: "ubuntu-01",
      name: "ubuntu-01",
      role: "remote" as const,
      keys: {
        ed25519: toBase64(new Uint8Array(32).fill(2)),
        x25519: toBase64(new Uint8Array(32).fill(3)),
      },
      sync_id: "BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB",
      addresses: [],
    };
    const code = checkCode(showing, request);
    expect(code).toMatch(/^\d{6}$/);
    // The new device computes it from the signed request (the HMAC and the signature do not count).
    const device = await newDeviceKey();
    expect(
      checkCode(
        showing,
        signRequest(request, newPairingSecrets().secret, fromBase64(device.secret.ed25519)),
      ),
    ).toBe(code);
    const other = toBase64(new Uint8Array(32).fill(9));
    const changed = [
      checkCode({ ...showing, ed25519: other }, request),
      checkCode({ ...showing, sync_id: request.sync_id }, request),
      checkCode(showing, { ...request, keys: { ...request.keys, ed25519: other } }),
      // The same Ed25519 key with the X25519 key or the sync device id of an attacker.
      checkCode(showing, { ...request, keys: { ...request.keys, x25519: other } }),
      checkCode(showing, { ...request, sync_id: showing.sync_id }),
      checkCode(showing, { ...request, slug: "mac-mini-lab" }),
      checkCode(showing, { ...request, role: "mobile" }),
      checkCode(showing, { ...request, nonce: newPairingSecrets().nonce }),
    ];
    for (const value of changed) expect(value).not.toBe(code);
  });

  it("makes nonces in hex, so a pairing id never starts with '-'", () => {
    for (let i = 0; i < 200; i++) expect(newPairingSecrets().nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("refuses a code whose workspace id is not a UUIDv7 (a path in the id)", () => {
    const data = offer("2026-11-23T10:10:00.000Z");
    for (const id of ["../../.claude/settings", "a/b", "acme"]) {
      const bad = `aw1:${Buffer.from(JSON.stringify({ ...data, workspace: { ...data.workspace, id } })).toString("base64url")}`;
      expect(() => decodePairingCode(bad)).toThrow(/workspace\.id/);
    }
  });
});

describe("sealing", () => {
  it("opens a value sealed to 2 devices with each device key, and never with a third", async () => {
    const [one, two, three] = [await newDeviceKey(), await newDeviceKey(), await newDeviceKey()];
    const file = await seal("sk_test_value", [one.recipient, two.recipient]);
    expect(new TextDecoder().decode(await open(file, one.secret.x25519))).toBe("sk_test_value");
    expect(new TextDecoder().decode(await open(file, two.secret.x25519))).toBe("sk_test_value");
    await expect(open(file, three.secret.x25519)).rejects.toThrow(OpenError);
    expect(Buffer.from(file).includes("sk_test_value")).toBe(false);
  });

  it("opens a sealed credential of the phone, and refuses a file with other content", async () => {
    const computer = await newDeviceKey();
    const file = await sealCredential("stripe-test", "sk_test_value", [computer.recipient]);
    expect(await openCredential(file, computer.secret.x25519)).toEqual({
      kind: "sealed-credential",
      v: 1,
      name: "stripe-test",
      value: "sk_test_value",
    });
    const other = await seal('{"kind":"other"}', [computer.recipient]);
    await expect(openCredential(other, computer.secret.x25519)).rejects.toThrow(/no valid content/);
  });

  it("makes a credential key whose recipient seals to it", async () => {
    const key = await newCredentialKey();
    const file = await seal("value", [key.recipient]);
    expect(new TextDecoder().decode(await open(file, key.identity))).toBe("value");
  });
});

describe("file keystore", () => {
  it("keeps each entry in a 0600 file in a 0700 folder and removes it", async () => {
    const home = await mkdtemp(join(tmpdir(), "awk-"));
    try {
      const store = openKeystore("file", home);
      expect(store).toBeInstanceOf(FileKeystore);
      expect(await store.get("device")).toBeNull();
      await store.set("device", "secret-text");
      expect(await store.get("device")).toBe("secret-text");
      expect((await stat(join(home, "keys"))).mode & 0o777).toBe(0o700);
      expect((await stat(join(home, "keys", "device"))).mode & 0o777).toBe(0o600);
      expect(await readFile(join(home, "keys", "device"), "utf8")).toBe("secret-text");
      expect(await store.delete("device")).toBe(true);
      expect(await store.delete("device")).toBe(false);
      await expect(store.set("../x", "v")).rejects.toThrow(/slug/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("file keystore writes (final check fc1-11)", () => {
  it("keeps one whole value when 2 writes of one entry run at once, and leaves no temp file", async () => {
    const home = await mkdtemp(join(tmpdir(), "awk-"));
    try {
      const store = openKeystore("file", home);
      const values = Array.from({ length: 10 }, (_, i) => `value-${i}`);
      const results = await Promise.allSettled(values.map((v) => store.set("phrase", v)));
      expect(results.filter((r) => r.status === "rejected")).toEqual([]);
      expect(values).toContain(await store.get("phrase"));
      expect(await readdir(join(home, "keys"))).toEqual(["phrase"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

// The real OS keystore: opt-in, because it changes the Keychain of the user (one test entry that
// the test removes).
describe.runIf(process.env.AW_E2E_KEYCHAIN === "1")("OS keystore", () => {
  it("sets, reads and removes an entry", async () => {
    const store = openKeystore("os", `/aw-test-${Date.now()}`, "com.agentworkspace.test");
    await store.set("device", "secret-text");
    expect(await store.get("device")).toBe("secret-text");
    expect(await store.delete("device")).toBe(true);
    expect(await store.get("device")).toBeNull();
  });
});
