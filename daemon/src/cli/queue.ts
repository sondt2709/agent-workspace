// `aw queue` (openspec queue-and-assign): the queue of each agent with the position and the cause
// of each waiting task, and the tasks that need an assignee. It prints the person route
// `GET /v1/workspaces/{ws}/queues`; the CLI refuses it in a session.
import type { AwClient } from "@aw/client";
import { DesktopClient } from "@aw/client/desktop";
import type { QueuesReply } from "@aw/client/queues";
import type { Command } from "@commander-js/extra-typings";
import { ordinal } from "../continuity/queue-view.ts";

function table(rows: string[][]): string[] {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => r[i]!.length))) ?? [];
  return rows.map((r) =>
    `  ${r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]!))).join("  ")}`.trimEnd(),
  );
}

export function formatQueues(reply: QueuesReply): string {
  const lines: string[] = [];
  for (const queue of reply.agents) {
    const sessions = queue.working === 1 ? "session" : "sessions";
    lines.push(`${queue.agent} · ${queue.working} of ${queue.max_working} ${sessions} working`);
    lines.push(
      ...table(
        queue.tasks.map((t) => [
          t.position === null ? "-" : ordinal(t.position),
          t.key ?? t.task.slice(0, 8),
          t.title ?? "",
          t.cause.text,
        ]),
      ),
    );
  }
  if (lines.length === 0) lines.push("No task waits for a session.");
  if (reply.unassigned.length > 0) {
    lines.push("Needs an assignee:");
    lines.push(
      ...table(
        reply.unassigned.map((t) => [
          t.key ?? t.task.slice(0, 8),
          t.title ?? "",
          t.created_by ? `created by ${t.created_by}` : "",
        ]),
      ),
    );
  }
  return lines.join("\n");
}

export interface QueueCommandContext {
  client: AwClient;
  workspace: () => string;
  print: (value: unknown, text: () => string) => void;
}

export function addQueueCommand(program: Command, ctx: QueueCommandContext): void {
  program
    .command("queue")
    .description(
      "Show the tasks that wait for a session of each agent (position and cause), and the tasks that need an assignee",
    )
    .action(async () => {
      const reply = await new DesktopClient(ctx.client).queues(ctx.workspace());
      ctx.print(reply, () => formatQueues(reply));
    });
}
