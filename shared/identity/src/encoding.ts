// Byte encodings and canonical JSON for the identity formats (openspec add-identity-and-pairing,
// design decision 6).
import { base32nopad, base64, base64urlnopad, hex } from "@scure/base";

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
export const fromUtf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

export const toBase64 = (bytes: Uint8Array): string => base64.encode(bytes);
export const fromBase64 = (text: string): Uint8Array => base64.decode(text);
export const toBase64Url = (bytes: Uint8Array): string => base64urlnopad.encode(bytes);
export const fromBase64Url = (text: string): Uint8Array => base64urlnopad.decode(text);
export const toHex = (bytes: Uint8Array): string => hex.encode(bytes);
export const toBase32Lower = (bytes: Uint8Array): string => base32nopad.encode(bytes).toLowerCase();

/** Joins byte arrays. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** True when 2 byte arrays are equal, in a time that does not depend on the first difference. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Canonical JSON: object keys sorted by code unit, no spaces, arrays in order. It refuses values
 * that JSON cannot carry the same way on each device (undefined, functions, non-finite numbers).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("A canonical JSON number must be finite");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
    }
    default:
      throw new TypeError(`A canonical JSON value cannot be of the type ${typeof value}`);
  }
}
