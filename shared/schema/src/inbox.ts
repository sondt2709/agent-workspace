// The data of the source and inbox events of the workspace log (openspec inbox-mattermost, design 3).
// A person writes the configuration and the card actions; the awd of the collecting device writes
// the cards, the answers and the reply results.
import { z } from "zod";
import { deviceSlug, entryName, isoTime, projectSlug, uuidv7 } from "./common.ts";

/** The longest text of one message of a card (design 3). */
export const MAX_CARD_MESSAGE_CHARS = 8000;
/** The most messages of one card (design 3). */
export const MAX_CARD_MESSAGES = 200;

/** A source id, for example `mattermost`. */
export const sourceId = entryName;
export const sourceKind = z.enum(["mattermost"]);
/** The read level of a conversation (design 5). `tagged`: the messages for the person. */
export const readLevel = z.enum(["all", "tagged", "off"]);
/** Which channels a source reads with no level of their own (design 5). */
export const channelMode = z.enum(["selected", "all"]);
export const conversationKind = z.enum(["direct", "group", "channel"]);
export const cardCategory = z.enum(["action", "question", "info"]);
export const cardUrgency = z.enum(["high", "normal", "low"]);

const shortText = z.string().min(1).max(500);
const conversationId = z.string().min(1).max(200);
const messageId = z.string().min(1).max(200);

/** The most projects of one conversation. */
export const MAX_CONVERSATION_PROJECTS = 20;

/** A conversation of a source with its read level and its projects (zero or more, design 5). */
export const sourceConversation = z.looseObject({
  id: conversationId,
  name: z.string().min(1).max(200),
  kind: conversationKind,
  read: readLevel,
  projects: z.array(projectSlug).max(MAX_CONVERSATION_PROJECTS).default([]),
});

const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();

/** The triage session and its batch schedule: every `every_min` minutes in the hours of the days. */
export const sourceTriage = z.looseObject({
  /** The `--model` of the triage session, for example `haiku`. */
  model: z.string().min(1).max(100).default("haiku"),
  every_min: z.int().min(1).max(1440).default(15),
  /** ISO weekdays, 1 Monday to 7 Sunday. Empty: each day. */
  days: z.array(z.int().min(1).max(7)).max(7).default([1, 2, 3, 4, 5]),
  /** `HH:MM` local time of the collecting device; null for each hour. */
  from: clockTime.default("08:00"),
  to: clockTime.default("20:00"),
  instruction: z.string().max(8000).default(""),
  paused: z.boolean().default(false),
});

/** `source.configured`: the whole configuration of one source. The newest wins (design 4). */
export const sourceConfigured = z.looseObject({
  source: sourceId,
  kind: sourceKind,
  name: z.string().min(1).max(200),
  server_url: z.url({ protocol: /^https?$/ }).max(2000),
  /** The credential that holds the token: a name only. */
  credential: entryName,
  /** The one collecting device (a computer), or null when no device collects. */
  collector: deviceSlug.nullable(),
  /** The user of the token, for example `alex`, as the last connection test saw it. */
  username: z.string().min(1).max(100).nullable().default(null),
  read_every_s: z.int().min(15).max(3600).default(60),
  /** `selected`: a channel with no level is not read; `all`: it is read with the level `tagged`. */
  channels: channelMode.default("selected"),
  conversations: z.array(sourceConversation).max(5000).default([]),
  triage: sourceTriage.default({
    model: "haiku",
    every_min: 15,
    days: [1, 2, 3, 4, 5],
    from: "08:00",
    to: "20:00",
    instruction: "",
    paused: false,
  }),
  removed: z.boolean().default(false),
});

/** One original message of a card, word for word (principle 8). */
export const cardMessage = z.looseObject({
  id: messageId,
  author: z.string().min(1).max(200),
  at: isoTime,
  text: z.string().max(MAX_CARD_MESSAGE_CHARS),
  url: z.string().max(2000).nullable().default(null),
  /** The first characters of the quoted message, when the message replies to one. */
  quote: z.string().max(500).nullable().default(null),
});

export const cardTaskSuggestion = z.looseObject({
  title: shortText,
  project: projectSlug.nullable().default(null),
  first_message: z.string().min(1).max(20000),
});

export const cardAnswerSuggestion = z.looseObject({
  text: z.string().min(1).max(8000),
  /** Where the answer comes from, for example `rate-limits.md`. */
  from: z.string().max(500).nullable().default(null),
});

