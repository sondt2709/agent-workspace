// The agent commands of the work loop (docs/workflow.md 8): approach, ready, task_create, gate,
// result and done. The MCP tools, the local API routes and the aw CLI call these functions through
// the session manager, which checks the session and the task first (SessionManager.agentSession).
import { DECISIONS_HEADING } from "@aw/client/gates";
import type { TaskView } from "@aw/core";
import { newId, type EventData } from "@aw/schema";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { invalid, ServiceError } from "../service/errors.ts";
import type { CreateTaskInput } from "../service/workspace.ts";
import type { SessionRecord } from "../sessions/records.ts";
import { hasLearningStep, learnReminder } from "./learning.ts";
import type { LoopHost } from "./loop.ts";

/** The longest Markdown of an approach, a custom gate or a result file. */
export const MAX_GATE_FILE_CHARS = 256 * 1024;
/** The Markdown in the gate event; a longer text stays in its file, and the event has its start. */
export const MAX_GATE_TEXT_CHARS = 16 * 1024;

export type Decision = EventData<"gate.opened">["decisions"] extends (infer D)[] | undefined
  ? D
  : never;

export interface AgentContext {
  record: SessionRecord;
  task: TaskView;
  /** The agent actor of the session, for example `claude@ubuntu-01`. */
  actor: string;
  host: LoopHost;
  /** Copies a file of the session working folder into `artifacts/<device>/` of the task. */
  copyFile(source: string, name: string): Promise<{ path: string; bytes: Buffer }>;
}

export const END_TURN =
  "End your turn now. Do not wait or poll: the answer arrives as your next input.";

function checkDecisions(decisions: Decision[]): Decision[] {
  decisions.forEach((d, i) => {
    if (!d.options.includes(d.recommended)) {
      throw invalid(`Decision ${i + 1}: the recommended option must be one of its options`, [
        { path: `decisions.${i}.recommended`, message: "not one of the options" },
      ]);
    }
  });
  return decisions;
}

function checkContent(content: string, what: string): string {
  if (content.trim() === "") throw invalid(`The ${what} is empty`);
  if (content.length > MAX_GATE_FILE_CHARS) {
    throw invalid(`The ${what} is longer than ${MAX_GATE_FILE_CHARS} characters`);
  }
  return content;
}

/** The gate text: the Markdown, its decisions, and a pointer to the file when it is long. */
export function gateText(content: string, decisions: Decision[], file: string | null): string {
  let text =
    content.length <= MAX_GATE_TEXT_CHARS
      ? content
      : `${content.slice(0, MAX_GATE_TEXT_CHARS)}\n\n… (the full text is in ${file ?? "the task file"})`;
  if (decisions.length > 0) {
    const lines = decisions.map(
      (d, i) =>
        `${i + 1}. ${d.question}\n   Options: ${d.options.join(" · ")}\n   Recommended: ${d.recommended}`,
    );
    text += `${DECISIONS_HEADING}${lines.join("\n")}\n\n"Confirm" accepts the recommended options. To choose another option, request changes with a comment.`;
  }
  return text;
}

/** An answer option of `ask`: a label, or a label with a description (openspec gate-context). */
export type AskOption = string | { label: string; description?: string | undefined };

export interface AskGateInput {
  /** The question. */
  text: string;
  /** The full context of the decision as Markdown. */
  details?: string | undefined;
  options: AskOption[];
}

/**
 * The data of the question gate of `ask` (openspec gate-context, design decisions 1 and 4). With
 * details: the title is the question on one line, the text is the details; details over
 * MAX_GATE_TEXT_CHARS keep their start in the text, and `file` (the long-text name of
 * docs/phase-1.md 3.3) gets the full details. With no details: the title is the first line of the
 * question and the text is the question. An option with a description adds `questions`.
 * `redact` is the redaction of the files layer: each cut runs after it (fix list 0-41).
 */
