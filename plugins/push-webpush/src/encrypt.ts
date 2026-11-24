// Web Push message encryption (RFC 8291) with the `aes128gcm` content coding (RFC 8188): one
// record, ECDH on P-256 with the keys of the phone, HKDF-SHA-256 and AES-128-GCM, all with @noble.
import { gcm } from "@noble/ciphers/aes.js";
import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "node:crypto";
import { fromBase64Url } from "./base64url.ts";

/** The record size of the header. One record holds the whole message. */
export const RECORD_SIZE = 4096;
/** The largest plaintext of one record: the record size minus the tag (16) and the delimiter (1). */
export const MAX_PLAINTEXT = RECORD_SIZE - 17;

const text = (value: string) => new TextEncoder().encode(value);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export interface EncryptOptions {
  /** 16 random bytes; a test gives the salt of RFC 8291 appendix A. */
  salt?: Uint8Array;
  /** The private key of the sender for this message (a new key per message); a test gives one. */
  senderPrivateKey?: Uint8Array;
}

/**
 * Encrypts one push message to the subscription keys of a phone (`p256dh` and `auth`,
 * base64url). Returns the body: the header (salt, record size, sender public key) and the record.
 */
export function encrypt(
  plaintext: Uint8Array,
  subscription: { p256dh: string; auth: string },
  options: EncryptOptions = {},
): Uint8Array {
  if (plaintext.length > MAX_PLAINTEXT) {
    throw new RangeError(`A push message has at most ${MAX_PLAINTEXT} bytes`);
  }
  const uaPublic = fromBase64Url(subscription.p256dh);
  const authSecret = fromBase64Url(subscription.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) {
    throw new RangeError("p256dh is not an uncompressed P-256 public key");
  }
  if (authSecret.length < 16) throw new RangeError("auth is shorter than 16 bytes");
  const salt = options.salt ?? new Uint8Array(randomBytes(16));
  const asPrivate = options.senderPrivateKey ?? p256.utils.randomSecretKey();
  const asPublic = p256.getPublicKey(asPrivate, false);
  // The x coordinate of the shared point.
  const ecdhSecret = p256.getSharedSecret(asPrivate, uaPublic, true).slice(1);
  const keyInfo = concat(text("WebPush: info\0"), uaPublic, asPublic);
  const ikm = hkdf(sha256, ecdhSecret, authSecret, keyInfo, 32);
  const cek = hkdf(sha256, ikm, salt, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(sha256, ikm, salt, text("Content-Encoding: nonce\0"), 12);
  // The last record ends with the delimiter 0x02 and no padding.
  const record = gcm(cek, nonce).encrypt(concat(plaintext, Uint8Array.of(2)));
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, record);
}
