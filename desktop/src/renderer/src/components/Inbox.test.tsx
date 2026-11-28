// The Inbox of the incoming messages (openspec inbox-mattermost, spec inbox-cards "Desktop Inbox"):
// the rows with the category icon, the filter bar, the card dialog with its keys, the task form
// with the required project, and the reply.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { InboxCard } from "../../../shared/channels.ts";
import { installBridge, PROJECT, renderApp, type Handlers } from "../testing.tsx";
import { Inbox } from "./Inbox.tsx";

afterEach(cleanup);

const ref = { event: "e", dev: "ubuntu-01", hlc: "2026-11-23T09:00:00.000Z#0000" };

function card(overrides: Partial<InboxCard>): InboxCard {
  return {
    card: "c1",
    source: "mattermost",
    conversation: { id: "dm-lan", name: "@lan.pham", kind: "direct" },
    thread: null,
    project: null,
    category: "question",
    urgency: "normal",
    title: "Which Node version runs on staging?",
    summary: "Minh asks for the Node version.",
    task: null,
    answer: { text: "Staging runs Node 26.", from: ".nvmrc" },
    messages: [
      {
        id: "m1",
        author: "minh.tran",
        at: "2026-11-23T09:57:00.000Z",
        text: "Which Node version do we run on staging now?",
        url: "https://chat.example.com/acme/pl/m1",
        quote: null,
      },
    ],
    last_message_at: "2026-11-23T09:57:00.000Z",
    read: false,
    done: false,
    added: ref,
    updated_hlc: ref.hlc,
    chat: [],
    replies: [],
    tasks: [],
    ...overrides,
  };
}

const QUESTION = card({});
const ACTION = card({
  card: "c2",
  category: "action",
  urgency: "high",
  title: "Invoice CSV export fails with error 500",
  conversation: { id: "ch-billing", name: "~billing", kind: "channel" },
  project: null,
  answer: null,
  task: { title: "Fix the CSV export", project: null, first_message: "Fix the error 500." },
  last_message_at: "2026-11-23T09:20:00.000Z",
});
const INFO = card({
  card: "c3",
  category: "info",
  urgency: "low",
  title: "Two approvals for each PR",
  project: "billing-api",
  answer: null,
  read: true,
  last_message_at: "2026-11-23T08:00:00.000Z",
});

const SOURCE = {
  source: "mattermost",
  kind: "mattermost",
  name: "Mattermost",
  server_url: "https://chat.example.com",
  credential: "mattermost-alex",
  collector: "ubuntu-01",
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
  configured: ref,
  run_requested: null,
};

function show(handlers: Handlers = {}, url = "/w/ws-1/inbox") {
  const cards = [QUESTION, ACTION, INFO];
  const call = installBridge({
    inboxCards: () => cards,
    sources: () => [SOURCE],
    sourceStatus: () => ({
      source: "mattermost",
      collector: "ubuntu-01",
      health: null,
      user: null,
    }),
    projects: () => [PROJECT],
    devices: () => [],
    setCardState: (args: { card: string }) => cards.find((c) => c.card === args.card),
    ...handlers,
  });
  const app = renderApp(<Inbox />, { route: "/w/:ws/inbox", url });
  return { call, ...app };
}

const rows = async () =>
  (await screen.findAllByRole("button", { name: /^(Action|Question|Info): / })).map((b) =>
    b.getAttribute("aria-label"),
  );

describe("Inbox list", () => {
  it("sorts the open cards by urgency, with the category as an icon label", async () => {
    show();
    expect(await rows()).toEqual([
      "Action: Invoice CSV export fails with error 500, unread",
      "Question: Which Node version runs on staging?, unread",
      "Info: Two approvals for each PR",
    ]);
    // Each category icon is one 24 × 24 box, so each title starts at the same place.
    for (const label of ["Action", "Question", "Info"]) {
      const icon = screen.getAllByRole("img", { name: label })[0]!;
      expect(getComputedStyle(icon).width).toBe("24px");
      expect(getComputedStyle(icon).height).toBe("24px");
    }
  });

  it("filters by category, by No project, and by unread", async () => {
    const { router } = show();
    await rows();
    await userEvent.click(screen.getByRole("button", { name: "Question 1" }));
    expect(await rows()).toEqual(["Question: Which Node version runs on staging?, unread"]);
    expect(router.state.location.search).toBe("?cat=question");
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    await userEvent.click(screen.getByRole("button", { name: "Project" }));
    const menu = await screen.findByRole("menu", { name: "Projects" });
    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Billing API" }));
    await userEvent.keyboard("{Escape}");
    await waitFor(async () => expect(await rows()).toEqual(["Info: Two approvals for each PR"]));
    await userEvent.click(screen.getByRole("button", { name: "Clear the project filter" }));
    await userEvent.click(screen.getByRole("button", { name: "Unread" }));
    await waitFor(async () => expect((await rows()).length).toBe(2));
  });

  it("shows No source yet with Add a source when no source and no card exist", async () => {
    installBridge({ inboxCards: () => [], sources: () => [] });
    const { router } = renderApp(<Inbox />, { route: "/w/:ws/inbox", url: "/w/ws-1/inbox" });
    await userEvent.click(await screen.findByRole("button", { name: "Add a source" }));
    expect(router.state.location.pathname).toBe("/w/ws-1/sources");
  });
});

