// The pairing formats (docs/phase-1.md 7; openspec add-identity-and-pairing, design decision 10):
// the offer in the code `aw1:…`, the request of the new device with its HMAC, the check code and
// the response of the showing device. The phone app uses the same formats later.
import { ed25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  canonicalJson,
  equalBytes,
  fromBase64,
  fromBase64Url,
  fromUtf8,
  toBase64,
  toBase64Url,
  toHex,
  utf8,
} from "./encoding.ts";

/** The prefix of a pairing code of format version 1. */
export const CODE_PREFIX = "aw1:";
/** A code is valid for 10 minutes (docs/phase-1.md 7.1). */
export const PAIRING_TTL_MS = 10 * 60 * 1000;

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const syncId = z.string().regex(/^[A-Z2-7]{7}(?:-[A-Z2-7]{7}){7}$/);
const key32 = z.base64().refine((v) => fromBase64(v).length === 32, "must have 32 bytes");
/**
 * 16 random bytes in lower-case hex. Never base64url: the nonce is the pairing id on the command
 * line (`aw device approve <id>`), a folder name and a sync folder id, so it never starts with '-'.
 */
const nonce = z.string().regex(/^[0-9a-f]{32}$/);
/**
 * The workspace id is a UUIDv7 (the `uuidv7` of `@aw/schema`). The new device uses it in paths
 * (`records/<id>.json`, `history/<id>/`), so a code with any other text is refused.
 */
const workspaceId = z.uuid({ version: "v7" });

/** The data of a pairing code. */
export const pairingOfferSchema = z.object({
  v: z.literal(1),
  user: z.string().regex(/^u[a-z2-7]{26}$/),
  /** The master public key, base64. */
  master: key32,
  workspace: z.object({ id: workspaceId, name: z.string().min(1).max(200) }),
  device: z.object({ slug, ed25519: key32, sync_id: syncId }),
  addresses: z.array(z.string().min(1)).max(16),
  /** 16 random bytes, hex: the pairing id and the folder `aw-pair-<nonce>`. */
  nonce,
  /** 32 random bytes, base64url: the key of the request HMAC. */
  secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expires: z.iso.datetime(),
});
export type PairingOffer = z.infer<typeof pairingOfferSchema>;

/** A code that is not a valid pairing code. */
export class PairingCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairingCodeError";
  }
}

/** Makes a new nonce and a new secret for an offer. */
export function newPairingSecrets(): { nonce: string; secret: string } {
  return { nonce: toHex(randomBytes(16)), secret: toBase64Url(randomBytes(32)) };
}

export function encodePairingCode(offer: PairingOffer): string {
  return CODE_PREFIX + toBase64Url(utf8(JSON.stringify(pairingOfferSchema.parse(offer))));
}

/** Decodes a code. It does not check the expiry: see `isExpired`. */
export function decodePairingCode(code: string): PairingOffer {
  const text = code.trim();
  if (!text.startsWith(CODE_PREFIX)) {
    throw new PairingCodeError(`A pairing code starts with ${CODE_PREFIX}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(fromUtf8(fromBase64Url(text.slice(CODE_PREFIX.length))));
  } catch {
    throw new PairingCodeError("The pairing code is damaged: copy the full code again");
  }
  const parsed = pairingOfferSchema.safeParse(json);
  if (!parsed.success) {
    throw new PairingCodeError(
      `The pairing code is not valid: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  }
  return parsed.data;
}

export function isExpired(offer: Pick<PairingOffer, "expires">, now: number): boolean {
  return Date.parse(offer.expires) <= now;
}

/** The request of the new device, in `request.json` of the pairing folder. */
export const pairingRequestSchema = z.object({
  v: z.literal(1),
  nonce,
  slug,
  name: z.string().min(1).max(200),
  role: z.enum(["remote", "mobile"]),
  keys: z.object({ ed25519: key32, x25519: key32 }),
  sync_id: syncId,
  addresses: z.array(z.string().min(1)).max(16),
  /**
   * The Ed25519 signature of the device key over the request without `sig` and `mac`, base64. It
   * proves that the new device has the secret of `keys.ed25519`: the public keys of the devices
   * are not secret, so without it a code holder could ask for the record of a known device.
   */
  sig: z.base64(),
  /** HMAC-SHA256 with the secret of the code over the request without `mac`, base64. */
  mac: z.base64(),
});
export type PairingRequest = z.infer<typeof pairingRequestSchema>;
/** The request fields that the new device fills in. */
export type PairingRequestFields = Omit<PairingRequest, "mac" | "sig">;

const REQUEST_DOMAIN = "aw-pair-request-v1\n";
const REQUEST_SIG_DOMAIN = "aw-pair-request-sig-v1\n";

function without(request: object, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(request).filter(([key]) => !keys.includes(key)));
}

