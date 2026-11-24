// The text output of the aw commands. `--json` skips these functions and prints the reply as is.
import type {
  EventRow,
  GateEntry,
  Project,
  StatusReply,
  Task,
  ThreadPage,
  ThreadReply,
  WorkspaceSummary,
} from "@aw/client";
import { shownPauseText, type ShownPause } from "@aw/client/pause";

const dash = (value: string | null | undefined) =>
  value === null || value === undefined || value === "" ? "-" : value;

function table(rows: string[][]): string {
  if (rows.length === 0) return "";
  const widths = rows[0]!.map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? "").length)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]!)))
        .join("  "),
    )
    .join("\n");
}

export function formatStatus(status: StatusReply): string {
  const lines = [
    `awd ${status.version} on ${status.device.slug} (${status.device.role}), pid ${status.pid}, up ${status.uptime_s} s`,
    `Socket: ${status.socket}`,
    `Ready: ${status.ready ? "yes" : "no"}`,
  ];
  if (status.workspaces.length === 0)
    lines.push(
      'No workspace. Create one with "aw workspace init --name <name>" (in ~/AW, or --in <folder>).',
    );
  for (const ws of status.workspaces) {
    lines.push(
      `Workspace ${dash(ws.name)} (${ws.id}): ${ws.tasks} tasks, ${ws.open_gates} open gates, ${ws.issues} issues${ws.error ? `, error: ${ws.error}` : ""}`,
    );
    lines.push(`  Folder: ${ws.path}`);
    for (const notice of ws.notices)
      lines.push(`  Sync problem: ${notice.path} was ${notice.code} (${notice.at})`);
  }
  return lines.join("\n");
}

export function formatWorkspaces(list: WorkspaceSummary[]): string {
  if (list.length === 0) return "No workspace.";
  return table([
    ["NAME", "ID", "TASKS", "PATH"],
    ...list.map((ws) => [dash(ws.name), ws.id, String(ws.tasks), ws.path]),
  ]);
}

export function formatProjects(list: Project[]): string {
  if (list.length === 0) return "No project.";
  return table([
    ["SLUG", "NAME", "DEVICES", "TASKS"],
    ...list.map((p) => [p.slug, p.name, p.devices.join(",") || "-", String(p.tasks.length)]),
  ]);
}

function lane(task: Task): string {
  if (!task.needs_you_lane) return "";
  return `needs you: ${task.needs_you_reasons.map((r) => r.reason).join(", ")}`;
}

/** The shown pause of a task: the pause event, else the pause from the presence (`withPause`). */
function pauseOf(task: Task): ShownPause | null {
  return (task as Task & { paused?: ShownPause | null }).paused ?? null;
}

function pauseText(pause: ShownPause): string {
  return shownPauseText(pause, (cause) => cause.replaceAll("_", " "));
}

export function formatTasks(list: Task[]): string {
  if (list.length === 0) return "No task.";
  return table([
    ["KEY", "STAGE", "ASSIGNEE", "TITLE", "NEEDS YOU"],
    ...list.map((t) => [
      dash(t.key) + (t.key_state === "duplicate" ? "*" : "") + (t.archived ? " (archived)" : ""),
      t.stage + (pauseOf(t) ? ` (paused: ${pauseText(pauseOf(t)!)})` : ""),
      dash(t.assignee),
      dash(t.title),
      lane(t),
    ]),
  ]);
}

export function formatGate(gate: GateEntry | Task["gates"][number], indent = ""): string {
  const lines = [
    `${indent}Gate ${gate.gate} ${gate.kind} v${gate.version} ${gate.state}${gate.title ? `: ${gate.title}` : ""}`,
  ];
  if (gate.options.length > 0) lines.push(`${indent}  Options: ${gate.options.join(" | ")}`);
  if (gate.answer !== null) lines.push(`${indent}  Answer: ${gate.answer}`);
  for (const answer of gate.answers) {
    lines.push(
      `${indent}  ${answer.use} answer from ${dash(answer.by)} on ${answer.dev}: ${answer.answer}`,
    );
  }
  return lines.join("\n");
}

export function formatTask(task: Task): string {
  const lines = [
    `${dash(task.key)}  ${dash(task.title)}`,
    `Id:        ${task.id}`,
    `Project:   ${dash(task.project)}`,
    `Stage:     ${task.stage}${task.archived ? " (archived)" : ""}`,
    `Assignee:  ${dash(task.assignee)}`,
    `Owner:     ${dash(task.owner)}`,
  ];
  if (task.priority) lines.push(`Priority:  ${task.priority}`);
  if (task.parent) lines.push(`Parent:    ${task.parent}`);
  if (task.needs_you_lane)
    lines.push(`Needs you: ${task.needs_you_reasons.map((r) => r.reason).join(", ")}`);
  const pause = pauseOf(task);
  if (pause) lines.push(`Paused:    ${pauseText(pause)}. ${pause.next_step}`.trimEnd());
  lines.push(
    "First message:",
    ...(task.first_message ?? "").split("\n").map((line) => `  ${line}`),
  );
  for (const gate of task.gates) lines.push(formatGate(gate));
  return lines.join("\n");
}

export function formatGates(list: GateEntry[]): string {
  if (list.length === 0) return "No open gate.";
  return list.map((gate) => `${dash(gate.task.key)}  ${formatGate(gate)}`).join("\n");
}

function eventText(row: EventRow): string {
  const data = row.event.data;
  // The old and the new key of a rekey (docs/architecture.md 4.3.3 item 3).
  if (row.type === "task.rekeyed") return `${String(data.from)} is now ${String(data.to)}`;
  // The learning step of the task (agent-learning, decision D3).
  if (row.type === "task.learned") {
    if (data.nothing_new === true) return "Nothing new learned";
    const waits = typeof data.suggestion === "string" ? " (waits for approval)" : "";
    return `Learned: ${typeof data.path === "string" ? data.path : "-"}${waits}`;
  }
  const text = (["text", "first_message", "answer", "title", "value", "assignee"] as const)
    .map((field) => data[field])
    .find((value): value is string => typeof value === "string");
  return text ?? "";
}

export function formatThreadRows(rows: EventRow[]): string[] {
  return rows.map((row) => {
    const by = row.event.by ? ` ${row.event.by}` : "";
    const note = row.applied
      ? row.reason
        ? ` (${row.reason})`
        : ""
      : ` (not applied: ${dash(row.reason)})`;
    const text = eventText(row);
    return `${row.hlc} ${row.dev}${by} ${row.type}${note}${text ? `\n  ${text.split("\n").join("\n  ")}` : ""}`;
  });
}

/** The line that gives the next page of a thread, so a long thread is never cut with no word. */
function moreLine(page: ThreadPage): string[] {
  return page.next
    ? [`More events: aw thread ${page.task.key ?? page.task.id} --after '${page.next}'`]
    : [];
}

export function formatThread(reply: ThreadReply): string {
  const lines: string[] = [];
  for (const page of reply.ancestors) {
    lines.push(
      `== ${dash(page.task.key)} ${dash(page.task.title)} (parent)`,
      ...formatThreadRows(page.events),
      ...moreLine(page),
    );
  }
  lines.push(
    `== ${dash(reply.task.key)} ${dash(reply.task.title)}`,
    ...formatThreadRows(reply.events),
    ...moreLine(reply),
  );
  return lines.join("\n");
}
