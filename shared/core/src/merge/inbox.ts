// The fold of the sources and the Inbox cards of the workspace log (openspec inbox-mattermost,
// design 3). A person writes the configuration and the card actions; awd (not a person) writes the
// cards, the answers and the reply results. The newest value of a field wins in merge order.
import type { AwEvent, EventOf } from "@aw/schema";
import type { Decision } from "./task.ts";
import { isHuman } from "./task.ts";
import type { CardChatItem, CardReplyView, CardView, EventRef, SourceView } from "./view.ts";

export const INBOX_EVENT_TYPES = new Set<string>([
  "source.configured",
  "inbox.run_requested",
  "inbox.card_added",
  "inbox.card_updated",
  "inbox.card_set",
  "inbox.card_project",
  "inbox.ask",
  "inbox.answer",
  "inbox.reply_requested",
  "inbox.reply_result",
  "inbox.task_created",
]);

export interface InboxFold {
  sources: SourceView[];
  cards: CardView[];
}

type Message = EventOf<"inbox.card_added">["data"]["messages"][number];

/** Adds the messages that the card does not have yet; true when one was new. */
function addMessages(card: CardView, messages: readonly Message[]): boolean {
  const known = new Set(card.messages.map((m) => m.id));
  let added = false;
  for (const message of messages) {
    if (known.has(message.id)) continue;
    known.add(message.id);
    card.messages.push(structuredClone(message));
    added = true;
  }
  if (added) {
    card.messages.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    card.last_message_at = card.messages[card.messages.length - 1]!.at;
  }
  return added;
}

/** The accumulator of the inbox events. */
export class InboxAccumulator {
  readonly #sources = new Map<string, SourceView>();
  readonly #cards = new Map<string, CardView>();
  readonly #replies = new Map<string, CardReplyView>();
  /** The cards whose category or project a person set: the triage agent no longer changes it. */
  readonly #personCategory = new Set<string>();
  readonly #personProject = new Set<string>();