function requestMac(request: Omit<PairingRequest, "mac">, secret: string): Uint8Array {
  return hmac(
    sha256,
    fromBase64Url(secret),
    utf8(REQUEST_DOMAIN + canonicalJson(without(request, ["mac"]))),
  );
}

function sigBytes(request: PairingRequestFields): Uint8Array {
  return utf8(REQUEST_SIG_DOMAIN + canonicalJson(without(request, ["mac", "sig"])));
}

/**
 * Signs a request with the Ed25519 secret of the device key (`sig`), then adds the HMAC with the
 * secret of the code (`mac`).
 */
export function signRequest(
  request: PairingRequestFields,
  secret: string,
  deviceSecret: Uint8Array,
): PairingRequest {
  const plain = without(request, ["mac", "sig"]) as PairingRequestFields;
  const signed = { ...plain, sig: toBase64(ed25519.sign(sigBytes(plain), deviceSecret)) };
  return pairingRequestSchema.parse({ ...signed, mac: toBase64(requestMac(signed, secret)) });
}

/**
 * True when the HMAC of a request is the HMAC with this secret, and the signature is a valid
 * signature of the Ed25519 key of the request.
 */
export function checkRequest(request: PairingRequest, secret: string): boolean {
  if (!equalBytes(fromBase64(request.mac), requestMac(request, secret))) return false;
  try {
    return ed25519.verify(
      fromBase64(request.sig),
      sigBytes(request),
      fromBase64(request.keys.ed25519),
    );
  } catch {
    return false;
  }
}

const CHECK_DOMAIN = "aw-check-v2\n";

/**
 * The 6-digit check code that both screens show. It covers the keys of the showing device and
 * each field of the request without its HMAC and its signature (the nonce, the slug, the name, the
 * role, both keys, the sync device id, the addresses): approve() signs, seals to and shares with
 * exactly these values, so a request with another X25519 key or sync device id gives another code
 * even with the same Ed25519 key.
 *
 * Accepted risk (design decision 22): the requester chooses some of these fields, and nothing
 * commits it to them before it sees the code. An attacker with a leaked code who can also see the
 * check code of the real new device can try about 1,000,000 requests to get the same code, and
 * must then send its request before the real device. The code is valid for 10 minutes and is used
 * by the first valid request, and the request must be signed with the device key that it names.
 */
export function checkCode(
  showing: { ed25519: string; sync_id: string },
  request: PairingRequestFields | PairingRequest,
): string {
  const rest = without(request, ["mac", "sig"]);
  const digest = sha256(
    utf8(
      CHECK_DOMAIN +
        canonicalJson({
          showing: { ed25519: showing.ed25519, sync_id: showing.sync_id },
          request: rest,
        }),
    ),
  );
  const value = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0) % 1_000_000;
  return value.toString().padStart(6, "0");
}

/** The check code as people read it: `123 456`. */
export function formatCheckCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** Removes spaces from a typed check code. */
export function normalizeCheckCode(code: string): string {
  return code.replace(/\s+/g, "");
}

/** The response of the showing device, in `response.json` of the pairing folder. */
export const pairingResponseSchema = z.object({
  v: z.literal(1),
  nonce,
  approved: z.boolean(),
  reason: z.string().nullable().default(null),
  /** The signed records of the showing device and of the new device, as written. */
  records: z.array(z.record(z.string(), z.unknown())).default([]),
  workspace: z.object({ id: workspaceId, name: z.string().min(1) }),
  /** The count of files in `history/`. */
  history: z.int().min(0).default(0),
});
export type PairingResponse = z.infer<typeof pairingResponseSchema>;

/** The last file of the new device: it has the records and the folders. */
export const pairingDoneSchema = z.object({ v: z.literal(1), nonce, ok: z.boolean() });
