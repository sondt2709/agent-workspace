// The inbox and source routes of the local API (openspec inbox-mattermost, spec local-api "Inbox
// routes"): the request and reply schemas, and the client. awd checks each request with these
// schemas and generates contracts/openapi.yaml from them. Each route is a person route.
import { z } from "zod";
import type { AwClient } from "./index.ts";

const selector = z.string().min(1).max(128);
const slug = z
  .string()
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const entry = z
  .string()
  .max(63)
  .regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/);
const category = z.enum(["action", "question", "info"]);
const readLevel = z.enum(["all", "mentions", "off"]);

// ---- Inputs -------------------------------------------------------------------------------

export const inboxParams = z.object({
  ws: selector.describe("The workspace id or name. `-` selects the only workspace."),
});
export const cardParams = inboxParams.extend({
  card: selector.describe("The card id or an id prefix of 8+ characters"),
});
export const sourceParams = inboxParams.extend({ source: entry });
export const cardListQuery = z.object({
  state: z.enum(["open", "done", "all"]).optional(),
  unread: z.enum(["true", "false"]).optional(),
});
export const cardStateBody = z
  .object({
    read: z.boolean().optional(),
    done: z.boolean().optional(),
    category: category.optional(),
    project: slug.nullable().optional(),
  })
  .strict();
export const cardAskBody = z.object({ text: z.string().min(1).max(8000) }).strict();
export const cardReplyBody = z
  .object({ text: z.string().min(1).max(16000), in_thread: z.boolean().optional() })
  .strict();
export const cardTaskBody = z
  .object({
    project: slug.describe("Required: a task always has a project"),
    title: z.string().min(1).max(500),
    first_message: z.string().min(1).max(60000),
    assignee: z.string().min(1).max(127).nullable().optional(),
  })
  .strict();
export const runBody = z.object({ source: entry.optional() }).strict();
export const sourceBody = z
  .object({
    name: z.string().min(1).max(200),
    server_url: z.url({ protocol: /^https?$/ }).max(2000),
    credential: entry,
    collector: slug.nullable(),
    username: z.string().min(1).max(100).nullable().optional(),
    read_every_s: z.int().min(15).max(3600).optional(),
    default_read: readLevel.optional(),
    conversations: z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          name: z.string().min(1).max(200),
          kind: z.enum(["direct", "group", "channel"]),
          read: readLevel,
          project: slug.nullable().optional(),
        }),
      )
      .max(5000)
      .optional(),
    triage: z
      .object({
        model: z.string().min(1).max(100).optional(),
        every_min: z.int().min(1).max(1440).optional(),
        days: z.array(z.int().min(1).max(7)).max(7).optional(),
        from: z.string().nullable().optional(),
        to: z.string().nullable().optional(),
        instruction: z.string().max(8000).optional(),
        paused: z.boolean().optional(),
      })
      .optional(),
    removed: z.boolean().optional(),
  })
  .strict();

// ---- Replies ------------------------------------------------------------------------------

const ref = z.looseObject({ event: z.string(), dev: z.string(), hlc: z.string() });

export const cardMessageView = z.looseObject({
  id: z.string(),
  author: z.string(),
  at: z.string(),
  text: z.string(),
  url: z.string().nullable(),
  quote: z.string().nullable(),
});

export const cardView = z
  .looseObject({
    card: z.string(),
    source: z.string(),
    conversation: z.looseObject({ id: z.string(), name: z.string(), kind: z.string() }),
    thread: z.string().nullable(),
    project: z.string().nullable(),
    category,
    urgency: z.enum(["high", "normal", "low"]),
    title: z.string(),
    summary: z.string(),
    task: z
      .looseObject({ title: z.string(), project: z.string().nullable(), first_message: z.string() })
      .nullable(),
    answer: z.looseObject({ text: z.string(), from: z.string().nullable() }).nullable(),
    messages: z.array(cardMessageView),
    last_message_at: z.string(),
    read: z.boolean(),
    done: z.boolean(),
    added: ref,
    updated_hlc: z.string(),
    chat: z.array(
      z.looseObject({
        kind: z.enum(["ask", "answer", "task"]),
        id: z.string(),
        text: z.string(),
        by: z.string().nullable(),
        hlc: z.string(),
        answered: z.boolean().optional(),
      }),
    ),
    replies: z.array(
      z.looseObject({
        reply: z.string(),
        text: z.string(),
        in_thread: z.boolean(),
        state: z.enum(["requested", "sent", "failed"]),
        post: z.string().nullable(),
        url: z.string().nullable(),
        error: z.string().nullable(),
        result_hlc: z.string().nullable(),
      }),
    ),
    tasks: z.array(z.string()),
  })
  .meta({ id: "InboxCard" });
export type InboxCard = z.infer<typeof cardView>;

export const sourceView = z
  .looseObject({
    source: z.string(),
    kind: z.string(),
    name: z.string(),
    server_url: z.string(),
    credential: z.string(),
    collector: z.string().nullable(),
    username: z.string().nullable(),
    read_every_s: z.number(),
    default_read: readLevel,
    conversations: z.array(
      z.looseObject({
        id: z.string(),
        name: z.string(),
        kind: z.string(),
        read: readLevel,
        project: z.string().nullable(),
      }),
    ),
    triage: z.looseObject({
      model: z.string(),
      every_min: z.number(),
      days: z.array(z.number()),
      from: z.string().nullable(),
      to: z.string().nullable(),
      instruction: z.string(),
      paused: z.boolean(),
    }),
    removed: z.boolean(),
    configured: ref,
    run_requested: ref.nullable(),
  })
  .meta({ id: "InboxSource" });
