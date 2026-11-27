// The person actions of the Inbox service that the review of PR #8 changed (openspec
// inbox-mattermost): a project change is its own event, a card gives one task, and a second reply
// waits until the first one is sent.
import type { CardView } from "@aw/core";
import { describe, expect, it, vi } from "vitest";
import { ServiceError } from "../service/errors.ts";
import type { WorkspaceService } from "../service/workspace.ts";
import { createTaskFromCard, replyCard, setCardState } from "./service.ts";

const CARD = "01a20400-0000-7000-8000-000000000901";

function card(over: Partial<CardView> = {}): CardView {
  return {
    card: CARD,
    source: "mattermost",
    conversation: { id: "ch-billing", name: "~billing", kind: "channel" },
    thread: "p1",
    project: "billing-api",
    category: "action",
    urgency: "normal",
    title: "Export fails",
    summary: "",
    task: null,
    answer: null,
    messages: [],
    last_message_at: "2026-11-27T09:00:00.000Z",
    read: false,
    done: false,
    added: { event: "e", dev: "ubuntu-01", hlc: "h" },
    updated_hlc: "h",
    chat: [],
    replies: [],
    tasks: [],
    ...over,
  };
}

function fakeService(view: { cards: CardView[]; tasks?: { id: string; links: string[] }[] }) {
  const written: { type: string; data: Record<string, unknown> }[] = [];
  const createTask = vi.fn(() => Promise.resolve({ task: { id: "t-new", key: "AW-9" } }));
  const service = {
    device: { slug: "macbook-pro" },
    clock: { now: () => Date.parse("2026-11-27T10:00:00.000Z") },
    view: { projects: [{ slug: "billing-api" }], tasks: [], ...view },
    write: async (fn: (files: unknown) => Promise<unknown>) =>
      fn({
        writeEvent: (_path: string, type: string, data: Record<string, unknown>) => {
          written.push({ type, data });
          return Promise.resolve({ id: `e${written.length}` });
        },
      }),
    createTask,
  } as unknown as WorkspaceService;
  return { service, written, createTask };
}

describe("Inbox service: person actions", () => {
  it("writes a project change as inbox.card_project, and a read with no project", async () => {
    const { service, written } = fakeService({ cards: [card()] });
    await setCardState(service, CARD, { read: true });
    await setCardState(service, CARD, { project: null });
    expect(written).toEqual([
      { type: "inbox.card_set", data: { card: CARD, read: true } },
      { type: "inbox.card_project", data: { card: CARD, project: null } },
    ]);
  });

  it("refuses a second task of a card, also when only the task link shows it", async () => {
    const draft = { project: "billing-api", title: "Fix", first_message: "Fix it." };
    const withTask = fakeService({ cards: [card({ tasks: ["t-1"] })] });
    const error = await createTaskFromCard(withTask.service, CARD, draft).catch((e: unknown) => e);
    expect((error as ServiceError).code).toBe("conflict");
    expect(withTask.createTask).not.toHaveBeenCalled();

    // The task exists, but its inbox.task_created was not written (a failed write).
    const linked = fakeService({
      cards: [card()],
      tasks: [{ id: "t-2", links: [`inbox:${CARD}`] }],
    });
    const again = await createTaskFromCard(linked.service, CARD, draft).catch((e: unknown) => e);
    expect((again as ServiceError).code).toBe("conflict");
    expect(linked.createTask).not.toHaveBeenCalled();
  });

  it("refuses a reply while an earlier reply of the card is not sent", async () => {
    const pending = card({
      category: "question",
      replies: [
        {
          reply: "r1",
          text: "Yes",
          in_thread: true,
          requested: { event: "e", dev: "macbook-pro", hlc: "h" },
          by: "human@macbook-pro",
          state: "requested",
          post: null,
          url: null,
          error: null,
          result_hlc: null,
        },
      ],
    });
    const { service, written } = fakeService({ cards: [pending] });
    const error = await replyCard(service, CARD, "Yes").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).code).toBe("conflict");
    expect(written).toEqual([]);
  });
});