export function askGate(
  input: AskGateInput,
  gate: string,
  device: string,
  redact: (text: string) => string,
): { data: EventData<"gate.opened">; file: { path: string; text: string } | null } {
  const question = redact(input.text).trim();
  const options = input.options.map((o) => (typeof o === "string" ? o : o.label));
  const described = input.options.some((o) => typeof o !== "string" && !!o.description);
  let title = question.split("\n")[0]!.slice(0, 500);
  let text = input.text;
  let file: { path: string; text: string } | null = null;
  if (input.details !== undefined) {
    const details = checkContent(input.details, "details");
    const shown = redact(details);
    title = question.replace(/\s*\n\s*/g, " ").slice(0, 500);
    if (shown.length > MAX_GATE_TEXT_CHARS) {
      file = { path: `artifacts/${device}/text-${gate}.md`, text: details };
    }
    text = gateText(shown, [], file?.path ?? null);
  }
  const questions = described
    ? [
        {
          question: title,
          header: null,
          multi_select: false,
          options: input.options.map((o) =>
            typeof o === "string"
              ? { label: o, description: "" }
              : { label: o.label, description: o.description ?? "" },
          ),
        },
      ]
    : [];
  return {
    data: {
      gate,
      kind: "question",
      version: 1,
      title,
      text,
      options,
      request_id: null,
      file: file?.path ?? null,
      decisions: [],
      questions,
    },
    file,
  };
}

/** The first line of a Markdown text as a gate title. */
function titleOf(content: string, fallback: string): string {
  const line = content
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find((l) => l !== "");
  return (line ?? fallback).slice(0, 500);
}

/** Resolves the open gates of a kind that a new version replaces (answer with no answer event). */
async function replaceOpen(
  ctx: AgentContext,
  kind: "confirm_approach" | "approve_result",
  text: string,
): Promise<void> {
  for (const gate of ctx.task.gates) {
    if (gate.kind !== kind || gate.state !== "open") continue;
    await ctx.host.write(
      ctx.task.id,
      "gate.resolved",
      { gate: gate.gate, version: gate.version, answer_event: null, answer: text },
      `aw@${ctx.host.me}`,
    );
  }
}

/** `aw approach`: `approach/v<n>.md` (written once), `approach.proposed` and "Confirm approach". */
export async function proposeApproach(
  ctx: AgentContext,
  input: { content: string; decisions?: Decision[] | undefined },
) {
  const content = checkContent(input.content, "approach");
  const decisions = checkDecisions(input.decisions ?? []);
  const service = ctx.host.service;
  const task = ctx.task;
  if (task.stage === "done") throw new ServiceError("refused", `${task.key ?? task.id} is done`);
  const read = (n: number) =>
    service.files.readText(`tasks/${task.id}/approach/v${n}.md`).catch(() => null);
  // Each version is written once: a version file that exists is never written again.
  let version = task.approach.latest + 1;
  for (let existing = await read(version); existing !== null; existing = await read(version)) {
    version++;
  }
  const file = `approach/v${version}.md`;
  await service.writeTaskFile(`tasks/${task.id}/${file}`, content);
  // The gate title and text are cuts of the content: redact first (fix list 0-41).
  const shown = service.files.redactText(content);
  await replaceOpen(ctx, "confirm_approach", `Replaced by approach v${version}`);
  const proposed = await ctx.host.write(task.id, "approach.proposed", { version, file }, ctx.actor);
  const gate = newId(ctx.host.clock);
  const opened = await ctx.host.write(
    task.id,
    "gate.opened",
    {
      gate,
      kind: "confirm_approach",
      version: 1,
      title: titleOf(shown, `Approach v${version}`),
      text: gateText(shown, decisions, file),
      options: ["Confirm", "Request changes"],
      file,
      decisions,
    },
    ctx.actor,
  );
  return {
    gate,
    version,
    file,
    event: opened.event,
    applied: proposed.applied && opened.applied,
    reason: opened.reason ?? proposed.reason,
    next: `Approach v${version} sent to the human as gate ${gate}. ${END_TURN}`,
  };
}

/** `aw ready`: `task.ready`, and a question gate for each missing item. */
export async function reportReady(ctx: AgentContext, input: { missing?: string[] | undefined }) {
  const missing = (input.missing ?? []).map((m) => m.trim()).filter(Boolean);
  if (missing.length > 20) throw invalid("Give at most 20 missing items");
  const task = ctx.task;
  if (task.stage === "done") throw new ServiceError("refused", `${task.key ?? task.id} is done`);
  const gates: string[] = [];
  for (const item of missing) {
    const gate = newId(ctx.host.clock);
    await ctx.host.write(
      task.id,
      "gate.opened",
      {
        gate,
        kind: "question",
        version: 1,
        title: `Missing: ${ctx.host.service.files.redactText(item)}`.slice(0, 500),
        text: `The agent needs this before it implements: ${item}`,
      },
      ctx.actor,
    );
    gates.push(gate);
  }
  const result = await ctx.host.write(task.id, "task.ready", { missing, gates }, ctx.actor);
  const key = task.key ?? task.id;
  return {
    event: result.event,
    applied: result.applied,
    reason: result.reason,
    gates,
    next:
      missing.length > 0
        ? `${missing.length} question(s) sent to the human. ${END_TURN} AW runs the ready checks again after the answers.`
        : `AW runs the ready checks of ${key} on ${ctx.host.me}. End your turn now: "Start implementing" arrives as your next input when they pass.`,
  };
}