  /**
   * True when the device collects the source at this point of the merge order: only the collecting
   * device writes cards, answers and reply results (design 4).
   */
  #collects(source: string, dev: string): boolean {
    return this.#sources.get(source)?.collector === dev;
  }

  /** Applies one inbox event, in merge order. */
  apply(e: AwEvent, ref: EventRef): Decision {
    const ok: Decision = { applied: true, reason: null };
    const reject = (reason: string): Decision => ({ applied: false, reason });
    const human = isHuman(e.by);
    const actor = e.by ?? null;
    switch (e.type) {
      case "source.configured": {
        if (!human) return reject("not_human");
        const before = this.#sources.get(e.data.source);
        this.#sources.set(e.data.source, {
          ...structuredClone(e.data),
          configured: ref,
          run_requested: before?.run_requested ?? null,
        });
        return ok;
      }
      case "inbox.run_requested": {
        if (!human) return reject("not_human");
        const source = this.#sources.get(e.data.source);
        if (!source) return reject("unknown_source");
        source.run_requested = ref;
        return ok;
      }
      case "inbox.card_added": {
        if (human) return reject("not_agent");
        if (!this.#collects(e.data.source, e.dev)) return reject("not_collector");
        if (this.#cards.has(e.data.card)) return reject("duplicate_card");
        const d = e.data;
        const card: CardView = {
          card: d.card,
          source: d.source,
          conversation: structuredClone(d.conversation),
          thread: d.thread,
          project: d.project,
          category: d.category,
          urgency: d.urgency,
          title: d.title,
          summary: d.summary,
          task: structuredClone(d.task),
          answer: structuredClone(d.answer),
          messages: [],
          last_message_at: d.messages[0]!.at,
          read: false,
          done: false,
          added: ref,
          updated_hlc: e.hlc,
          chat: [],
          replies: [],
          tasks: [],
        };
        addMessages(card, d.messages);
        this.#cards.set(d.card, card);
        return ok;
      }
      case "inbox.card_updated": {
        if (human) return reject("not_agent");
        const card = this.#cards.get(e.data.card);
        if (!card) return reject("unknown_card");
        if (!this.#collects(card.source, e.dev)) return reject("not_collector");
        const d = e.data;
        if (d.project !== undefined && !this.#personProject.has(card.card)) {
          card.project = d.project;
        }
        if (d.category !== undefined && !this.#personCategory.has(card.card)) {
          card.category = d.category;
        }
        if (d.urgency !== undefined) card.urgency = d.urgency;
        if (d.title !== undefined) card.title = d.title;
        if (d.summary !== undefined) card.summary = d.summary;
        if (d.task !== undefined) card.task = structuredClone(d.task);
        if (d.answer !== undefined) card.answer = structuredClone(d.answer);
        if (addMessages(card, d.messages)) {
          // A new message brings the card back (spec inbox-cards "Cards").
          card.read = false;
          card.done = false;
        }
        card.updated_hlc = e.hlc;
        return ok;
      }
      case "inbox.card_set": {
        if (!human) return reject("not_human");
        const card = this.#cards.get(e.data.card);
        if (!card) return reject("unknown_card");
        const d = e.data;
        if (d.read !== undefined) card.read = d.read;
        if (d.done !== undefined) card.done = d.done;
        if (d.category !== undefined) {
          card.category = d.category;
          this.#personCategory.add(card.card);
          if (d.category === "action" && card.task === null) {
            card.task = {
              title: card.title,
              project: card.project,
              first_message: firstMessage(card),
            };
          }
        }
        card.updated_hlc = e.hlc;
        return ok;
      }
      case "inbox.card_project": {
        if (!human) return reject("not_human");
        const card = this.#cards.get(e.data.card);
        if (!card) return reject("unknown_card");
        // A task suggestion with no project, or with the old project, follows the new project.
        if (card.task && (card.task.project === null || card.task.project === card.project)) {
          card.task.project = e.data.project;
        }
        card.project = e.data.project;
        this.#personProject.add(card.card);
        card.updated_hlc = e.hlc;
        return ok;
      }
      case "inbox.ask":
      case "inbox.answer":
      case "inbox.task_created": {
        const wantsHuman = e.type !== "inbox.answer";
        if (human !== wantsHuman) return reject(wantsHuman ? "not_human" : "not_agent");
        const card = this.#cards.get(e.data.card);
        if (!card) return reject("unknown_card");
        if (e.type === "inbox.answer" && !this.#collects(card.source, e.dev)) {
          return reject("not_collector");
        }
        const item: CardChatItem =
          e.type === "inbox.task_created"
            ? { kind: "task", id: e.data.task, text: "", by: actor, ...ref }
            : {
                kind: e.type === "inbox.ask" ? "ask" : "answer",
                id: e.data.ask,
                text: e.data.text,
                by: actor,
                ...ref,
              };
        if (e.type === "inbox.answer") {
          const ask = card.chat.find((c) => c.kind === "ask" && c.id === e.data.ask);
          if (!ask) return reject("unknown_ask");
          ask.answered = true;
        }
        if (e.type === "inbox.ask") item.answered = false;
        if (e.type === "inbox.task_created" && !card.tasks.includes(e.data.task)) {
          card.tasks.push(e.data.task);
        }
        card.chat.push(item);
        return ok;
      }
      case "inbox.reply_requested": {
        if (!human) return reject("not_human");
        const card = this.#cards.get(e.data.card);
        if (!card) return reject("unknown_card");
        if (this.#replies.has(e.data.reply)) return reject("duplicate_reply");
        const reply: CardReplyView = {
          reply: e.data.reply,
          text: e.data.text,
          in_thread: e.data.in_thread,
          requested: ref,
          by: actor,
          state: "requested",
          post: null,
          url: null,
          error: null,
          result_hlc: null,
        };
        this.#replies.set(reply.reply, reply);
        card.replies.push(reply);
        return ok;
      }
      case "inbox.reply_result": {
        if (human) return reject("not_agent");
        const reply = this.#replies.get(e.data.reply);
        if (!reply) return reject("unknown_reply");
        const owner = this.#cards.get(e.data.card);
        if (!owner || !owner.replies.includes(reply)) return reject("unknown_reply");
        if (!this.#collects(owner.source, e.dev)) return reject("not_collector");
        // A sent reply stays sent: a later failure of a retry does not undo it.
        if (reply.state === "sent") return reject("already_sent");
        reply.state = e.data.state;
        reply.post = e.data.post;
        reply.url = e.data.url;
        reply.error = e.data.error;
        reply.result_hlc = e.hlc;
        return ok;
      }
      default:
        return reject("wrong_log");
    }
  }

  result(): InboxFold {
    const sources = [...this.#sources.values()].sort((a, b) =>
      a.source < b.source ? -1 : a.source > b.source ? 1 : 0,
    );
    // The newest message first; the card id breaks a tie.
    const cards = [...this.#cards.values()].sort((a, b) =>
      a.last_message_at !== b.last_message_at
        ? a.last_message_at < b.last_message_at
          ? 1
          : -1
        : a.card < b.card
          ? -1
          : 1,
    );
    return { sources, cards };
  }
}

/** The first message of a task made from a card with no suggestion: the quoted messages. */
export function firstMessage(card: Pick<CardView, "title" | "conversation" | "messages">): string {
  const quoted = card.messages
    .map((m) => `> ${m.author} (${m.at.slice(0, 16).replace("T", " ")}): ${m.text}`)
    .join("\n");
  return `${card.title}\n\nSource: ${card.conversation.name}\n${quoted}`.slice(0, 20000);
}
