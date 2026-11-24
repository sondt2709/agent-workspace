// Signed device records (docs/architecture.md 4.1.3; openspec add-identity-and-pairing, design
// decision 6). The signature covers the record as written in the YAML file, without `signature`.
import { ed25519 } from "@noble/curves/ed25519.js";
import { canonicalJson, concatBytes, fromBase64, toBase64, utf8 } from "./encoding.ts";

/** The domain prefix of a record signature. */
export const RECORD_DOMAIN = "aw-device-record-v1\n";

function signedBytes(record: Record<string, unknown>): Uint8Array {
  const rest = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "signature"));
  return concatBytes(utf8(RECORD_DOMAIN), utf8(canonicalJson(rest)));
}

/**
 * Signs a device record with the master secret. Give each field explicitly: the signature covers
 * the fields as written. Returns the record with its `signature`.
 */
export function signRecord<T extends Record<string, unknown>>(
  record: T,
  masterSecret: Uint8Array,
): T & { signature: string } {
  const signature = toBase64(ed25519.sign(signedBytes(record), masterSecret));
  return { ...record, signature };
}

/**
 * True when a raw record (the parsed YAML value, not the schema value) has a valid master-key
 * signature.
 */
export function verifyRecord(raw: unknown, masterPublic: Uint8Array): boolean {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
  const record = raw as Record<string, unknown>;
  if (typeof record.signature !== "string") return false;
  try {
    return ed25519.verify(fromBase64(record.signature), signedBytes(record), masterPublic);
  } catch {
    return false;
  }
}
