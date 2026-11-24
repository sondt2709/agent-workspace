// Redaction of credential values before an event line or a terminal snapshot is written
// (docs/phase-1.md 3.3.5, docs/engineering-rules.md 5.11). It finds the plain, base64 and
// URL-encoded forms.
import type { z } from "zod";

export interface Secret {
  /** The credential name, for example `stripe-test`, or `mcp-token` for the MCP token. */
  name: string;
  value: string;
}

export interface Redactor {
  /** The names of the secrets that this redactor replaces. */
  readonly names: readonly string[];
  /** Replaces each form of each secret value in a text with `[redacted:<name>]`. */
  redactText(text: string): string;
  /** Replaces the secret values in each string and each object key of a JSON value. */
  redact<T>(value: T): T;
  /**
   * Replaces each form of each secret value in bytes that are not strict UTF-8, encoded as
   * `encoding`, with the marker in the same encoding. The other bytes stay as they are. Returns the
   * input when nothing changes.
   */
  redactBytes(bytes: Uint8Array, encoding: TextEncoding): Uint8Array;
}

/** The encoding of a text file that is not strict UTF-8 (see `textEncodingOf`). */
export type TextEncoding = "utf8" | "utf16le" | "utf16be";

function encode(text: string, encoding: TextEncoding): Buffer {
  if (encoding === "utf8") return Buffer.from(text, "utf8");
  const le = Buffer.from(text, "utf16le");
  return encoding === "utf16le" ? le : Buffer.from(le).swap16();
}

/** Values shorter than this are redacted in the plain form only: their encoded forms match normal text. */
export const MIN_ENCODED_LENGTH = 4;
/**
 * From this length, AW also finds the base64 form of the value inside a longer base64 text, for
 * example `user:<value>` in an HTTP Basic auth header. Each embedded form is then 7 or more base64
 * characters (42 bits or more), so it does not match normal base64 text by chance.
 */
export const MIN_EMBEDDED_LENGTH = 6;

/**
 * The characters that each URL encoder keeps as they are, in addition to letters and digits:
 * `encodeURIComponent`; RFC 3986 (curl `--data-urlencode`, Python `quote_plus`); Python `quote`
 * (keeps `/`); the WHATWG form encoding (`URLSearchParams`, HTML forms).
 */
const URL_SAFE_SETS = ["-_.!~*'()", "-._~", "-._~/", "-._*"];

/** Percent-encodes the UTF-8 bytes of a value, except letters, digits and the safe characters. */
function percentEncode(value: string, safe: string, plus: boolean, lower: boolean): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const char = String.fromCharCode(byte);
    if (byte < 0x80 && (/[A-Za-z0-9]/.test(char) || safe.includes(char))) out += char;
    else if (plus && char === " ") out += "+";
    else {
      const hex = byte.toString(16).padStart(2, "0");
      out += `%${lower ? hex : hex.toUpperCase()}`;
    }
  }
  return out;
}

/** The URL-encoded forms of a value: each encoder, upper- and lower-case hex, `%20` or `+`. */
function urlForms(value: string): string[] {
  const forms: string[] = [];
  for (const safe of URL_SAFE_SETS)
    for (const plus of [false, true])
      for (const lower of [false, true]) forms.push(percentEncode(value, safe, plus, lower));
  return forms;
}

const BASE64_URL: Record<string, string> = { "+": "-", "/": "_" };

function toBase64Url(base64: string): string {
  return base64.replace(/[+/]/g, (c) => BASE64_URL[c] ?? c);
}

/**
 * The base64 characters that depend only on the value, when the value starts at byte `offset`
 * of a longer text. A character j holds the bits 6j to 6j+5 of the byte stream.
 */
function embeddedBase64(bytes: Buffer, offset: number): string {
  const stream = Buffer.concat([Buffer.alloc(offset), bytes]);
  const encoded = stream.toString("base64");
  const firstBit = offset * 8;
  const endBit = stream.length * 8;
  const start = Math.ceil(firstBit / 6);
  const end = Math.floor(endBit / 6); // exclusive: the characters whose 6 bits are all in the stream
  return encoded.slice(start, end);
}

/** Each form of a value that AW replaces. */
export function secretForms(value: string): string[] {
  const forms = new Set<string>([value]);
  if (value.length >= MIN_ENCODED_LENGTH) {
    const bytes = Buffer.from(value, "utf8");
    const base64 = bytes.toString("base64");
    const unpadded = base64.replace(/=+$/, "");
    for (const form of [base64, unpadded, toBase64Url(base64), toBase64Url(unpadded)])
      forms.add(form);

    for (const form of urlForms(value)) forms.add(form);

    if (value.length >= MIN_EMBEDDED_LENGTH) {
      for (const offset of [0, 1, 2]) {
        const inner = embeddedBase64(bytes, offset);
        forms.add(inner);
        forms.add(toBase64Url(inner));
      }
    }
  }
  forms.delete("");
  return [...forms];
}

