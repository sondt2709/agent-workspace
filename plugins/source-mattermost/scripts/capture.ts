// Captures the responses of a real Mattermost for the adapter tests (fixtures/api.json).
// Run it against a test server with synthetic users only:
//   MM_URL=http://127.0.0.1:18065 MM_TOKEN=<token of alex> node scripts/capture.ts
// It replaces the server URL with https://chat.example.com and keeps only the fields that the
// adapter reads. Read the diff before a commit.
import { writeFile } from "node:fs/promises";
import { MattermostSource } from "../src/mattermost.ts";

const url = process.env.MM_URL!;
const token = process.env.MM_TOKEN!;
const calls: { method: string; path: string; status: number; body: unknown }[] = [];
const real = globalThis.fetch;
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const response = await real(input, init);
  const text = await response.clone().text();
  const target = new URL(input instanceof Request ? input.url : input);
  calls.push({
    method: init?.method ?? "GET",
    path: `${target.pathname}${target.search}`,
    status: response.status,
    body: text === "" ? null : (JSON.parse(text) as unknown),
  });
  return response;
};

const source = new MattermostSource({ url, token });
const conversations = await source.conversations();
const billing = conversations.find((c) => c.name === "~billing")!;
await source.collect({ conversations: conversations.map((c) => ({ id: c.id, since: 0 })) });
await source.findPending(billing.id, "01a20400-0000-7000-8000-000000000999");

const keep = new Set([
  "id",
  "username",
  "name",
  "display_name",
  "type",
  "delete_at",
  "last_post_at",
  "team_id",
  "order",
  "posts",
  "channel_id",
  "root_id",
  "user_id",
  "message",
  "create_at",
  "update_at",
  "props",
  "pending_post_id",
]);
function prune(value: unknown, inPosts = false): unknown {
  if (Array.isArray(value)) return value.map((v) => prune(v));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (inPosts || keep.has(key)) out[key] = prune(child, key === "posts" && !inPosts);
  }
  return out;
}
const host = new URL(url).host;
const text = JSON.stringify(
  {
    source: `Mattermost 12.1 (mattermost/mattermost-preview), synthetic users and posts; captured on ${new Date().toISOString().slice(0, 10)} by scripts/capture.ts`,
    calls: calls.map((c) => ({ ...c, body: prune(c.body) })),
  },
  null,
  2,
)
  .replaceAll(url, "https://chat.example.com")
  .replaceAll(host, "chat.example.com");
await writeFile(new URL("../fixtures/api.json", import.meta.url), `${text}\n`);
console.log(`${calls.length} calls`);
