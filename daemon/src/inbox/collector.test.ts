// The triage session of the collector (openspec inbox-mattermost, spec inbox-triage "Triage
// session" and spec inbox-sources "Move to the remote device"): a move stops the session, and a
// failed resume (two timeouts with no pane) starts a new session at the next item.
import { FakeClock, type SourceView } from "@aw/core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "../log.ts";
import type { WorkspaceService } from "../service/workspace.ts";
import {
  batchThreads,
  cardMessages,
  Collector,
  ITEM_TIMEOUT_MS,
  levelOf,
  type TriageItem,
} from "./collector.ts";
import { FakeSource } from "./testing.ts";
import type { TriageSession } from "./triage.ts";

const ref = { event: "e1", dev: "macbook-pro", hlc: "2026-11-23T09:00:00.000Z#0000" };
const SOURCE = {
  source: "mattermost",
  kind: "mattermost",
  name: "Mattermost",
  server_url: "https://chat.example.com",
  credential: "mattermost-alex",
  collector: "macbook-pro",
  username: "alex",
  read_every_s: 60,
  channels: "selected",
  conversations: [],
  // No days and no hours: the schedule allows a batch at each time of the test.
  triage: {
    model: "haiku",
    every_min: 15,
    days: [],
    from: null,
    to: null,
    instruction: "",
    paused: false,
  },
  removed: false,
  configured: ref,
  run_requested: null,
} as unknown as SourceView;

/** A triage session whose pane never runs: each resume fails. */
class DeadTriage {
  readonly sent: string[] = [];
  started = false;
  stopped = 0;
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
  adopt() {}
  get pane() {
    return null;
  }
  alive() {
    return Promise.resolve(false);
  }
  send(text: string) {
    this.sent.push(text);
    this.started = true;
    return Promise.resolve();
  }
  stop() {
    this.stopped += 1;
    return Promise.resolve();
  }
}

const quiet = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger;
let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

function start() {
  const clock = new FakeClock("2026-11-23T10:00:00.000Z");
  const source = new FakeSource();
  source.add({
    id: "m1",
    conversation: "dm-lan",
    text: "Which Node version runs on staging?",
    at: new Date(clock.now() - 5 * 60_000).toISOString(),
  });
  const sessions: DeadTriage[] = [];
  const view = { sources: [SOURCE], cards: [] as unknown[] };
  const service = { device: { slug: "macbook-pro" }, view, clock } as unknown as WorkspaceService;
  const collector = new Collector({
    service,
    clock,
    log: quiet,
    stateDir: dir,
    openSource: () => Promise.resolve(source),
    triage: (id) => {
      const session = new DeadTriage(id);
      sessions.push(session);
      return session as unknown as TriageSession;
    },
  });
  return { clock, sessions, view, collector };
}

describe("Collector triage session", () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aw-collector-"));
  });

  it("stops the triage session when the person moves the source to another device", async () => {
    const { sessions, view, collector } = start();
    await collector.tick();
    expect(sessions.length).toBe(1);
    view.sources = [{ ...SOURCE, collector: "ubuntu-01" }];
    await collector.tick();
    expect(sessions[0]!.stopped).toBe(1);
    expect(collector.health()).toBeNull();
  });

  it("starts a new session after a failed resume", async () => {
    const { clock, sessions, collector } = start();
    await collector.tick();
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.sent).toEqual([expect.stringMatching(/^\[AW triage batch /)]);
    // The first timeout sends the item once more to the same session.
    clock.advance(ITEM_TIMEOUT_MS + 1);
    await collector.tick();
    expect(sessions[0]!.sent.length).toBe(2);
    // The second timeout: the pane does not run, so the session is dropped.
    clock.advance(ITEM_TIMEOUT_MS + 1);
    await collector.tick();
    // At the next schedule, the batch goes to a new session with a new id.
    clock.advance(15 * 60_000 + 1);
    await collector.tick();
    expect(sessions.length).toBe(2);
    expect(sessions[1]!.id).not.toBe(sessions[0]!.id);
    expect(sessions[1]!.sent).toEqual([expect.stringMatching(/^\[AW triage batch /)]);
  });

  it("looks for the post of an older reply before it posts, when it becomes the collecting device", async () => {
    // ubuntu-01 collected and posted the reply; the person moved the source to this device before
    // the reply result of ubuntu-01 reached it.
    const clock = new FakeClock("2026-11-23T10:00:00.000Z");
    const source = new FakeSource();
    await source.post({ conversation: "dm-lan", root: "m1", text: "Yes.", pendingId: "r1" });
    source.postCalls = 0;
    const card = {
      card: "c1",
      source: "mattermost",
      conversation: { id: "dm-lan", name: "@lan.pham", kind: "direct" },
      thread: "m1",
      messages: [],
      chat: [],
      replies: [{ reply: "r1", text: "Yes.", in_thread: true, state: "requested" }],
    };
    const written: { type: string; data: Record<string, unknown> }[] = [];
    const service = {
      device: { slug: "macbook-pro" },
      view: { sources: [SOURCE], cards: [card] },
      clock,
      write: async (fn: (files: unknown) => Promise<unknown>) =>
        fn({
          writeEvent: (_p: string, type: string, data: Record<string, unknown>) => {
            written.push({ type, data });
            return Promise.resolve({ id: "e1" });
          },
        }),
    } as unknown as WorkspaceService;
    const collector = new Collector({
      service,
      clock,
      log: quiet,
      stateDir: dir,
      openSource: () => Promise.resolve(source),
      triage: (id) => new DeadTriage(id) as unknown as TriageSession,
    });
    await collector.tick();
    expect(source.postCalls).toBe(0);
    const result = written.find((e) => e.type === "inbox.reply_result");
    expect(result?.data).toMatchObject({ reply: "r1", state: "sent", post: "post-1" });
  });
});

