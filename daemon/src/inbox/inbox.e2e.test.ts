// End-to-end tests of the Inbox on the collecting device (openspec inbox-mattermost, test plan 3):
// awd with a fake source (the shape of the Mattermost plugin) and the fake agent in tmux as the
// triage session. The real Mattermost runs in the opt-in test of plugins/source-mattermost and in
// the e2e suite.
import { InboxClient } from "@aw/client/inbox-api";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { startSessionDaemon, TEST_TMUX, type SessionTestDaemon } from "../sessions/testing.ts";
import { waitFor } from "../testing.ts";
import { FakeSource } from "./testing.ts";

let awd: SessionTestDaemon | null = null;

/** The log lines of the inbox, the collector state and the triage screen: the text of a failure. */
async function dump(d: SessionTestDaemon): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const id = d.server.daemon.workspace("acme").id;
  const state = await readFile(join(d.home, "inbox", id, "state.json"), "utf8").catch(() => "-");
  const screen = await d.host
    .list()
    .then(async (panes) => {
      const pane = panes.find((p) => p.name === "aw-triage");
      return pane
        ? d.host.capture({ host: "tmux", ...pane, pgid: pane.pid }, 40)
        : "no triage pane";
    })
    .catch((error: unknown) => String(error));
  const lines = d
    .logLines()
    .map((l) => JSON.stringify(l))
    .filter(
      (l) => /inbox|triage|source|mcp/i.test(l) && !/incoming request|request completed/.test(l),
    )
    .slice(-30);
  const parsed = JSON.parse(state === "-" ? "{}" : state) as { triage_session?: string };
  const session = parsed.triage_session;
  const token = session
    ? (
        await readFile(join(d.home, "sessions", session, "mcp-token"), "utf8").catch(() => "-")
      ).trim()
    : "-";
  const triage = d.server.daemon.inbox.triageOf(token);
  return `TOKEN: ${token.slice(0, 8)} triageOf=${JSON.stringify(triage)} known=${d.server.daemon.inbox.tokens.size}\nLOG:\n${lines.join("\n")}\nSTATE:\n${state.slice(0, 3000)}\nSCREEN:\n${screen}`;
}

async function until(d: SessionTestDaemon, check: () => Promise<boolean>, ms = 30_000) {
  try {
    await waitFor(check, ms);
  } catch (error) {
    throw new Error(`${(error as Error).message}\n${await dump(d)}`, { cause: error });
  }
}
afterEach(async () => {
  await awd?.close();
  awd = null;
});

const NOW = Date.now();
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

async function setup(source: FakeSource): Promise<SessionTestDaemon> {
  const d = await startSessionDaemon({ openSource: () => source, inboxTickMs: 200 });
  const added = await d.aw(["credential", "add", "mattermost-alex"], {
    stdin: () => Promise.resolve("test-token-not-real\n"),
  });
  expect(added.code).toBe(0);
  return d;
}

async function configure(d: SessionTestDaemon): Promise<void> {
  // One write with the read levels: ~billing all (project billing-api), ~random off, the DM the
  // default. A first read before the levels would move the cursor past the messages.
  const service = d.server.daemon.workspace("acme");
  const { configureSource } = await import("./service.ts");
  await configureSource(service, "mattermost", {
    name: "Mattermost",
    server_url: "https://chat.example.com",
    credential: "mattermost-alex",
    collector: "macbook-pro",
    conversations: [
      { id: "ch-billing", name: "~billing", kind: "channel", read: "all", project: "billing-api" },
      { id: "ch-random", name: "~random", kind: "channel", read: "off", project: null },
    ],
  });
  // The CLI shows the source.
  const shown = await d.aw(["source", "show"]);
  expect(shown.stdout).toContain("collects on: macbook-pro");
}

