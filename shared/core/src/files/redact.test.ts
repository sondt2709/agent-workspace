import { eventSchemasV1 } from "@aw/schema";
import { describe, expect, it } from "vitest";
import { createRedactor, MIN_EMBEDDED_LENGTH, redactBySchema, secretForms } from "./redact.ts";

// A synthetic test value, not a real credential.
// 46 bytes: not a multiple of 3, so the padded base64 form differs from the embedded form.
const VALUE = "fake_credential/Value+With=Signs and spaces!!!";
const redactor = createRedactor([
  { name: "stripe-test", value: VALUE },
  { name: "mcp-token", value: "aw-mcp-0123456789abcdef" },
]);
const MARK = "[redacted:stripe-test]";

describe("redaction", () => {
  it("replaces the plain value", () => {
    const out = redactor.redactText(`The key is ${VALUE}. Use it once.`);
    expect(out).toBe(`The key is ${MARK}. Use it once.`);
  });

  it("replaces the standard and URL-safe base64 forms, with and without padding", () => {
    const base64 = Buffer.from(VALUE).toString("base64");
    const url = Buffer.from(VALUE).toString("base64url");
    for (const form of [base64, base64.replace(/=+$/, ""), url]) {
      const out = redactor.redactText(`Authorization: Basic ${form}`);
      expect(out).toBe(`Authorization: Basic ${MARK}`);
    }
  });

  it("finds the base64 form inside a longer base64 text at each byte offset", () => {
    for (const prefix of ["", "u", "us", "user:", "a longer user name:"]) {
      const blob = Buffer.from(`${prefix}${VALUE}\n`).toString("base64");
      const out = redactor.redactText(`{"auth":"${blob}"}`);
      expect(out).toContain(MARK);
      // No 8-character run of the value's own base64 stays in the output.
      const inner = Buffer.from(VALUE).toString("base64").slice(4, 12);
      expect(out.includes(inner)).toBe(false);
    }
  });

  it("replaces the URL-encoded forms", () => {
    const encoded = encodeURIComponent(VALUE);
    expect(redactor.redactText(`https://example.com/cb?key=${encoded}&x=1`)).toBe(
      `https://example.com/cb?key=${MARK}&x=1`,
    );
    expect(redactor.redactText(`key=${encoded.replace(/%20/g, "+")}`)).toBe(`key=${MARK}`);
    const lower = encoded.replace(/%[0-9A-F]{2}/g, (s) => s.toLowerCase());
    expect(redactor.redactText(`key=${lower}`)).toBe(`key=${MARK}`);
  });

  it("replaces the RFC 3986 and the form encodings, which also encode !'()*", () => {
    // A synthetic test value with each character that encodeURIComponent keeps.
    const value = "fake-cred!pass(word)*1'x ~y";
    const special = createRedactor([{ name: "test-login", value }]);
    const mark = "[redacted:test-login]";
    const rfc3986 = encodeURIComponent(value).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    const form = new URLSearchParams({ p: value }).toString(); // WHATWG: keeps *, encodes ~
    expect(form).toContain("%21pass%28word%29*1%27x+%7Ey");
    const encoded = [
      rfc3986, // curl --data-urlencode
      rfc3986.replace(/%[0-9A-F]{2}/g, (h) => h.toLowerCase()),
      rfc3986.replace(/%20/g, "+"), // Python quote_plus
      form.slice("p=".length),
      form.slice("p=".length).replace(/%[0-9A-F]{2}/g, (h) => h.toLowerCase()),
    ];
    for (const text of encoded) {
      expect(text).not.toBe(encodeURIComponent(value));
      expect(special.redactText(`login=${text}&next=1`), text).toBe(`login=${mark}&next=1`);
    }
    expect(special.redactText(form)).toBe(`p=${mark}`);
  });

  it("replaces the Python quote form, which keeps '/'", () => {
    const quoted = encodeURIComponent(VALUE)
      .replace(/%2F/g, "/")
      .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    expect(redactor.redactText(`/cb/${quoted}`)).toBe(`/cb/${MARK}`);
  });

  it("finds a short password in an HTTP Basic auth header", () => {
    // Synthetic test values of 6, 8 and 11 characters.
    for (const value of ["fk-pw6", "fake-pw8", "fake-pw-11c"]) {
      const basic = createRedactor([{ name: "test-login", value }]);
      for (const user of ["u", "us", "tester", "test.user@example.com"]) {
        const header = `Basic ${Buffer.from(`${user}:${value}`).toString("base64")}`;
        const out = basic.redactText(header);
        expect(out, `${user}:${value}`).toContain("[redacted:test-login]");
        // The value can no longer be decoded from what stays.
        const rest = out.replace(/^Basic /, "").split("[redacted:test-login]");
        for (const part of rest) {
          expect(Buffer.from(part, "base64").toString("latin1")).not.toContain(value);
        }
      }
    }
  });

  it("walks each string and each key of an event, and leaves other values", () => {
    const event = {
      v: 1,
      data: { text: `token ${VALUE}`, list: [VALUE, 3, null], [VALUE]: true, ok: false },
      mcp: "Bearer aw-mcp-0123456789abcdef",
    };
    expect(redactor.redact(event)).toEqual({
      v: 1,
      data: { text: `token ${MARK}`, list: [MARK, 3, null], [MARK]: true, ok: false },
      mcp: "Bearer [redacted:mcp-token]",
    });
  });

  it("redacts a short value in the plain form only", () => {
    const short = createRedactor([{ name: "pin", value: "abc" }]);
    expect(secretForms("abc")).toEqual(["abc"]);
    expect(short.redactText("abc YWJj")).toBe("[redacted:pin] YWJj");
  });

  it("adds the embedded base64 forms from the minimum length", () => {
    const value = "x".repeat(MIN_EMBEDDED_LENGTH);
    expect(secretForms(value).length).toBeGreaterThan(secretForms(value.slice(1)).length);
  });

  it("redacts only the free text of an event and never a formatted field", () => {
    // A short numeric secret, a secret in a UUID, in a device slug, in a type and a field name.
    const secrets = createRedactor([
      { name: "pin", value: "2026" },
      { name: "hex", value: "7f00" },
      { name: "word", value: "ubuntu" },
      { name: "kind", value: "progress" },
      { name: "field", value: "text" },
    ]);
    const event = {
      v: 1,
      id: "01a2038e-7f00-7000-8000-000000002026",
      hlc: "2026-11-22T14:30:00.000Z#0000",
      dev: "ubuntu-01",
      type: "message.human",
      task: "01a2038e-7f00-70eb-b429-fa86d481c263",
      by: "human@ubuntu-01",
      data: {
        text: "pin 2026 on ubuntu, progress text",
        source: "typed",
        session: "01a20390-53c0-73f3-af1e-cebbd1412026",
        delivery_id: "d-2026",
        extra_ubuntu: "ubuntu",
      },
    };
    const out = redactBySchema(secrets, eventSchemasV1["message.human"], event);
    expect(out).toEqual({
      ...event,
      data: {
        text: "pin [redacted:pin] on [redacted:word], [redacted:kind] [redacted:field]",
        source: "typed",
        session: event.data.session,
        delivery_id: "d-[redacted:pin]",
        "extra_[redacted:word]": "[redacted:word]",
      },
    });
    expect(eventSchemasV1["message.human"].safeParse(out).success).toBe(true);
  });

  it("does nothing with no secrets", () => {
    const none = createRedactor([]);
    const value = { a: "text" };
    expect(none.redact(value)).toBe(value);
  });
});
