// `aw terminal <task>` (openspec task-terminal-view): the newest terminal snapshot of a task with its
// device and capture time, or the note, and the command that opens the terminal of the session. It
// prints the person route `GET /v1/workspaces/{ws}/tasks/{task}/terminal`; the CLI refuses it in a
// session.
import type { AwClient } from "@aw/client";
import { DesktopClient } from "@aw/client/desktop";
import type { TerminalReply } from "@aw/client/terminal";
import { systemClock } from "@aw/core";
import type { Command } from "@commander-js/extra-typings";

/** "ubuntu-01 · captured 2026-11-23 14:20:05 UTC (3 min ago)". */
function captured(device: string, at: string | null, now: number): string {
  if (at === null) return `${device} · capture time not known`;
  const s = Math.max(0, Math.floor((now - Date.parse(at)) / 1000));
  const age =
    s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`;
  return `${device} · captured ${at.slice(0, 19).replace("T", " ")} UTC (${age} ago)`;
}

export function formatTerminal(reply: TerminalReply, now: number): string {
  const lines: string[] = [];
  if (reply.snapshot) {
    lines.push(captured(reply.snapshot.device, reply.snapshot.captured_at, now), "");
    lines.push(reply.snapshot.text, "");
  }
  if (reply.note) lines.push(reply.note);
  const open = reply.open;
  if (open?.kind === "copy")
    lines.push(open.command ? `Open the terminal: ${open.command}` : open.text);
  else if (open) lines.push(`Open the terminal: ${open.command}`);
  return lines.join("\n").trimEnd();
}

export interface TerminalCommandContext {
  client: AwClient;
  workspace: () => string;
  print: (value: unknown, text: () => string) => void;
  /** The clock time in ms; default the clock module. */
  now?: () => number;
}

export function addTerminalCommand(program: Command, ctx: TerminalCommandContext): void {
  program
    .command("terminal")
    .description(
      "Show the newest terminal snapshot of a task, and the command that opens the terminal of its session",
    )
    .argument("<task>", "The task key, id or id prefix")
    .action(async (task) => {
      const reply = await new DesktopClient(ctx.client).terminal(ctx.workspace(), task);
      ctx.print(reply, () => formatTerminal(reply, (ctx.now ?? (() => systemClock.now()))()));
    });
}
