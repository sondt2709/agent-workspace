// VAPID (RFC 8292): one P-256 key pair per computer and the ES256 JWT of the Authorization header.
import { p256 } from "@noble/curves/nist.js";
import { fromBase64Url, toBase64Url } from "./base64url.ts";

export interface VapidKeys {
  /** The uncompressed public key, base64url (87 characters, starts with `B`). */
  publicKey: string;
  /** The 32-byte private key, base64url. */
  privateKey: string;
}

/** The longest JWT life that a push service must accept (RFC 8292 section 2). */
export const MAX_JWT_SECONDS = 24 * 60 * 60;
/** The JWT life of AW: 12 h. */
export const JWT_SECONDS = 12 * 60 * 60;

export function generateVapidKeys(): VapidKeys {
  const secret = p256.utils.randomSecretKey();
  return {
    publicKey: toBase64Url(p256.getPublicKey(secret, false)),
    privateKey: toBase64Url(secret),
  };
}

/** True when the keys are a valid pair. */
export function validVapidKeys(keys: VapidKeys): boolean {
  try {
    const secret = fromBase64Url(keys.privateKey);
    return secret.length === 32 && toBase64Url(p256.getPublicKey(secret, false)) === keys.publicKey;
  } catch {
    return false;
  }
}

const json = (value: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));

/**
 * The `Authorization` header value: `vapid t=<JWT>, k=<public key>`. `aud` is the origin of the
 * endpoint, `exp` is `now` + 12 h, `sub` the contact of the sender (a `mailto:` or `https:` URL).
 */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  nowMs: number,
): string {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(nowMs / 1000) + JWT_SECONDS;
  const input = `${json({ typ: "JWT", alg: "ES256" })}.${json({ aud, exp, sub: subject })}`;
  // ES256: ECDSA P-256 over SHA-256, the 64-byte r||s form (RFC 7518 3.4).
  const signature = p256.sign(new TextEncoder().encode(input), fromBase64Url(keys.privateKey), {
    prehash: true,
    format: "compact",
  });
  return `vapid t=${input}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

/** Checks the JWT of a header with the public key (tests and diagnostics). */
export function verifyVapidJwt(jwt: string, publicKey: string): boolean {
  const parts = jwt.split(".");
  if (parts.length !== 3) return false;
  return p256.verify(
    fromBase64Url(parts[2]!),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    fromBase64Url(publicKey),
    { prehash: true, format: "compact" },
  );
}
