// The Inbox commands of the aw CLI (openspec inbox-mattermost, spec aw-cli "Inbox and source
// commands"): `aw inbox …` and `aw source …`. They call the inbox routes of the local API.
import type { AwClient } from "@aw/client";
import { InboxClient, sourceInputOf, type InboxCard, type InboxSource } from "@aw/client/inbox-api";
import type { Command } from "@commander-js/extra-typings";

export interface InboxCommandContext {
  client: AwClient;
  wsName: () => string;
  print: (value: unknown, text: () => string) => void;
  inputError: (message: string) => Error;
}

const URGENCY: Record<string, string> = { high: "high  ", normal: "normal", low: "low   " };

/** One line of a card: the short id, the category, the urgency, the project and the title. */
export function cardLine(card: InboxCard): string {
  const flags = `${card.read ? " " : "*"}${card.done ? "d" : " "}`;
  return `${card.card.slice(-8)} ${flags} ${card.category.padEnd(8)} ${URGENCY[card.urgency] ?? card.urgency} ${(card.project ?? "-").padEnd(14)} ${card.title}`;
}

export function cardText(card: InboxCard): string {
  const lines = [
    `${card.title}`,
    `${card.category} · ${card.urgency} · ${card.project ?? "no project"} · ${card.conversation.name} · ${card.read ? "read" : "unread"}${card.done ? " · done" : ""}`,
    "",
    card.summary,
  ];
  if (card.task)
    lines.push("", `Suggested task: ${card.task.title} (${card.task.project ?? "no project"})`);
  if (card.answer) lines.push("", `Suggested answer: ${card.answer.text}`);
  lines.push("", "Messages:");
  for (const m of card.messages)
    lines.push(`  ${m.at.slice(0, 16).replace("T", " ")} ${m.author}: ${m.text}`);
  for (const c of card.chat) lines.push(`  [${c.kind}] ${c.text}`);
  for (const r of card.replies)
    lines.push(`  [reply ${r.state}] ${r.text}${r.url ? ` ${r.url}` : ""}`);
  return lines.join("\n");
}

function sourceText(source: InboxSource): string {
  return [
    `${source.source}: ${source.name} ${source.server_url}${source.username ? ` as @${source.username}` : ""}`,
    `collects on: ${source.collector ?? "no device"} · every ${source.read_every_s} s · channels ${source.channels}`,
    `triage: ${source.triage.model}, every ${source.triage.every_min} min${source.triage.paused ? ", paused" : ""}`,
    ...source.conversations.map(
      (c) =>
        `  ${c.read.padEnd(8)} ${(c.projects.join(",") || "-").padEnd(14)} ${c.name} (${c.kind})`,
    ),
  ].join("\n");
}

