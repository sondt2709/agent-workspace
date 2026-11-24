import { p256 } from "@noble/curves/nist.js";
import { describe, expect, it } from "vitest";
import {
  encrypt,
  fromBase64Url,
  generateVapidKeys,
  previewBytes,
  sendPush,
  toBase64Url,
  validVapidKeys,
  vapidAuthorization,
  verifyVapidJwt,
  type FetchLike,
} from "./index.ts";

// RFC 8291 appendix A (the whitespace of the RFC text removed).
const A = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  header:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
};

describe("encrypt (RFC 8291)", () => {
  it("gives the body of appendix A", () => {
    const body = encrypt(
      new TextEncoder().encode(A.plaintext),
      { p256dh: A.uaPublic, auth: A.auth },
      { salt: fromBase64Url(A.salt), senderPrivateKey: fromBase64Url(A.asPrivate) },
    );
    const header = fromBase64Url(A.header);
    expect(header.length).toBe(86);
    expect(toBase64Url(body.slice(0, 86))).toBe(A.header);
    expect(toBase64Url(body.slice(86))).toBe(A.ciphertext);
    expect(toBase64Url(p256.getPublicKey(fromBase64Url(A.asPrivate), false))).toBe(A.asPublic);
  });

  it("uses a new salt and sender key for each message", () => {
    const sub = { p256dh: A.uaPublic, auth: A.auth };
    const one = encrypt(new Uint8Array([1]), sub);
    const two = encrypt(new Uint8Array([1]), sub);
    expect(toBase64Url(one.slice(0, 86))).not.toBe(toBase64Url(two.slice(0, 86)));
  });

  it("refuses a bad key and a message that does not fit in one record", () => {
    expect(() => encrypt(new Uint8Array(1), { p256dh: "AAAA", auth: A.auth })).toThrow(/p256dh/);
    expect(() => encrypt(new Uint8Array(5000), { p256dh: A.uaPublic, auth: A.auth })).toThrow(
      RangeError,
    );
  });
});

describe("VAPID (RFC 8292)", () => {
  it("makes a valid key pair of the bindings form", () => {
    const keys = generateVapidKeys();
    expect(keys.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    expect(validVapidKeys(keys)).toBe(true);
    expect(validVapidKeys({ ...keys, publicKey: generateVapidKeys().publicKey })).toBe(false);
  });

  it("signs a JWT for the origin of the endpoint, valid 12 h", () => {
    const keys = generateVapidKeys();
    const now = Date.parse("2026-11-23T10:00:00.000Z");
    const header = vapidAuthorization(
      "https://fcm.example.test/wp/abc?x=1",
      keys,
      "mailto:noreply@example.com",
      now,
    );
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(match[2]).toBe(keys.publicKey);
    expect(verifyVapidJwt(match[1]!, keys.publicKey)).toBe(true);
    expect(verifyVapidJwt(match[1]!, generateVapidKeys().publicKey)).toBe(false);
    const claims = JSON.parse(Buffer.from(match[1]!.split(".")[1]!, "base64url").toString()) as {
      aud: string;
      exp: number;
    };
    expect(claims.aud).toBe("https://fcm.example.test");
    expect(claims.exp).toBe(now / 1000 + 12 * 3600);
  });
});

describe("sendPush", () => {
  it("posts the encrypted preview with the headers of docs/phase-1.md 8.3", async () => {
    const keys = generateVapidKeys();
    const calls: Parameters<FetchLike>[] = [];
    const fetch: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve({ status: 201, text: () => Promise.resolve("") });
    };
    const result = await sendPush(
      { endpoint: "https://push.example.test/up/1", p256dh: A.uaPublic, auth: A.auth },
      {
        event: "e",
        task: "t",
        key: "AW-7",
        kind: "gate",
        gate_kind: "question",
        text: "Which limit?",
      },
      { keys, subject: "mailto:noreply@example.com", nowMs: Date.now(), fetch },
    );
    expect(result).toMatchObject({ ok: true, gone: false, status: 201 });
    const [url, init] = calls[0]!;
    expect(url).toBe("https://push.example.test/up/1");
    expect(init.headers).toMatchObject({
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
      Urgency: "high",
    });
    expect(init.headers.Authorization).toMatch(/^vapid t=.+, k=B/);
    expect(init.body.length).toBeGreaterThan(86 + 16);
  });

  it("reports a gone subscription", async () => {
    const fetch: FetchLike = () =>
      Promise.resolve({ status: 410, text: () => Promise.resolve("") });
    const result = await sendPush(
      { endpoint: "https://push.example.test/up/1", p256dh: A.uaPublic, auth: A.auth },
      { event: null, task: null, key: null, kind: "done", gate_kind: null, text: "x" },
      {
        keys: generateVapidKeys(),
        subject: "mailto:noreply@example.com",
        nowMs: Date.now(),
        fetch,
      },
    );
    expect(result).toMatchObject({ ok: false, gone: true });
  });

  it("cuts a long text so that the preview has at most 3 KB", () => {
    const bytes = previewBytes({
      event: "e",
      task: "t",
      key: "AW-7",
      kind: "gate",
      gate_kind: "custom",
      text: "é".repeat(5000),
    });
    expect(bytes.length).toBeLessThanOrEqual(3 * 1024);
    expect(JSON.parse(new TextDecoder().decode(bytes))).toMatchObject({
      key: "AW-7",
      kind: "gate",
    });
  });
});
