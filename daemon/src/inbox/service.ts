// The Inbox service (openspec inbox-mattermost): the person actions on the sources and the cards,
// and the writes of the collecting awd. The local API, the `aw` CLI and the MCP tools of the triage
// session call these functions; no transport has logic of its own.
import type { CardView, SourceView } from "@aw/core";
import {
  MAX_CARD_MESSAGES,
  newId,
  type CardMessage,
  type EventData,
  type SourceConfigured,
} from "@aw/schema";
import { invalid, notFound, ServiceError } from "../service/errors.ts";
import type { WorkspaceService } from "../service/workspace.ts";

/** The longest JSON of the messages of one card event: under the 64 KiB line limit. */
const MESSAGES_PER_LINE_BYTES = 40_000;

function logPath(service: WorkspaceService): string {
  return `tasks/log/${service.device.slug}.jsonl`;
}

const person = (service: WorkspaceService) => `human@${service.device.slug}`;
const awd = (service: WorkspaceService) => `aw@${service.device.slug}`;

/** Writes one workspace event of this device. */
async function writeEvent<T extends Parameters<WorkspaceService["files"]["writeEvent"]>[1]>(
  service: WorkspaceService,
  type: T,
  data: unknown,
  by: string,
): Promise<string> {
  const event = await service.write(
    (files) => files.writeEvent(logPath(service), type, data as never, { by }),
    logPath(service),
  );
  return event.id;
}

// ---- Sources ------------------------------------------------------------------------------

/** The sources of the workspace that are not removed. */
export function listSources(service: WorkspaceService): SourceView[] {
  return service.view.sources.filter((s) => !s.removed);
}

export function getSource(service: WorkspaceService, id: string): SourceView {
  const source = listSources(service).find((s) => s.source === id);
  if (!source) throw notFound(`Source ${id}`);
  return source;
}

/** The source that this device collects, or null (design 4: one collecting device). */
export function collectedHere(service: WorkspaceService): SourceView | null {
  return listSources(service).find((s) => s.collector === service.device.slug) ?? null;
}

export type SourceInput = Omit<EventData<"source.configured">, "source" | "kind"> & {
  kind?: "mattermost";
};

/** Writes the whole configuration of a source (`source.configured`). */
export async function configureSource(
  service: WorkspaceService,
  id: string,
  input: SourceInput,
): Promise<SourceView> {
  const view = service.view;
  const collector = input.collector as string | null;
  if (collector !== null) {
    const device = view.devices.find((d) => d.slug === collector);
    if (!device) throw invalid(`No device ${collector} in this workspace`);
    // The phone never reads a source (spec inbox-sources "One collecting device").
    if (device.role === "mobile") {
      throw invalid(`${collector} is a phone. Select a computer as the collecting device.`);
    }
  }
  for (const conversation of (input.conversations ?? []) as { projects?: string[] }[]) {
    for (const project of conversation.projects ?? []) {
      if (!view.projects.some((p) => p.slug === project)) throw invalid(`No project ${project}`);
    }
  }
  await writeEvent(
    service,
    "source.configured",
    { ...input, source: id, kind: input.kind ?? "mattermost" },
    person(service),
  );
  return getSource(service, id);
}

/** "Run now": the collecting device reads and sends at once (`inbox.run_requested`). */
export async function requestRun(service: WorkspaceService, id?: string): Promise<void> {
  const sources = listSources(service);
  const source = id === undefined ? sources[0] : sources.find((s) => s.source === id);
  if (!source) throw notFound(id === undefined ? "A source" : `Source ${id}`);
  await writeEvent(service, "inbox.run_requested", { source: source.source }, person(service));
}

// ---- Cards: person actions ----------------------------------------------------------------

export interface CardListFilter {
  state?: "open" | "done" | "all";
  unread?: boolean;
}

export function listCards(service: WorkspaceService, filter: CardListFilter = {}): CardView[] {
  const state = filter.state ?? "open";
  return service.view.cards.filter(
    (c) =>
      (state === "all" || (state === "done" ? c.done : !c.done)) && (!filter.unread || !c.read),
  );
}

/** A card by its id or by the first 8 or more characters of its id. */
export function showCard(service: WorkspaceService, ref: string): CardView {
  const cards = service.view.cards;
  const exact = cards.find((c) => c.card === ref);
  if (exact) return exact;
  if (ref.length >= 8) {
    const matches = cards.filter((c) => c.card.startsWith(ref) || c.card.endsWith(ref));
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1)
      throw new ServiceError("ambiguous", `More than one card matches ${ref}`);
  }
  throw notFound(`Card ${ref}`);
}

export interface CardStateInput {
  read?: boolean;
  done?: boolean;
  category?: "action" | "question" | "info";
  project?: string | null;
}