export function createRedactor(secrets: readonly Secret[]): Redactor {
  const rules = secrets
    .filter((secret) => secret.value !== "")
    .flatMap((secret) =>
      secretForms(secret.value).map((form) => ({ form, marker: `[redacted:${secret.name}]` })),
    )
    // Longest form first, so a short form never cuts a longer one.
    .sort((a, b) => b.form.length - a.form.length);
  const names = [...new Set(secrets.map((s) => s.name))];

  function redactText(text: string): string {
    let result = text;
    for (const rule of rules) {
      if (result.includes(rule.form)) result = result.split(rule.form).join(rule.marker);
    }
    return result;
  }

  const byteRules = new Map<TextEncoding, { form: string; marker: string }[]>();
  function redactBytes(bytes: Uint8Array, encoding: TextEncoding): Uint8Array {
    if (rules.length === 0) return bytes;
    let list = byteRules.get(encoding);
    if (!list) {
      // A latin1 string has one character per byte, so a search in it is a search in the bytes.
      list = rules.map((rule) => ({
        form: encode(rule.form, encoding).toString("latin1"),
        marker: encode(rule.marker, encoding).toString("latin1"),
      }));
      byteRules.set(encoding, list);
    }
    const text = Buffer.from(bytes).toString("latin1");
    let result = text;
    for (const rule of list) {
      if (result.includes(rule.form)) result = result.split(rule.form).join(rule.marker);
    }
    return result === text ? bytes : Buffer.from(result, "latin1");
  }

  function walk(value: unknown): unknown {
    if (typeof value === "string") return redactText(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [redactText(k), walk(v)]),
      );
    }
    return value;
  }

  return {
    names,
    redactText,
    redact: <T>(value: T) => (rules.length === 0 ? value : (walk(value) as T)),
    redactBytes,
  };
}

type AnySchema = z.core.$ZodType;
interface SchemaDef {
  type: string;
  format?: string;
  checks?: { _zod: { def: { check: string } } }[];
  innerType?: AnySchema;
  in?: AnySchema;
  shape?: Record<string, AnySchema>;
  element?: AnySchema;
  valueType?: AnySchema;
}

const WRAPPERS = new Set(["optional", "nullable", "default", "prefault", "readonly", "catch"]);
const FIXED = new Set(["enum", "literal", "number", "int", "bigint", "boolean", "null", "date"]);

/**
 * True when a string schema has a strict format: a UUID, a date, a regex (slugs, HLC, sha256).
 * Such a value is not free text, and a redaction would break it.
 */
function isFormatted(def: SchemaDef): boolean {
  return (
    def.format !== undefined || (def.checks ?? []).some((c) => c._zod.def.check === "string_format")
  );
}

/**
 * Redacts only the free text of a value that its schema already validated: strings with no strict
 * format, and the keys and values that the schema does not know (the extra fields of a loose
 * object). It never changes a field with a strict format (ids, HLC, slugs, enums, hashes) or a
 * known field name, so a short secret like `2026` cannot break an event.
 */
export function redactBySchema<T>(redactor: Redactor, schema: AnySchema, value: T): T {
  if (redactor.names.length === 0) return value;
  const walk = (node: AnySchema | undefined, item: unknown): unknown => {
    if (item === null || item === undefined || node === undefined) return redactor.redact(item);
    const def = node._zod.def as unknown as SchemaDef;
    if (WRAPPERS.has(def.type)) return walk(def.innerType, item);
    if (def.type === "pipe") return walk(def.in, item);
    if (FIXED.has(def.type)) return item;
    if (def.type === "string" && typeof item === "string") {
      return isFormatted(def) ? item : redactor.redactText(item);
    }
    if (def.type === "array" && Array.isArray(item)) return item.map((x) => walk(def.element, x));
    if (def.type === "object" && def.shape && isPlainObject(item)) {
      const shape = def.shape;
      return Object.fromEntries(
        Object.entries(item).map(([key, v]) =>
          Object.hasOwn(shape, key)
            ? [key, walk(shape[key], v)]
            : [redactor.redactText(key), redactor.redact(v)],
        ),
      );
    }
    if (def.type === "record" && isPlainObject(item)) {
      return Object.fromEntries(
        Object.entries(item).map(([key, v]) => [redactor.redactText(key), walk(def.valueType, v)]),
      );
    }
    // unknown, any, unions and other schemas: redact each string and each key.
    return redactor.redact(item);
  };
  return walk(schema, value) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ignoreBOM keeps a byte order mark in the text, so a redacted file keeps it (review
// credential-redaction low 8): a spreadsheet app needs it for the non-ASCII characters.
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * The text of a file, or null for a binary file. A file is text when its bytes are strict UTF-8 and
 * have no NUL byte (the rule of git for a binary file). AW redacts a text file and writes a binary
 * file as it is (docs/phase-1.md 3.3.5).
 */
export function textOf(content: string | Uint8Array): string | null {
  if (typeof content === "string") return content;
  if (content.includes(0)) return null;
  try {
    return UTF8.decode(content);
  } catch {
    return null;
  }
}

/**
 * The text encoding of bytes that are not strict UTF-8, or null for a binary file. With no NUL
 * byte, the bytes are UTF-8 text with some bad bytes (for example one Latin-1 byte in a log). With
 * a UTF-16 byte order mark, or with NUL bytes only at the odd (or only at the even) offsets of the
 * first 4 KiB, they are UTF-16 text (PowerShell `>`). Each other file with a NUL byte is binary
 * (the rule of git). A value in such a text is redacted in its bytes (fix list 0-42).
 */
export function textEncodingOf(bytes: Uint8Array): TextEncoding | null {
  if (!bytes.includes(0)) return "utf8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf16be";
  const head = bytes.subarray(0, 4096);
  let even = 0;
  let odd = 0;
  for (let i = 0; i < head.length; i++) {
    if (head[i] === 0) {
      if (i % 2 === 0) even++;
      else odd++;
    }
  }
  const pairs = Math.floor(head.length / 2);
  if (pairs === 0) return null;
  if (even === 0 && odd >= pairs * 0.3) return "utf16le";
  if (odd === 0 && even >= pairs * 0.3) return "utf16be";
  return null;
}

/** A redactor with no secrets. */
export const noRedaction: Redactor = createRedactor([]);
