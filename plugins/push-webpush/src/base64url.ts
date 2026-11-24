// base64url with no padding (RFC 4648 section 5), the form of each Web Push key.

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** Decodes base64url; whitespace and padding are ignored. Throws on other characters. */
export function fromBase64Url(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, "").replace(/=+$/, "");
  if (!/^[A-Za-z0-9_-]*$/.test(clean)) throw new RangeError("Not a base64url text");
  return new Uint8Array(Buffer.from(clean, "base64url"));
}
