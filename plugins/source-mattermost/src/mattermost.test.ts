// The Mattermost adapter against responses captured from a real server (fixtures/api.json, see
// scripts/capture.ts), and one opt-in test against a running server (AW_E2E_MATTERMOST).
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MattermostSource, mentions, REPLY_PROP, SourceError } from "./mattermost.ts";

interface Call {
  method: string;
  path: string;
  status: number;
  body: unknown;
}

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/api.json", import.meta.url), "utf8"),
) as { calls: Call[] };

/** A fetch that answers each captured call by its method and path (with the query). */
function replay(calls: Call[], extra: Call[] = []): Call[] {
  const sent: Call[] = [];
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    const method = (init?.method ?? "GET").toLowerCase();
    const path = `${url.pathname}${url.search}`;
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    sent.push({ method, path, status: 0, body });
    if (method === "post" && path === "/api/v4/users/ids") {
      // The captured calls hold the users of each call: answer with the users of this call.
      const users = calls
        .filter((c) => c.path === path)
        .flatMap((c) => c.body as { id: string }[])
        .filter((u) => (body as string[]).includes(u.id));
      return Promise.resolve(
        new Response(JSON.stringify(users), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    const match = [...extra, ...calls].find(
      (c) => c.method.toLowerCase() === method && c.path === path,
    );
    if (!match) return Promise.resolve(new Response(`{"message":"no fixture"}`, { status: 404 }));
    return Promise.resolve(
      new Response(JSON.stringify(match.body), {
        status: match.status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const source = () => new MattermostSource({ url: "https://chat.example.com", token: "test-token" });

describe("MattermostSource with captured responses", () => {
  it("lists the conversations with their names and kinds", async () => {
    replay(fixture.calls);
    const conversations = await source().conversations();
    const byName = Object.fromEntries(conversations.map((c) => [c.name, c.kind]));
    expect(byName["~billing"]).toBe("channel");
    expect(byName["@lan.pham"]).toBe("direct");
    expect(byName["alex, lan.pham, minh.tran"]).toBe("group");
  });

  it("collects the posts with threads, mentions and no system posts", async () => {
    replay(fixture.calls);
    const s = source();
    const conversations = await s.conversations();
    const { messages, cursor } = await s.collect({
      conversations: conversations.map((c) => ({ id: c.id, since: 0 })),
    });
    const texts = messages.map((m) => m.text);
    expect(texts).toContain("Hi! Can partner keys get a higher rate limit than the default?");
    expect(texts.some((t) => t.includes("joined the channel"))).toBe(false);
    const mention = messages.find((m) => m.text.startsWith("@alex can you take this?"))!;
    expect(mention.mentions_me).toBe(true);
    expect(mention.thread).not.toBeNull();
    expect(mention.quote).toBe("Export CSV on /invoices gives a 500 since this morning");
    expect(mention.author).toBe("sam.lee");
    expect(mention.url).toMatch(/^https:\/\/chat\.example\.com\/acme\/pl\//);
    const standup = messages.find((m) => m.text.startsWith("Standup"))!;
    expect(standup.mentions_me).toBe(false);
    // The cursor of each conversation is the newest post time that it read, system posts too.
    const billing = conversations.find((c) => c.name === "~billing")!;
    expect(cursor[billing.id]).toBeGreaterThanOrEqual(Date.parse(standup.at));
  });

  it("posts a reply with the reply id as pending_post_id and prop", async () => {
    const sent = replay(fixture.calls, [
      {
        method: "post",
        path: "/api/v4/posts",
        status: 201,
        body: { id: "newpost", channel_id: "c1", root_id: "r1", message: "Yes", create_at: 1 },
      },
    ]);
    const result = await source().post({
      conversation: "c1",
      root: "r1",
      text: "Yes",
      pendingId: "01a20400-0000-7000-8000-000000000952",
    });
    expect(result.post).toBe("newpost");
    const body = sent.find((c) => c.path === "/api/v4/posts")!.body as Record<string, unknown>;
    expect(body.pending_post_id).toBe("01a20400-0000-7000-8000-000000000952");
    expect(body.props).toEqual({ [REPLY_PROP]: "01a20400-0000-7000-8000-000000000952" });
    expect(body.root_id).toBe("r1");
  });

  it("finds no pending post when no post has the reply id", async () => {
    replay(fixture.calls);
    const s = source();
    const billing = (await s.conversations()).find((c) => c.name === "~billing")!;
    expect(await s.findPending(billing.id, "01a20400-0000-7000-8000-000000000999")).toBeNull();
  });

  it("maps 401 to unauthorized", async () => {
    replay(
      [],
      [
        {
          method: "get",
          path: "/api/v4/users/me",
          status: 401,
          // The error body of Mattermost has the status code (Client4 reads it from there).
          body: { id: "api.context.session_expired.app_error", message: "x", status_code: 401 },
        },
      ],
    );
    await expect(source().me()).rejects.toMatchObject({ code: "unauthorized" });
    await expect(source().me()).rejects.toBeInstanceOf(SourceError);
  });
});

describe("mentions", () => {
  it.each([
    ["@alex can you look?", true],
    ["thanks @alex.", true],
    ["@channel standup", true],
    ["mail alex@example.com", false],
    ["@alexander hi", false],
    ["@alex-bot hi", false],
  ])("%s → %s", (text, expected) => {
    expect(mentions(text, "alex")).toBe(expected);
  });
});

// Opt-in: AW_E2E_MATTERMOST=http://127.0.0.1:18065 AW_E2E_MATTERMOST_TOKEN=<token of alex>.
const live = process.env.AW_E2E_MATTERMOST;
describe.runIf(live)("MattermostSource against a running server", () => {
  it("posts once for a repeated reply id, and findPending finds the post", async () => {
    const s = new MattermostSource({ url: live!, token: process.env.AW_E2E_MATTERMOST_TOKEN! });
    const billing = (await s.conversations()).find((c) => c.name === "~billing")!;
    const pendingId = `01a20400-0000-7000-8000-${String(Date.now()).slice(-12)}`;
    const first = await s.post({ conversation: billing.id, root: null, text: "probe", pendingId });
    const second = await s.post({ conversation: billing.id, root: null, text: "probe", pendingId });
    expect(second.post).toBe(first.post);
    expect((await s.findPending(billing.id, pendingId))?.post).toBe(first.post);
  });
});
