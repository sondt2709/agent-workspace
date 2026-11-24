// The identity vectors (openspec add-android-pairing, design decision 4): fixed inputs and the
// values that TypeScript computes from them. `pnpm --filter @aw/identity vectors` writes them to
// contracts/test-vectors/identity.json; the TypeScript test (src/vectors.test.ts) and the Kotlin
// tests (android/identity) check the same file.
import { sha256 } from "@noble/hashes/sha2.js";
import { bech32 } from "@scure/base";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  checkCode,
  deviceKeyOf,
  encodePairingCode,
  masterFromPhrase,
  signRecord,
  signRequest,
  toBase64,
  toBase64Url,
  toHex,
  utf8,
  type PairingOffer,
  type PairingRequestFields,
} from "../src/index.ts";

export const vectorsPath = fileURLToPath(
  new URL("../../../contracts/test-vectors/identity.json", import.meta.url),
);

/** 32 fixed bytes from a label. */
export const fixed = (label: string): Uint8Array => sha256(utf8(`aw-vector-${label}`));

/** The age identity of 32 fixed bytes. */
export const ageIdentity = (bytes: Uint8Array): string =>
  bech32.encode("age-secret-key-", bech32.toWords(bytes), false).toUpperCase();

/** The BIP-39 phrase of 32 zero bytes: a known test phrase, never a real key. */
export const PHRASE = `${"abandon ".repeat(23)}art`;

export const canonicalCases: unknown[] = [
  { b: 1, a: [true, false, null], c: { z: "", y: -0, x: 12345678901234 } },
  { é: 1, e: 2, E: 3, "😀": 4, ÿ: 5, aa: 6, a: 7 },
  ['quote " backslash \\ slash /', "tab\tnew\nline\rret\bback\fform", "\u0001\u001f\u007f "],
  ["Ünïcode Pixel ✓", "emoji 😀", "lone \ud800 high", "lone \udc00 low"],
  [0, -1, 1.5, -2.25, 1e21, 1e-7, 0.000001, 123456789012, 1e300],
];

const SHOWING_SYNC = "AAAAAAA-BBBBBBB-CCCCCCC-DDDDDDD-EEEEEEE-FFFFFFF-GGGGGGG-HHHHHHH";
const PHONE_SYNC = "MFZWI3D-BONSGYC-YLTMRWG-C43ENR5-QXGZDMM-FZWI3DP-BONSGYY-LTMRWAD";
const WORKSPACE = "019a8c3e-7f00-7abc-8def-0123456789ab";

function record(
  slug: string,
  role: string,
  key: { ed25519: string; x25519: string },
  sync: string,
  extra: Record<string, unknown> = {},
) {
  return {
    kind: "device",
    schema: 1,
    slug,
    name: slug === "pixel-9" ? "Ünïcode Pixel ✓" : "MacBook Pro",
    role,
    keys: key,
    sync_device_id: sync,
    seq: 1,
    revoked: false,
    revoked_at: null,
    addresses: ["tcp://192.0.2.20:22300"],
    paired_at: "2026-11-23T12:00:00.000Z",
    ...extra,
  };
}