describe("Collector asks", () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aw-collector-"));
  });

  it("names the card of an ask in the input line, so the agent changes only that card", async () => {
    const { sessions, view, collector } = start();
    view.cards = [
      {
        card: "c1",
        source: "mattermost",
        conversation: { id: "dm-lan", name: "@lan.pham", kind: "direct" },
        title: "Partner limit",
        messages: [{ id: "m1" }],
        chat: [{ kind: "ask", id: "a1", text: "Make it shorter", answered: false }],
        replies: [],
      },
    ];
    await collector.tick();
    expect(sessions[0]!.sent[0]).toBe("[AW inbox ask a1 card c1] Partner limit: Make it shorter");
  });
});

describe("cardMessages", () => {
  it("refuses a message of another conversation than the card", () => {
    const message = (id: string, conversation: string) => ({
      id,
      conversation,
      conversation_name: conversation,
      conversation_kind: "channel" as const,
      thread: null,
      author: "minh",
      at: "2026-11-23T09:00:00.000Z",
      text: "x",
      url: null,
      quote: null,
    });
    const item: TriageItem = {
      kind: "batch",
      id: "b1",
      card: null,
      text: "",
      messages: [message("m1", "ch-billing"), message("m2", "dm-lan")],
      sent_at: 0,
      attempts: 1,
    };
    expect(cardMessages(item, ["m1"], "ch-billing").map((m) => m.id)).toEqual(["m1"]);
    expect(() => cardMessages(item, ["m1", "m2"], "ch-billing")).toThrow(
      "The message m2 is not of the conversation ch-billing",
    );
  });
});

describe("levelOf", () => {
  // Spec inbox-sources "Selected channels only".
  const with_ = (channels: "selected" | "all") =>
    ({
      ...SOURCE,
      channels,
      conversations: [
        { id: "ch-api", name: "~api-team", kind: "channel", read: "tagged", projects: [] },
        { id: "dm-off", name: "@lan.pham", kind: "direct", read: "off", projects: [] },
      ],
    }) as unknown as SourceView;

  it("reads only the selected channels and each direct message in the mode selected", () => {
    const source = with_("selected");
    expect(levelOf(source, { id: "ch-api", kind: "channel" })).toBe("tagged");
    expect(levelOf(source, { id: "ch-random", kind: "channel" })).toBe("off");
    expect(levelOf(source, { id: "dm-carson", kind: "direct" })).toBe("tagged");
    expect(levelOf(source, { id: "gm-team", kind: "group" })).toBe("tagged");
    expect(levelOf(source, { id: "dm-off", kind: "direct" })).toBe("off");
  });

  it("reads each channel with no level as tagged in the mode all", () => {
    expect(levelOf(with_("all"), { id: "ch-random", kind: "channel" })).toBe("tagged");
  });
});

describe("batchThreads", () => {
  it("gives the agent each project of the conversation", () => {
    const source = {
      ...SOURCE,
      conversations: [
        {
          id: "ch-billing",
          name: "~billing",
          kind: "channel",
          read: "all",
          projects: ["billing-api", "web"],
        },
      ],
    } as unknown as SourceView;
    const message = {
      id: "m1",
      conversation: "ch-billing",
      conversation_name: "~billing",
      conversation_kind: "channel" as const,
      thread: null,
      author: "minh",
      at: "2026-11-23T09:00:00.000Z",
      text: "Export CSV fails",
      url: null,
      quote: null,
    };
    expect(batchThreads([message], [], source)[0]!.projects).toEqual(["billing-api", "web"]);
  });
});
