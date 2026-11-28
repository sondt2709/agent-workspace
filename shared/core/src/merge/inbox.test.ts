// The rules of the Inbox fold that the review of PR #8 added (openspec inbox-mattermost): the
// choice of a person wins over a later change of the triage agent, the project has its own event,
// and only the collecting device writes cards.
import type { AwEvent } from "@aw/schema";
import { describe, expect, it } from "vitest";
import { InboxAccumulator } from "./inbox.ts";

const CARD = "01a20400-0000-7000-8000-000000000901";
let n = 0;

function event(dev: string, by: string, type: string, data: Record<string, unknown>): AwEvent {
  n += 1;
  return {
    v: 1,
    id: `01a20400-0000-7000-8000-${String(n).padStart(12, "0")}`,
    hlc: `2026-11-27T10:${String(n).padStart(2, "0")}:00.000Z#0000`,
    dev,
    type,
    by,
    data,
  } as unknown as AwEvent;
}

function fold(events: AwEvent[]) {
  const inbox = new InboxAccumulator();
  const decisions = events.map((e) => inbox.apply(e, { event: e.id, dev: e.dev, hlc: e.hlc }));
  return { decisions, cards: inbox.result().cards };
}

const configured = (collector: string) =>
  event("macbook-pro", "human@macbook-pro", "source.configured", {
    source: "mattermost",
    kind: "mattermost",
    name: "Mattermost",
    server_url: "https://chat.example.com",
    credential: "mattermost-alex",
    collector,
    username: "alex",
    read_every_s: 60,
    channels: "selected",
    conversations: [],
    triage: {
      model: "haiku",
      every_min: 15,
      days: [1, 2, 3, 4, 5],
      from: "08:00",
      to: "20:00",
      instruction: "",
      paused: false,
    },
    removed: false,
  });

const added = (dev = "ubuntu-01") =>
  event(dev, `aw@${dev}`, "inbox.card_added", {
    card: CARD,
    source: "mattermost",
    conversation: { id: "ch-billing", name: "~billing", kind: "channel" },
    thread: "p1",
    project: null,
    category: "question",
    urgency: "normal",
    title: "Export fails",
    summary: "",
    task: { title: "Fix the export", project: null, first_message: "Fix it." },
    answer: null,
    messages: [
      {
        id: "p1",
        author: "minh",
        at: "2026-11-27T09:00:00.000Z",
        text: "500",
        url: null,
        quote: null,
      },
    ],
  });

const updated = (data: Record<string, unknown>, dev = "ubuntu-01") =>
  event(dev, `aw@${dev}`, "inbox.card_updated", { card: CARD, messages: [], ...data });

describe("Inbox fold: the person decides", () => {
  it("keeps the category of a person when the agent changes the card later", () => {
    const { cards } = fold([
      configured("ubuntu-01"),
      added(),
      event("pixel-9", "human@pixel-9", "inbox.card_set", { card: CARD, category: "action" }),
      updated({ category: "info", urgency: "high" }),
    ]);
    expect(cards[0]!.category).toBe("action");
    // The other fields of the agent still apply.
    expect(cards[0]!.urgency).toBe("high");
  });

  it("sets the project with inbox.card_project, also to null, and the agent does not undo it", () => {
    const { decisions, cards } = fold([
      configured("ubuntu-01"),
      added(),
      event("pixel-9", "human@pixel-9", "inbox.card_project", {
        card: CARD,
        project: "billing-api",
      }),
      updated({ project: "demo-api" }),
    ]);
    expect(decisions.map((d) => d.reason)).toEqual([null, null, null, null]);
    expect(cards[0]!.project).toBe("billing-api");
    // The task suggestion with no project follows the project of the person.
    expect(cards[0]!.task?.project).toBe("billing-api");

    const cleared = fold([
      configured("ubuntu-01"),
      added(),
      updated({ project: "demo-api" }),
      event("pixel-9", "human@pixel-9", "inbox.card_project", { card: CARD, project: null }),
    ]);
    expect(cleared.cards[0]!.project).toBeNull();
  });

  it("ignores a project in inbox.card_set: a read on the phone never changes the project", () => {
    const { cards } = fold([
      configured("ubuntu-01"),
      added(),
      updated({ project: "billing-api" }),
      event("pixel-9", "human@pixel-9", "inbox.card_set", {
        card: CARD,
        read: true,
        project: null,
      }),
    ]);
    expect(cards[0]!.read).toBe(true);
    expect(cards[0]!.project).toBe("billing-api");
  });
});

describe("Inbox fold: only the collecting device writes cards", () => {
  it("refuses the card events of a computer that does not collect the source", () => {
    const { decisions, cards } = fold([
      configured("ubuntu-01"),
      added("mac-mini-lab"),
      added(),
      updated({ title: "Changed by another computer" }, "mac-mini-lab"),
    ]);
    expect(decisions.map((d) => d.reason)).toEqual([null, "not_collector", null, "not_collector"]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.title).toBe("Export fails");
  });

  it("accepts the events of the old collecting device from before the move", () => {
    const { decisions } = fold([
      configured("ubuntu-01"),
      added(),
      configured("macbook-pro"),
      updated({ title: "Late update of ubuntu-01" }),
      updated({ title: "Update of the new collecting device" }, "macbook-pro"),
    ]);
    expect(decisions.map((d) => d.reason)).toEqual([null, null, null, "not_collector", null]);
  });
});