export function addInboxCommands(program: Command, ctx: InboxCommandContext): void {
  const inbox = new InboxClient(ctx.client);
  const group = program.command("inbox").description("The cards of the incoming messages");

  group
    .command("list")
    .description("List the open cards")
    .option("--unread", "only the unread cards")
    .option("--all", "also the done cards")
    .action(async (options) => {
      const cards = await inbox.cards(ctx.wsName(), {
        state: options.all ? "all" : "open",
        ...(options.unread ? { unread: "true" } : {}),
      });
      ctx.print(cards, () => (cards.length === 0 ? "No cards" : cards.map(cardLine).join("\n")));
    });

  group
    .command("show")
    .description("Print a card with its messages")
    .argument("<card>", "the card id or its last 8 characters")
    .action(async (card) => {
      const value = await inbox.card(ctx.wsName(), card);
      ctx.print(value, () => cardText(value));
    });

  const state = (name: string, description: string, body: Record<string, boolean>) =>
    group
      .command(name)
      .description(description)
      .argument("<card>", "the card id or its last 8 characters")
      .action(async (card) => {
        const value = await inbox.setState(ctx.wsName(), card, body);
        ctx.print(value, () => cardLine(value));
      });
  state("read", "Mark a card read", { read: true });
  state("unread", "Mark a card unread", { read: false });
  state("done", "Mark a card done", { done: true });
  state("undone", "Mark a card not done", { done: false });

  group
    .command("reply")
    .description("Send a reply to the thread of the card (the collecting device posts it)")
    .argument("<card>", "the card id or its last 8 characters")
    .argument("<text>", "the reply")
    .option("--channel", "post in the conversation, not in the thread")
    .action(async (card, text, options) => {
      const value = await inbox.reply(ctx.wsName(), card, text, !options.channel);
      ctx.print(value, () => `Reply ${value.reply} waits for the collecting device`);
    });

  group
    .command("ask")
    .description("Ask the triage agent about a card")
    .argument("<card>", "the card id or its last 8 characters")
    .argument("<text>", "the question")
    .action(async (card, text) => {
      const value = await inbox.ask(ctx.wsName(), card, text);
      ctx.print(value, () => `Ask ${value.ask} sent`);
    });

  group
    .command("run")
    .description("Read the source and send the waiting messages now")
    .action(async () => {
      const value = await inbox.run(ctx.wsName());
      ctx.print(value, () => "Run requested");
    });

  const source = program.command("source").description("The sources of the Inbox");

  source
    .command("show")
    .description("Print the sources")
    .action(async () => {
      const list = await inbox.sources(ctx.wsName());
      ctx.print(list, () => (list.length === 0 ? "No source" : list.map(sourceText).join("\n\n")));
    });

  source
    .command("set")
    .description("Add or change the Mattermost source")
    .argument("<kind>", "mattermost")
    .requiredOption("--url <url>", "the server, for example https://chat.example.com")
    .requiredOption("--credential <name>", "the credential that holds the personal access token")
    .requiredOption("--collector <device>", "the computer that reads the source")
    .option("--model <model>", "the model of the triage session", "haiku")
    .option("--channels <mode>", "selected: read only the channels with a level; all: each channel")
    .action(async (kind, options) => {
      if (kind !== "mattermost") throw ctx.inputError("Only the kind mattermost exists");
      if (options.channels !== undefined && !["selected", "all"].includes(options.channels)) {
        throw ctx.inputError("The channel mode is selected or all");
      }
      const list = await inbox.sources(ctx.wsName());
      const old = list.find((s) => s.source === kind);
      const value = await inbox.setSource(ctx.wsName(), kind, {
        name: old?.name ?? "Mattermost",
        server_url: options.url,
        credential: options.credential,
        collector: options.collector,
        ...(old ? { conversations: sourceInputOf(old).conversations } : {}),
        channels:
          (options.channels as "selected" | "all" | undefined) ?? old?.channels ?? "selected",
        triage: { ...(old?.triage ?? {}), model: options.model },
      });
      ctx.print(value, () => sourceText(value));
    });

  source
    .command("conversations")
    .description("List the conversations that the account can read")
    .argument("[source]", "the source", "mattermost")
    .action(async (id) => {
      const list = await inbox.conversations(ctx.wsName(), id);
      ctx.print(list, () => list.map((c) => `${c.id}  ${c.kind.padEnd(8)} ${c.name}`).join("\n"));
    });

  source
    .command("read")
    .description("Set the read level and the projects of a conversation")
    .argument("<conversation>", "the conversation id or name, for example ~billing")
    .argument("<level>", "all, tagged or off")
    .option("--project <slug...>", "the projects of its cards; replaces the old projects")
    .option("--source <source>", "the source", "mattermost")
    .action(async (conversation, level, options) => {
      if (!["all", "tagged", "off"].includes(level)) {
        throw ctx.inputError("The level is all, tagged or off");
      }
      const ws = ctx.wsName();
      const current = (await inbox.sources(ws)).find((s) => s.source === options.source);
      if (!current) throw ctx.inputError(`No source ${options.source}`);
      const known = await inbox.conversations(ws, options.source);
      const found = known.find((c) => c.id === conversation || c.name === conversation);
      if (!found) throw ctx.inputError(`No conversation ${conversation}`);
      const rows = sourceInputOf(current).conversations!.filter((c) => c.id !== found.id);
      rows.push({
        id: found.id,
        name: found.name,
        kind: found.kind as "direct" | "group" | "channel",
        read: level as "all" | "tagged" | "off",
        projects:
          options.project ?? current.conversations.find((c) => c.id === found.id)?.projects ?? [],
      });
      const value = await inbox.setSource(ws, options.source, {
        ...sourceInputOf(current),
        conversations: rows,
      });
      ctx.print(value, () => sourceText(value));
    });
}