export async function setCardState(
  service: WorkspaceService,
  ref: string,
  input: CardStateInput,
): Promise<CardView> {
  const card = showCard(service, ref);
  if (Object.values(input).every((v) => v === undefined)) throw invalid("Nothing to change");
  if (input.project && !service.view.projects.some((p) => p.slug === input.project)) {
    throw invalid(`No project ${input.project}`);
  }
  const { project, ...set } = input;
  const fields = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
  if (Object.keys(fields).length > 0) {
    await writeEvent(service, "inbox.card_set", { card: card.card, ...fields }, person(service));
  }
  // The project is its own event: a read or a done never writes a project.
  if (project !== undefined) {
    await writeEvent(service, "inbox.card_project", { card: card.card, project }, person(service));
  }
  return showCard(service, card.card);
}

export async function askCard(
  service: WorkspaceService,
  ref: string,
  text: string,
): Promise<{ ask: string; card: CardView }> {
  const card = showCard(service, ref);
  const ask = newId(service.clock);
  await writeEvent(service, "inbox.ask", { card: card.card, ask, text }, person(service));
  return { ask, card: showCard(service, card.card) };
}

export async function replyCard(
  service: WorkspaceService,
  ref: string,
  text: string,
  inThread = true,
): Promise<{ reply: string; card: CardView }> {
  const card = showCard(service, ref);
  // One reply at a time: a double click or a retry never posts twice.
  if (card.replies.some((r) => r.state === "requested")) {
    throw new ServiceError("conflict", "A reply of this card is not sent yet. Wait for it.");
  }
  const reply = newId(service.clock);
  await writeEvent(
    service,
    "inbox.reply_requested",
    { card: card.card, reply, text, in_thread: inThread },
    person(service),
  );
  return { reply, card: showCard(service, card.card) };
}

export interface CardTaskInput {
  /** Required: a task always has a project (decision of 2026-11-27). */
  project: string;
  title: string;
  first_message: string;
  assignee?: string | null;
}

/** Creates the task of a card with the link `inbox:<card>`, then `inbox.task_created`. */
export async function createTaskFromCard(
  service: WorkspaceService,
  ref: string,
  input: CardTaskInput,
): Promise<{ task: string; key: string; card: CardView }> {
  const card = showCard(service, ref);
  // One task for a card: also a task whose inbox.task_created was not written has the link.
  const link = `inbox:${card.card}`;
  const existing = card.tasks[0] ?? service.view.tasks.find((t) => t.links.includes(link))?.id;
  if (existing !== undefined) {
    throw new ServiceError("conflict", `This card already has the task ${existing}.`);
  }
  const result = await service.createTask(
    {
      project: input.project,
      title: input.title,
      first_message: input.first_message,
      assignee: input.assignee ?? null,
      links: [link],
    },
    person(service),
  );
  await writeEvent(
    service,
    "inbox.task_created",
    { card: card.card, task: result.task.id },
    person(service),
  );
  return {
    task: result.task.id,
    key: result.task.key ?? result.task.id,
    card: showCard(service, card.card),
  };
}

// ---- Cards: writes of the collecting awd ---------------------------------------------------

/** Splits messages into groups whose JSON fits one log line. */
export function messageChunks(messages: readonly CardMessage[]): CardMessage[][] {
  const chunks: CardMessage[][] = [];
  let current: CardMessage[] = [];
  let size = 0;
  for (const message of messages) {
    const bytes = Buffer.byteLength(JSON.stringify(message));
    if (current.length > 0 && (size + bytes > MESSAGES_PER_LINE_BYTES || current.length >= 50)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(message);
    size += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export type NewCard = Omit<EventData<"inbox.card_added">, "card" | "messages"> & {
  messages: CardMessage[];
};

/** Adds a card: one `inbox.card_added`, and `inbox.card_updated` lines for more messages. */
export async function addCard(service: WorkspaceService, input: NewCard): Promise<string> {
  const card = newId(service.clock);
  const [first, ...rest] = messageChunks(input.messages.slice(-MAX_CARD_MESSAGES));
  if (!first) throw invalid("A card needs one message or more");
  await writeEvent(service, "inbox.card_added", { ...input, card, messages: first }, awd(service));
  for (const chunk of rest) {
    await writeEvent(service, "inbox.card_updated", { card, messages: chunk }, awd(service));
  }
  return card;
}

export type CardChange = Omit<EventData<"inbox.card_updated">, "card" | "messages"> & {
  messages?: CardMessage[];
};

export async function updateCard(
  service: WorkspaceService,
  card: string,
  change: CardChange,
): Promise<void> {
  const { messages = [], ...fields } = change;
  const chunks = messageChunks(messages);
  const [first, ...rest] = chunks.length > 0 ? chunks : [[]];
  await writeEvent(
    service,
    "inbox.card_updated",
    { card, ...fields, messages: first },
    awd(service),
  );
  for (const chunk of rest) {
    await writeEvent(service, "inbox.card_updated", { card, messages: chunk }, awd(service));
  }
}

export async function answerAsk(
  service: WorkspaceService,
  card: string,
  ask: string,
  text: string,
): Promise<void> {
  await writeEvent(service, "inbox.answer", { card, ask, text }, awd(service));
}

export async function writeReplyResult(
  service: WorkspaceService,
  data: EventData<"inbox.reply_result">,
): Promise<void> {
  await writeEvent(service, "inbox.reply_result", data, awd(service));
}

export type { SourceConfigured };
