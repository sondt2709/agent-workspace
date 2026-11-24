// The send of one Web Push message (RFC 8030): the encrypted body (RFC 8291) with the VAPID
// header (RFC 8292). The fetch function is a parameter, so a test replaces the push service.
import { encrypt } from "./encrypt.ts";
import { vapidAuthorization, type VapidKeys } from "./vapid.ts";

/** One subscription of a phone in `push.yaml`. */
export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** What a push is about: a gate, a Done task, or the agent login (gate-full-context, M23). */
export type PushKind = "gate" | "done" | "login_expired" | "login_ends";

/** The preview of docs/phase-1.md 8.3. */
export interface PushPreview {
  event: string | null;
  task: string | null;
  key: string | null;
  kind: PushKind;
  /** The gate kind of a `gate` push, else null. */
  gate_kind: string | null;
  text: string;
}

/** The largest preview JSON (docs/phase-1.md 8.3). */
export const MAX_PREVIEW_BYTES = 3 * 1024;
/** The TTL of a push: 24 h. */
export const PUSH_TTL_S = 24 * 60 * 60;

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: Uint8Array; signal?: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface SendOptions {
  keys: VapidKeys;
  /** The VAPID `sub`: a `mailto:` or `https:` contact. */
  subject: string;
  nowMs: number;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface SendResult {
  status: number;
  /** True for 201 or another 2xx. */
  ok: boolean;
  /** True for 404 and 410: the subscription is gone; the phone registers again. */
  gone: boolean;
  body: string;
}

/** The preview as JSON bytes, with the text cut so that the JSON has at most 3 KB. */
export function previewBytes(preview: PushPreview): Uint8Array {
  const encoder = new TextEncoder();
  let text = preview.text;
  for (;;) {
    const bytes = encoder.encode(JSON.stringify({ ...preview, text }));
    if (bytes.length <= MAX_PREVIEW_BYTES || text.length === 0) return bytes;
    text = `${text.slice(0, Math.max(0, Math.floor(text.length * 0.8) - 1))}…`;
  }
}

/** Sends one push with `Urgency: high` and a TTL of 24 h. A network error throws. */
export async function sendPush(
  subscription: PushSubscription,
  preview: PushPreview,
  options: SendOptions,
): Promise<SendResult> {
  const body = encrypt(previewBytes(preview), subscription);
  const doFetch = options.fetch ?? globalThis.fetch;
  const reply = await doFetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapidAuthorization(
        subscription.endpoint,
        options.keys,
        options.subject,
        options.nowMs,
      ),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(PUSH_TTL_S),
      Urgency: "high",
    },
    body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  const text = await reply.text().catch(() => "");
  return {
    status: reply.status,
    ok: reply.status >= 200 && reply.status < 300,
    gone: reply.status === 404 || reply.status === 410,
    body: text.slice(0, 500),
  };
}