const cardFields = {
  project: projectSlug.nullable(),
  category: cardCategory,
  urgency: cardUrgency,
  title: shortText,
  summary: z.string().max(4000),
  task: cardTaskSuggestion.nullable(),
  answer: cardAnswerSuggestion.nullable(),
};

export const cardConversation = z.looseObject({
  id: conversationId,
  name: z.string().min(1).max(200),
  kind: conversationKind,
});

export const inboxEventData = {
  /** A person writes the whole source configuration. */
  "source.configured": sourceConfigured,
  /** A person asks the collecting device to read and send now ("Run now"). */
  "inbox.run_requested": z.looseObject({ source: sourceId }),
  "inbox.card_added": z.looseObject({
    card: uuidv7,
    source: sourceId,
    conversation: cardConversation,
    /** The root post of the thread, or null for a message with no thread. */
    thread: messageId.nullable(),
    project: cardFields.project.default(null),
    category: cardFields.category,
    urgency: cardFields.urgency.default("normal"),
    title: cardFields.title,
    summary: cardFields.summary.default(""),
    task: cardFields.task.default(null),
    answer: cardFields.answer.default(null),
    messages: z.array(cardMessage).min(1).max(MAX_CARD_MESSAGES),
  }),
  /** The triage session changes a card; `messages` are new messages of its thread. */
  "inbox.card_updated": z.looseObject({
    card: uuidv7,
    project: cardFields.project.optional(),
    category: cardFields.category.optional(),
    urgency: cardFields.urgency.optional(),
    title: cardFields.title.optional(),
    summary: cardFields.summary.optional(),
    task: cardFields.task.optional(),
    answer: cardFields.answer.optional(),
    messages: z.array(cardMessage).max(MAX_CARD_MESSAGES).default([]),
  }),
  /**
   * A person action on a card. Each field that is set wins over older values. A category of a
   * person also wins over each later change of the triage agent.
   */
  "inbox.card_set": z.looseObject({
    card: uuidv7,
    read: z.boolean().optional(),
    done: z.boolean().optional(),
    category: cardFields.category.optional(),
  }),
  /**
   * A person sets the project of a card, or null for no project. It is its own event, so a read or
   * a done never writes a project (each client can write a field that is null). The project of a
   * person wins over each later change of the triage agent.
   */
  "inbox.card_project": z.looseObject({ card: uuidv7, project: cardFields.project }),
  "inbox.ask": z.looseObject({ card: uuidv7, ask: uuidv7, text: z.string().min(1).max(8000) }),
  "inbox.answer": z.looseObject({ card: uuidv7, ask: uuidv7, text: z.string().min(1).max(8000) }),
  "inbox.reply_requested": z.looseObject({
    card: uuidv7,
    reply: uuidv7,
    text: z.string().min(1).max(16000),
    in_thread: z.boolean().default(true),
  }),
  "inbox.reply_result": z.looseObject({
    card: uuidv7,
    reply: uuidv7,
    state: z.enum(["sent", "failed"]),
    post: messageId.nullable().default(null),
    url: z.string().max(2000).nullable().default(null),
    error: z.string().max(2000).nullable().default(null),
  }),
  "inbox.task_created": z.looseObject({ card: uuidv7, task: uuidv7 }),
} as const;

/** The `inbox` part of device health: the state of the collector of this device. */
export const healthInbox = z.looseObject({
  source: sourceId,
  last_read_at: isoTime.nullable().default(null),
  last_batch_at: isoTime.nullable().default(null),
  waiting: z.int().min(0).default(0),
  triage: z.enum(["running", "waiting", "paused", "stopped"]),
  error: z.string().max(2000).nullable().default(null),
});

export type SourceConfigured = z.infer<typeof sourceConfigured>;
export type SourceConversation = z.infer<typeof sourceConversation>;
export type CardMessage = z.infer<typeof cardMessage>;
export type CardTaskSuggestion = z.infer<typeof cardTaskSuggestion>;
export type CardAnswerSuggestion = z.infer<typeof cardAnswerSuggestion>;
export type CardCategory = z.infer<typeof cardCategory>;
export type CardUrgency = z.infer<typeof cardUrgency>;
export type ConversationKind = z.infer<typeof conversationKind>;
export type ReadLevel = z.infer<typeof readLevel>;
export type HealthInbox = z.infer<typeof healthInbox>;
export type SourceTriage = z.infer<typeof sourceTriage>;