export type InboxSource = z.infer<typeof sourceView>;

/** The state of the collector of a source, from the health of the collecting device. */
export const sourceStatus = z
  .looseObject({
    source: z.string(),
    collector: z.string().nullable(),
    /** The `inbox` part of `health.yaml` of the collecting device, or null. */
    health: z
      .looseObject({
        last_read_at: z.string().nullable(),
        last_batch_at: z.string().nullable(),
        waiting: z.number(),
        triage: z.string(),
        error: z.string().nullable(),
      })
      .nullable(),
    /** The account of the token: only when this device tests the connection. */
    user: z.looseObject({ id: z.string(), username: z.string() }).nullable(),
  })
  .meta({ id: "InboxSourceStatus" });
export type InboxSourceStatus = z.infer<typeof sourceStatus>;

export const conversationsReply = z
  .array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      kind: z.string(),
      last_message_at: z.string().nullable(),
    }),
  )
  .meta({ id: "InboxConversations" });
export type InboxConversation = z.infer<typeof conversationsReply>[number];

export const askReply = z.looseObject({ ask: z.string(), card: cardView });
export const replyReply = z.looseObject({ reply: z.string(), card: cardView });
export const cardTaskReply = z.looseObject({ task: z.string(), key: z.string(), card: cardView });
export const okReply = z.looseObject({ ok: z.boolean() });

export type CardStateInput = z.infer<typeof cardStateBody>;
export type CardTaskInput = z.infer<typeof cardTaskBody>;
export type SourceInput = z.infer<typeof sourceBody>;

/** The input of a source from its view: the base of a change of one field. */
export function sourceInputOf(source: InboxSource): SourceInput {
  return {
    name: source.name,
    server_url: source.server_url,
    credential: source.credential,
    collector: source.collector,
    username: source.username,
    read_every_s: source.read_every_s,
    default_read: source.default_read,
    conversations: source.conversations.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind as "direct" | "group" | "channel",
      read: c.read,
      project: c.project,
    })),
    triage: { ...source.triage },
    removed: source.removed,
  };
}

// ---- Client -------------------------------------------------------------------------------

const encode = encodeURIComponent;

export class InboxClient {
  readonly #client: AwClient;

  constructor(client: AwClient) {
    this.#client = client;
  }

  #base(ws: string): string {
    return `/v1/workspaces/${encode(ws)}`;
  }

  cards = (ws: string, query: z.infer<typeof cardListQuery> = {}) =>
    this.#client.request<InboxCard[]>("GET", `${this.#base(ws)}/inbox/cards`, z.array(cardView), {
      query,
    });
  card = (ws: string, card: string) =>
    this.#client.request<InboxCard>(
      "GET",
      `${this.#base(ws)}/inbox/cards/${encode(card)}`,
      cardView,
    );
  setState = (ws: string, card: string, body: CardStateInput) =>
    this.#client.request<InboxCard>(
      "POST",
      `${this.#base(ws)}/inbox/cards/${encode(card)}/state`,
      cardView,
      { body },
    );
  ask = (ws: string, card: string, text: string) =>
    this.#client.request<z.infer<typeof askReply>>(
      "POST",
      `${this.#base(ws)}/inbox/cards/${encode(card)}/ask`,
      askReply,
      { body: { text } },
    );
  reply = (ws: string, card: string, text: string, inThread = true) =>
    this.#client.request<z.infer<typeof replyReply>>(
      "POST",
      `${this.#base(ws)}/inbox/cards/${encode(card)}/reply`,
      replyReply,
      { body: { text, in_thread: inThread } },
    );
  createTask = (ws: string, card: string, body: CardTaskInput) =>
    this.#client.request<z.infer<typeof cardTaskReply>>(
      "POST",
      `${this.#base(ws)}/inbox/cards/${encode(card)}/task`,
      cardTaskReply,
      { body },
    );
  run = (ws: string, source?: string) =>
    this.#client.request<z.infer<typeof okReply>>("POST", `${this.#base(ws)}/inbox/run`, okReply, {
      body: source === undefined ? {} : { source },
    });
  sources = (ws: string) =>
    this.#client.request<InboxSource[]>("GET", `${this.#base(ws)}/sources`, z.array(sourceView));
  setSource = (ws: string, source: string, body: SourceInput) =>
    this.#client.request<InboxSource>(
      "PUT",
      `${this.#base(ws)}/sources/${encode(source)}`,
      sourceView,
      { body },
    );
  conversations = (ws: string, source: string) =>
    this.#client.request<InboxConversation[]>(
      "GET",
      `${this.#base(ws)}/sources/${encode(source)}/conversations`,
      conversationsReply,
    );
  status = (ws: string, source: string) =>
    this.#client.request<InboxSourceStatus>(
      "GET",
      `${this.#base(ws)}/sources/${encode(source)}/status`,
      sourceStatus,
    );
}