export interface SubtaskInput {
  title: string;
  first_message: string;
  project?: string | undefined;
  depends_on?: string[] | undefined;
  from_parent?: boolean | undefined;
  test_server?: string | null | undefined;
  credentials?: string[] | undefined;
  links?: string[] | undefined;
}

/** True when an agent created the task (the `by` of its `task.created` is not a person). */
export function createdByAgent(ctx: AgentContext, task: TaskView): boolean {
  const row = ctx.host.rows(task.id).find((r) => r.id === task.created?.event);
  const by = (row?.event as { by?: string } | undefined)?.by ?? "";
  return by !== "" && !by.startsWith("human@");
}

/**
 * The assignee of a new subtask: with the project switch "Assign new subtasks to the default
 * device" on, the default agent at the first online device of the project list (the first device
 * when none is online); else none (task-model decision §5.1). A subtask of a task that an agent
 * created gets none: an agent subtask never starts another subtask by itself (owner decision Q8,
 * fix list 0-4), so a person sees each deeper level before it costs a session. A subtask in
 * another project than its parent gets none either.
 */
export function subtaskAssignee(ctx: AgentContext, project: string): string | null {
  if (createdByAgent(ctx, ctx.task)) return null;
  // A subtask in another project waits for the human: the switch of that project never starts
  // a session in another repository with no person step (final check fc1-13).
  if (project !== ctx.task.project) return null;
  const service = ctx.host.service;
  const doc = service.view.projects.find((p) => p.slug === project);
  if (!doc?.switches.assign_new_subtasks_to_default_device) return null;
  const devices = doc.devices.filter(
    (d) => service.view.devices.find((v) => v.slug === d)?.role !== "mobile",
  );
  const online = new Set(
    (service.presence?.devices ?? []).filter((d) => d.online).map((d) => d.device),
  );
  online.add(service.device.slug);
  const device = devices.find((d) => online.has(d)) ?? devices[0];
  return device ? `${doc.default_agent}@${device}` : null;
}

/** `task_create`: a subtask of the session task, by the agent (docs/workflow.md 4.6). */
export async function createSubtask(ctx: AgentContext, input: SubtaskInput) {
  const parent = ctx.task;
  const project = input.project ?? parent.project;
  if (!project) throw invalid("The parent task has no project: give the project");
  const copy = input.from_parent ?? false;
  // The human adds credentials (task-model decision): an agent passes on only the credentials of
  // its own task, so a subtask that starts by the project switch gets no new value (fix list 0-1).
  const extra = (input.credentials ?? []).filter((name) => !parent.credentials.includes(name));
  if (extra.length > 0) {
    throw new ServiceError(
      "refused",
      `An agent gives a subtask only the credentials of its own task ${parent.key ?? parent.id} (${parent.credentials.join(", ") || "none"}), not ${extra.join(", ")}. Ask the human to add ${extra.length === 1 ? "it" : "them"} to the subtask.`,
      { credentials: extra },
    );
  }
  const body: CreateTaskInput = {
    project,
    title: input.title,
    first_message: input.first_message,
    parent: parent.id,
    depends_on: input.depends_on ?? [],
    test_server:
      input.test_server !== undefined ? input.test_server : copy ? parent.test_server : null,
    credentials: input.credentials ?? (copy ? parent.credentials : []),
    links: input.links ?? (copy ? parent.links : []),
    assignee: subtaskAssignee(ctx, project),
  };
  const result = await ctx.host.service.createTask(body, ctx.actor);
  const task = result.task;
  const key = task.key ?? task.id;
  return {
    next:
      task.assignee === null
        ? `Created ${key}. It waits for the human to assign it ("Needs you: assign").`
        : `Created ${key}, assigned to ${task.assignee} by the project switch.`,
    event: result.event,
    applied: result.applied,
    reason: result.reason,
    task: {
      id: task.id,
      key: task.key,
      assignee: task.assignee,
      parent: task.parent,
      stage: task.stage,
    },
  };
}