describe("Card dialog", () => {
  it("opens a card, marks it read, and moves with j", async () => {
    const { call, router } = show();
    await userEvent.click(
      await screen.findByRole("button", { name: /^Question: Which Node version/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Which Node version runs on staging?",
    });
    expect(within(dialog).getByText("Staging runs Node 26.")).toBeTruthy();
    expect(within(dialog).getByText("Which Node version do we run on staging now?")).toBeTruthy();
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("setCardState", {
        ws: "ws-1",
        card: "c1",
        body: { read: true },
      }),
    );
    await userEvent.keyboard("j");
    expect(router.state.location.search).toBe("?card=c3");
    await userEvent.keyboard("k");
    expect(router.state.location.search).toBe("?card=c1");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sends the edited reply to the thread", async () => {
    const { call } = show(
      { replyCard: () => ({ reply: "r1", card: QUESTION }) },
      "/w/ws-1/inbox?card=c1",
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^Reply/ }));
    const field = within(dialog).getByRole("textbox", { name: "Reply" });
    await userEvent.clear(field);
    await userEvent.type(field, "Node 26, the same as CI.");
    expect(within(dialog).getByText("As @alex · @lan.pham · in the thread")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("replyCard", {
        ws: "ws-1",
        card: "c1",
        text: "Node 26, the same as CI.",
        in_thread: true,
      }),
    );
  });

  it("asks for a project before it creates the task of a card with no project", async () => {
    const { call } = show(
      { cardTask: () => ({ task: "t1", key: "AW-1", card: ACTION }) },
      "/w/ws-1/inbox?card=c2",
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Choose a project")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Create task…" }));
    const create = within(dialog).getByRole("button", { name: "Create task" });
    expect(create.hasAttribute("disabled")).toBe(true);
    await userEvent.click(within(dialog).getByRole("combobox", { name: /Project/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Billing API" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("cardTask", {
        ws: "ws-1",
        card: "c2",
        body: {
          title: "Fix the CSV export",
          project: "billing-api",
          first_message: "Fix the error 500.",
          assignee: null,
        },
      }),
    );
  });

  it("changes the category with the menu", async () => {
    const { call } = show({}, "/w/ws-1/inbox?card=c3");
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Info ▾" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Action/ }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("setCardState", {
        ws: "ws-1",
        card: "c3",
        body: { category: "action" },
      }),
    );
  });

  it("loads the answer of the new card when r opens the reply after j (no draft of the last card)", async () => {
    const second = card({
      card: "c4",
      title: "Which database runs on staging?",
      answer: { text: "Staging runs Postgres 18.", from: null },
      last_message_at: "2026-11-23T09:50:00.000Z",
    });
    show({ inboxCards: () => [QUESTION, second] }, "/w/ws-1/inbox?card=c1");
    const dialog = await screen.findByRole("dialog");
    await userEvent.keyboard("r");
    expect(within(dialog).getByRole<HTMLTextAreaElement>("textbox", { name: "Reply" }).value).toBe(
      "Staging runs Node 26.",
    );
    await userEvent.keyboard("{Escape}");
    await userEvent.click(await screen.findByRole("button", { name: /^Question: Which Node/ }));
    const again = await screen.findByRole("dialog");
    await userEvent.keyboard("j");
    await within(again).findByText("Which database runs on staging?");
    await userEvent.keyboard("r");
    expect(within(again).getByRole<HTMLTextAreaElement>("textbox", { name: "Reply" }).value).toBe(
      "Staging runs Postgres 18.",
    );
  });

  it("keeps the card when ↓ moves in the category menu", async () => {
    const { router } = show({}, "/w/ws-1/inbox?card=c1");
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Question ▾" }));
    await screen.findByRole("menu");
    await userEvent.keyboard("{ArrowDown}");
    expect(router.state.location.search).toBe("?card=c1");
  });

  it("goes to the next card after Done, when the done card leaves the list", async () => {
    const cards = [card({}), INFO];
    const { router } = show(
      {
        inboxCards: () => cards,
        setCardState: (args: { card: string; body: { done?: boolean } }) => {
          const c = cards.find((x) => x.card === args.card)!;
          if (args.body.done !== undefined) c.done = args.body.done;
          return c;
        },
      },
      "/w/ws-1/inbox?card=c1",
    );
    await screen.findByRole("dialog");
    await userEvent.keyboard("d");
    await waitFor(() => expect(router.state.location.search).toBe("?card=c3"));
  });

  it("keeps Previous and Next when the open card leaves the Unread list", async () => {
    const cards = [card({}), card({ card: "c5", title: "Second unread question" })];
    const { router } = show(
      {
        inboxCards: () => cards,
        setCardState: (args: { card: string; body: { read?: boolean } }) => {
          const c = cards.find((x) => x.card === args.card)!;
          if (args.body.read !== undefined) c.read = args.body.read;
          return c;
        },
      },
      "/w/ws-1/inbox?unread=1&card=c1",
    );
    const dialog = await screen.findByRole("dialog");
    // Opening marks c1 read, so it leaves the list of unread cards.
    await waitFor(() => expect(cards[0]!.read).toBe(true));
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Next (j)" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    await userEvent.keyboard("j");
    expect(new URLSearchParams(router.state.location.search).get("card")).toBe("c5");
  });

  it("changes the project with the project menu", async () => {
    const { call } = show({}, "/w/ws-1/inbox?card=c1");
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Project: No project ▾" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: PROJECT.name }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("setCardState", {
        ws: "ws-1",
        card: "c1",
        body: { project: PROJECT.slug },
      }),
    );
  });
});

describe("Run now key", () => {
  it("runs on ⇧⌘R, and leaves ⌘R to Sync now", async () => {
    const { call } = show({ inboxRun: () => ({ ok: true }) });
    await rows();
    await userEvent.keyboard("{Meta>}r{/Meta}");
    expect(call).not.toHaveBeenCalledWith("inboxRun", expect.anything());
    await userEvent.keyboard("{Meta>}{Shift>}R{/Shift}{/Meta}");
    await waitFor(() => expect(call).toHaveBeenCalledWith("inboxRun", { ws: "ws-1" }));
  });
});