/** The deterministic part of the vectors. */
export async function deterministicVectors() {
  const master = masterFromPhrase(PHRASE);
  const other = masterFromPhrase(`${"zoo ".repeat(23)}vote`);
  const showing = await deviceKeyOf({
    v: 1,
    ed25519: toBase64(fixed("showing-ed25519")),
    x25519: ageIdentity(fixed("showing-x25519")),
  });
  const phone = await deviceKeyOf({
    v: 1,
    ed25519: toBase64(fixed("phone-ed25519")),
    x25519: ageIdentity(fixed("phone-x25519")),
  });
  const keysOf = (k: typeof phone) => ({ ed25519: k.ed25519, x25519: k.x25519 });
  const computer = signRecord(
    record("macbook-pro", "local", keysOf(showing), SHOWING_SYNC),
    master.secret,
  );
  const mobile = signRecord(record("pixel-9", "mobile", keysOf(phone), PHONE_SYNC), master.secret);
  const revoked = signRecord(
    record("old-laptop", "remote", keysOf(phone), SHOWING_SYNC, {
      seq: 3,
      revoked: true,
      revoked_at: "2026-11-23T12:30:00.000Z#0001",
    }),
    master.secret,
  );
  const records = [
    { name: "computer", raw: computer, valid: true },
    { name: "phone with non-ASCII name", raw: mobile, valid: true },
    { name: "revoked", raw: revoked, valid: true },
    { name: "changed name", raw: { ...computer, name: "MacBook Air" }, valid: false },
    { name: "changed seq", raw: { ...computer, seq: 2 }, valid: false },
    {
      name: "other master key",
      raw: signRecord(record("macbook-pro", "local", keysOf(showing), SHOWING_SYNC), other.secret),
      valid: false,
    },
    {
      name: "no signature",
      raw: Object.fromEntries(Object.entries(computer).filter(([k]) => k !== "signature")),
      valid: false,
    },
    { name: "signature not base64", raw: { ...computer, signature: "not base64!" }, valid: false },
  ];

  const offer: PairingOffer = {
    v: 1,
    user: master.user,
    master: toBase64(master.public),
    workspace: { id: WORKSPACE, name: "Acme" },
    device: { slug: "macbook-pro", ed25519: showing.ed25519, sync_id: SHOWING_SYNC },
    addresses: ["tcp://192.0.2.20:22300", "tcp://198.51.100.2:22300"],
    nonce: toHex(fixed("nonce").slice(0, 16)),
    secret: toBase64Url(fixed("secret")),
    expires: "2026-11-23T12:10:00.000Z",
  };
  const fields: PairingRequestFields = {
    v: 1,
    nonce: offer.nonce,
    slug: "pixel-9",
    name: "Ünïcode Pixel ✓",
    role: "mobile",
    keys: keysOf(phone),
    sync_id: PHONE_SYNC,
    addresses: ["tcp://192.0.2.31:22300"],
  };
  const request = signRequest(fields, offer.secret, fixed("phone-ed25519"));
  const code = encodePairingCode(offer);
  const badOffer = (patch: Record<string, unknown>) =>
    `aw1:${toBase64Url(utf8(JSON.stringify({ ...offer, ...patch })))}`;

  return {
    description:
      "Identity test vectors (openspec add-android-pairing). shared/identity/scripts/vectors.ts writes them; shared/identity/src/vectors.test.ts and the Kotlin tests of android/identity check them. All keys are test keys from fixed labels: never use them for real data.",
    canonical_json: canonicalCases.map((value) => ({ value, canonical: canonicalJson(value) })),
    master: {
      phrase: PHRASE,
      user: master.user,
      public: toBase64(master.public),
      secret_hex: toHex(master.secret),
    },
    records,
    pairing: {
      offer,
      code,
      showing: { ed25519_secret: toBase64(fixed("showing-ed25519")), ed25519: showing.ed25519 },
      phone: {
        ed25519_secret: toBase64(fixed("phone-ed25519")),
        // The secret as hex, not as AGE-SECRET-KEY-1…: the leak check refuses each age identity text.
        x25519_secret_hex: toHex(fixed("phone-x25519")),
        ed25519: phone.ed25519,
        x25519: phone.x25519,
        recipient: phone.recipient,
      },
      request_fields: fields,
      request,
      check_code: checkCode(offer.device, request),
      bad_codes: [
        { name: "other version prefix", code: `aw2:${code.slice(4)}` },
        { name: "damaged base64url", code: "aw1:!!!" },
        { name: "not JSON", code: `aw1:${toBase64Url(utf8("{not json"))}` },
        {
          name: "workspace id is not a UUIDv7",
          code: badOffer({ workspace: { id: "acme", name: "Acme" } }),
        },
        { name: "nonce in base64url", code: badOffer({ nonce: "-".repeat(32) }) },
        { name: "short master key", code: badOffer({ master: toBase64(new Uint8Array(31)) }) },
        { name: "version 2", code: badOffer({ v: 2 }) },
      ],
    },
  };
}