describe.skipIf(!TEST_TMUX)("Inbox on the collecting device", () => {
  it("collects, sorts a batch into cards, answers an ask, and posts a reply once", async () => {
    const source = new FakeSource();
    source.add({
      id: "m1",
      conversation: "dm-lan",
      text: "Which Node version runs on staging?",
      at: iso(30),
    });
    source.add({
      id: "m2",
      conversation: "ch-billing",
      text: "Export CSV fails with error 500",
      at: iso(20),
      author: "minh.tran",
    });
    source.add({
      id: "m3",
      conversation: "ch-billing",
      thread: "m2",
      text: "@alex can you fix it today?",
      at: iso(19),
      author: "sam.lee",
    });
    source.add({ id: "m4", conversation: "ch-random", text: "Lunch?", at: iso(10) });
    source.add({ id: "old", conversation: "dm-lan", text: "From last week", at: iso(60 * 24 * 7) });
    awd = await setup(source);
    await configure(awd);

    const run = await awd.aw(["inbox", "run"]);
    expect(run.code, run.stderr).toBe(0);
    const cards = async () => (await awd!.aw(["inbox", "list", "--all", "--json"])).stdout;
    const list = async () =>
      JSON.parse(await cards()) as {
        card: string;
        category: string;
        urgency: string;
        project: string | null;
        conversation: { name: string };
        messages: { id: string; text: string }[];
      }[];
    await until(awd, async () => (await list()).length === 2, 30_000);
    const all = await list();
    const billing = all.find((c) => c.conversation.name === "~billing")!;
    const dm = all.find((c) => c.conversation.name === "@lan.pham")!;
    // One thread is one card; the words of the source; the project of the conversation.
    expect(billing.messages.map((m) => m.id)).toEqual(["m2", "m3"]);
    expect(billing.messages[1]!.text).toBe("@alex can you fix it today?");
    expect(billing.category).toBe("action");
    expect(billing.urgency).toBe("high");
    expect(billing.project).toBe("billing-api");
    expect(dm.category).toBe("question");
    expect(dm.project).toBeNull();
    // The triage token sees only the triage tools (spec mcp-server "Triage token and tools").
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const id = awd.server.daemon.workspace("acme").id;
    const state = JSON.parse(await readFile(join(awd.home, "inbox", id, "state.json"), "utf8")) as {
      triage_session: string;
    };
    const token = (
      await readFile(join(awd.home, "sessions", state.triage_session, "mcp-token"), "utf8")
    ).trim();
    const client = new Client({ name: "inbox-e2e", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${awd.server.mcp!.port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "card_add",
        "card_update",
        "inbox_answer",
        "inbox_batch",
        "inbox_done",
      ]);
      const bad = await client.callTool({
        name: "card_update",
        arguments: { card: billing.card, project: "nope" },
      });
      expect(bad.isError).toBe(true);
      expect(JSON.stringify(bad.content)).toContain("No project nope");
    } finally {
      await client.close();
    }

    // ~random is off, and a message older than 1 day is not read.
    expect(all.flatMap((c) => c.messages.map((m) => m.id))).not.toContain("m4");
    expect(all.flatMap((c) => c.messages.map((m) => m.id))).not.toContain("old");

    // Ask the agent: the answer comes back on the card.
    const asked = await awd.aw(["inbox", "ask", dm.card.slice(-8), "Make it shorter"]);
    expect(asked.code, asked.stderr).toBe(0);
    await until(
      awd,
      async () => {
        const card = await new InboxClient(awd!.client).card("acme", dm.card);
        return card.chat.some(
          (c) =>
            c.kind === "answer" &&
            c.text === "Got: Which Node version runs on staging?: Make it shorter",
        );
      },
      30_000,
    );

    // A reply: the first post fails with a network error after the server took it; the retry
    // finds the post by its reply id and posts nothing more.
    source.failNext = 1;
    const replied = await awd.aw(["inbox", "reply", dm.card.slice(-8), "Staging runs Node 26."]);
    expect(replied.code, replied.stderr).toBe(0);
    await until(
      awd,
      async () => {
        const card = await new InboxClient(awd!.client).card("acme", dm.card);
        return card.replies[0]?.state === "sent";
      },
      30_000,
    );
    expect(source.posts.map((p) => p.text)).toEqual(["Staging runs Node 26."]);

    // A new message in the thread brings the done card back as unread.
    await awd.aw(["inbox", "done", billing.card.slice(-8)]);
    source.add({
      id: "m5",
      conversation: "ch-billing",
      thread: "m2",
      text: "Any news?",
      at: new Date().toISOString(),
      author: "sam.lee",
    });
    await awd.aw(["inbox", "run"]);
    await until(
      awd,
      async () => {
        const card = (await list()).find((c) => c.card === billing.card) as unknown as {
          done: boolean;
          read: boolean;
          messages: { id: string }[];
        };
        return card.messages.some((m) => m.id === "m5") && !card.done && !card.read;
      },
      30_000,
    );
    expect((await list()).length).toBe(2);
  }, 120_000);

  it("creates the task of a card, and refuses a card task with no project", async () => {
    const source = new FakeSource();
    source.add({ id: "m1", conversation: "dm-lan", text: "Please fix the export", at: iso(5) });
    awd = await setup(source);
    await configure(awd);
    await awd.aw(["inbox", "run"]);
    let card = "";
    await until(
      awd,
      async () => {
        const cards = await new InboxClient(awd!.client).cards("acme");
        card = cards[0]?.card ?? "";
        return card !== "";
      },
      30_000,
    );
    const inbox = new InboxClient(awd.client);
    const none = await inbox
      .createTask("acme", card, { title: "Fix the export", first_message: "Fix it" } as never)
      .catch((error: { status: number }) => error.status);
    expect(none).toBe(400);
    const made = await inbox.createTask("acme", card, {
      project: "billing-api",
      title: "Fix the export",
      first_message: "Fix it",
    });
    expect(made.key).toMatch(/^[A-Z]+-\d+$/);
    const task = await awd.client.task("acme", made.task);
    expect(task.links).toContain(`inbox:${card}`);
  }, 120_000);

  it("reads the last day again when the read level of a conversation changes", async () => {
    const source = new FakeSource();
    source.add({
      id: "b1",
      conversation: "ch-billing",
      text: "Export CSV fails",
      at: iso(30),
      author: "minh.tran",
    });
    source.add({
      id: "b2",
      conversation: "ch-billing",
      text: "@alex can you look?",
      at: iso(20),
      author: "sam.lee",
    });
    awd = await setup(source);
    const service = awd.server.daemon.workspace("acme");
    const { configureSource, getSource } = await import("./service.ts");
    // First the default level "mentions" for ~billing: only b2 passes.
    await configureSource(service, "mattermost", {
      name: "Mattermost",
      server_url: "https://chat.example.com",
      credential: "mattermost-alex",
      collector: "macbook-pro",
    });
    await awd.aw(["inbox", "run"]);
    const ids = async () =>
      (await new InboxClient(awd!.client).cards("acme", { state: "all" })).flatMap((c) =>
        c.messages.map((m) => m.id),
      );
    await until(awd, async () => (await ids()).includes("b2"));
    expect(await ids()).not.toContain("b1");
    // Then "all": the collector reads the last day of ~billing again and finds b1, once.
    const current = getSource(service, "mattermost");
    await configureSource(service, "mattermost", {
      name: current.name,
      server_url: current.server_url,
      credential: current.credential,
      collector: current.collector,
      conversations: [
        { id: "ch-billing", name: "~billing", kind: "channel", read: "all", project: null },
      ],
    });
    await awd.aw(["inbox", "run"]);
    await until(awd, async () => (await ids()).includes("b1"));
    expect((await ids()).filter((id) => id === "b2")).toHaveLength(1);
  }, 120_000);
});