/** `gate`: a custom gate with Markdown and optional decisions (task-model decision §3.1). */
export async function openCustomGate(
  ctx: AgentContext,
  input: { content: string; decisions?: Decision[] | undefined; options?: string[] | undefined },
) {
  const content = checkContent(input.content, "gate text");
  const decisions = checkDecisions(input.decisions ?? []);
  const shown = ctx.host.service.files.redactText(content);
  const options =
    input.options && input.options.length > 0
      ? input.options
      : decisions.length > 0
        ? ["Accept the recommendations"]
        : [];
  const gate = newId(ctx.host.clock);
  const result = await ctx.host.write(
    ctx.task.id,
    "gate.opened",
    {
      gate,
      kind: "custom",
      version: 1,
      title: titleOf(shown, "Decision"),
      text: gateText(shown, decisions, null),
      options,
      decisions,
    },
    ctx.actor,
  );
  return { gate, ...result, next: `Gate ${gate} sent to the human. ${END_TURN}` };
}

/** `result`: the result file, its artifacts, "Approve result" and the stage Review. */
export async function postResult(
  ctx: AgentContext,
  input: { path: string; artifacts?: string[] | undefined },
) {
  const task = ctx.task;
  if (task.stage === "done") throw new ServiceError("refused", `${task.key ?? task.id} is done`);
  const stamp = new Date(ctx.host.clock.now()).toISOString().replace(/[-:.]/g, "").slice(0, 15);
  const result = await ctx.copyFile(input.path, `result-${stamp}.md`);
  const content = checkContent(result.bytes.toString("utf8"), "result file");
  const shown = ctx.host.service.files.redactText(content);
  const artifacts: string[] = [];
  for (const source of input.artifacts ?? []) {
    const copied = await ctx.copyFile(source, basename(source));
    await ctx.host.write(
      task.id,
      "artifact.added",
      {
        path: copied.path,
        size: copied.bytes.length,
        sha256: createHash("sha256").update(copied.bytes).digest("hex"),
      },
      ctx.actor,
    );
    artifacts.push(copied.path);
  }
  await replaceOpen(ctx, "approve_result", "Replaced by a newer result");
  await ctx.host.write(task.id, "result.posted", { file: result.path, artifacts }, ctx.actor);
  const gate = newId(ctx.host.clock);
  const opened = await ctx.host.write(
    task.id,
    "gate.opened",
    {
      gate,
      kind: "approve_result",
      version: 1,
      title: titleOf(shown, "Result"),
      text: gateText(shown, [], result.path),
      options: ["Approve", "Request changes"],
      file: result.path,
    },
    ctx.actor,
  );
  if (task.stage !== "review") {
    await ctx.host.write(
      task.id,
      "task.stage_changed",
      { from: task.stage, to: "review" },
      `aw@${ctx.host.me}`,
    );
  }
  return {
    gate,
    file: result.path,
    artifacts,
    event: opened.event,
    applied: opened.applied,
    reason: opened.reason,
    next: `Result sent to the human as gate ${gate}. ${END_TURN}`,
  };
}

/** `done`: ends the task after an approved result. AW closes the session at the next Stop. */
export async function markDone(ctx: AgentContext) {
  const task = ctx.task;
  const key = task.key ?? task.id;
  // No block of done with no learning step (decision D3, agent-learning): a reminder.
  const next = hasLearningStep(ctx.host.rows(task.id))
    ? `${key} is done. End your turn now: AW then closes this session.`
    : `${key} is done. ${learnReminder(key)} Then end your turn: AW then closes this session.`;
  if (task.stage === "done") return { event: null, applied: true, reason: null, next };
  // Only the newest result counts: a newer result waits for its own answer (review task-loop L1).
  const newest = task.gates.filter((g) => g.kind === "approve_result").at(-1);
  const approved = newest?.state === "resolved" && /^approve/i.test(newest.answer ?? "");
  if (!approved) {
    throw new ServiceError(
      "refused",
      `${key} has no approved result. Post the result with aw result, then wait for the answer of the human.`,
    );
  }
  const result = await ctx.host.write(task.id, "task.done", {}, `aw@${ctx.host.me}`);
  return { event: result.event, applied: result.applied, reason: result.reason, next };
}
