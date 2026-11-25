// The MCP tools and resources of an AW session (docs/workflow.md 8, design of add-mcp-server,
// decision 8). Each tool calls the same service method as its `aw` command: no logic here, only the
// caller of the token, the input schema, the error envelope and the retry cache.
import { MAX_ASK_DETAILS_CHARS } from "@aw/client/schemas";
import type { Clock, TaskView } from "@aw/core";
import { newId } from "@aw/schema";
import { McpServer, ResourceTemplate, type CallToolResult } from "@modelcontextprotocol/server";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { Logger } from "../log.ts";
import type { Daemon } from "../service/daemon.ts";
import { ServiceError } from "../service/errors.ts";
import { appliedLearning, recordLearning } from "../service/learning.ts";
import type { SessionManager } from "../sessions/manager.ts";
import { AW_VERSION } from "../version.ts";

/** The server instructions: fewer than 4,096 characters (docs/phase-1.md 9.8.4). */
export const MCP_INSTRUCTIONS = [
  "Agent Workspace (AW) tools for the one task of this session. The human is not at this terminal: the human reads the AW thread on a phone or a desktop app.",
  "0. Your text output goes only to the Session log: the human reads only what you send through AW. End EACH turn with one AW call: ask, proposal, ready, result, gate, message, learn or done. [AW notice <id>] Your turn ended with no AW update means: send that update now.",
  "1. Read the thread first: thread (with ancestors: true for a subtask). Long threads come in pages: call thread again with from: next_from.",
  "2. Ask each question to the human only with ask, never also with message. Put all your questions in one ask. It returns at once with a gate id. Then END YOUR TURN: do not wait or poll. The answer arrives as your next input, after [AW answer <gate>]. A new ask replaces your older open questions.",
  '   Put the full context of a decision (the options, trade-offs, risks, your recommendation) in details of ask, and a description in each option. The human sees only the gate: never write "see the message above".',
  "3. message writes a message to the human in the thread: short, for a phone screen, and never a copy of a gate or a result. stage updates the progress line.",
  "4. artifact_add copies a file of your working folder into the task (at most 50 MB). handoff writes the context for the next session.",
  '5. Knowledge: read the "Read now" files of the session context and search the knowledge first (resource aw://knowledge, aw kb search <terms>). Before done, call learn for each thing you learned (a new knowledge file; shared: true waits for approval), or learn with nothing_new: true.',
  "6. The work loop: discuss with message and ask; when no question is open, write one proposal (gate Approve proposal). A proposal has no open question and no choice; never ask for permission to write it. After a message about the proposal, answer it or send a new version. Then ready (missing items become questions); AW sends 'Start implementing' when the checks pass. result posts the result (gate Approve result). After 'Result approved' do your last steps, then done. task_create makes a subtask; gate opens a decision. After each gate tool, END YOUR TURN.",
  "7. The task argument is optional: it is the task of this session. Another task is refused.",
  "8. A result with isError has an error code: refused (not allowed, ask the human), not_ready (awd starts: try once more after 10 s), not_available (not possible here, for example a slot of another device), invalid_input.",
  "9. When these tools are missing or fail, use the aw commands of the AW skill (aw ask, aw message, ...).",
].join("\n");

/** The thread page size of the `thread` tool. */
const THREAD_DEFAULT = 50;
const THREAD_MAX = 200;
/**
 * The JSON characters of the events of one `thread` result (about 15k tokens): under the MCP output
 * limit of Claude Code (25k tokens by default). The page ends early with `next_from`; the first
 * event of the page is always in it, so each call makes progress.
 */
export const THREAD_BUDGET = 60_000;
/** The knowledge list of the resource. */
const KNOWLEDGE_MAX = 200;
/** The time in which a repeat of an `ask` or `artifact_add` gets the same result (decision 9). */
export const RETRY_WINDOW_MS = 60_000;

/**
 * The results of the retry-safe tools, by session, tool and arguments. A repeat during the call
 * shares the call. A repeat after it gets the same result only while `fresh(result)` is true: a
 * repeat of an answered question opens a new gate, and the arguments of `artifact_add` hold the
 * size and the time of the file, so a new version of the file is a new call.
 */
export class RetryCache {
  readonly #clock: Clock;
  readonly #entries = new Map<
    string,
    { at: number; result: Promise<unknown>; done: boolean; value?: unknown }
  >();

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  run<T>(
    session: string,
    tool: string,
    args: unknown,
    call: () => Promise<T>,
    fresh: (value: T) => boolean = () => true,
  ): Promise<T> {
    const now = this.#clock.now();
    for (const [key, entry] of this.#entries) {
      if (entry.done && now - entry.at > RETRY_WINDOW_MS) this.#entries.delete(key);
    }
    const key = createHash("sha256")
      .update(JSON.stringify([session, tool, args]))
      .digest("hex");
    const known = this.#entries.get(key);
    if (known && (!known.done || fresh(known.value as T))) return known.result as Promise<T>;
    const result = call();
    const entry: { at: number; result: Promise<unknown>; done: boolean; value?: unknown } = {
      at: now,
      result,
      done: false,
    };
    this.#entries.set(key, entry);
    result.then(
      (value) => {
        entry.done = true;
        entry.value = value;
        entry.at = this.#clock.now();
      },
      // A failed call is not kept: the same call may work after the cause is gone.
      () => {
        if (this.#entries.get(key) === entry) this.#entries.delete(key);
      },
    );
    return result;
  }
}

export interface ToolContext {
  daemon: Daemon;
  /** The session of the token of this request. */
  session: string;
  log: Logger;
  cache: RetryCache;
}

const taskArg = z
  .string()
  .min(1)
  .max(64)
  .optional()
  .describe("The task key or id. Default: the task of this session");

function text(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** The session, its manager and its workspace. Throws `not_ready` or `refused` (decision 4). */
function sessionOf(context: ToolContext) {
  const sessions = context.daemon.sessions;
  if (!sessions) throw new ServiceError("refused", "Sessions are off on this device");
  const caller = sessions.caller(context.session);
  const manager: SessionManager = sessions.manager(context.session);
  const record = manager.record(context.session)!;
  return { caller, manager, service: manager.service, record };
}

/** Wraps a tool body: the result as JSON, a service error as the error envelope (decision 8). */
async function call(
  context: ToolContext,
  tool: string,
  body: () => unknown,
): Promise<CallToolResult> {
  try {
    return text(await body());
  } catch (error) {
    const traceId = newId(context.daemon.clock);
    if (error instanceof ServiceError) {
      if (error.status >= 500 && error.code !== "not_ready") {
        context.log.error({ err: error, tool, trace_id: traceId }, error.message);
      }
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: {
                code: error.code,
                message: error.message,
                ...(error.details === undefined ? {} : { details: error.details }),
              },
              trace_id: traceId,
            }),
          },
        ],
      };
    }
    context.log.error({ err: error, tool, trace_id: traceId }, "An MCP tool failed");
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: { code: "internal", message: "Internal error" },
            trace_id: traceId,
          }),
        },
      ],
    };
  }
}

/** The task of a tool call: the session task, or the named task when it is the session task. */
function taskRef(caller: { task: string }, task: string | undefined): string {
  return task ?? caller.task;
}

function compactTask(task: TaskView) {
  return {
    id: task.id,
    key: task.key,
    title: task.title,
    project: task.project,
    stage: task.stage,
    assignee: task.assignee,
    priority: task.priority,
    parent: task.parent,
    subtasks: task.subtasks,
    depends_on: task.depends_on,
    open_gates: task.needs_you,
    progress: task.progress,
    branch: task.branch,
    test_server: task.test_server,
    links: task.links,
    first_message: task.first_message,
  };
}

/** Builds the MCP server of one request for the session of its token. */
export function buildMcpServer(context: ToolContext): McpServer {
  const server = new McpServer(
    { name: "aw", version: AW_VERSION },
    { instructions: MCP_INSTRUCTIONS, capabilities: { tools: {}, resources: {} } },
  );

  server.registerTool(
    "thread",
    {
      title: "Read the task thread",
      description:
        "The events of the task thread in merge order, word for word: the original messages, answers and gates. Pages of at most limit events and about 60,000 characters; call again with from: next_from. With ancestors: true, each parent thread comes as a page too: read more of a parent with thread {task: <parent key>, from: its next_from}.",
      inputSchema: z.object({
        task: taskArg,
        from: z.int().min(0).optional().describe("The number of the first event (0 is the first)"),
        limit: z.int().min(1).max(THREAD_MAX).optional().describe("At most 200, default 50"),
        ancestors: z.boolean().optional().describe("Also the threads of the parent tasks"),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      call(context, "thread", () => {
        const { caller, manager, service } = sessionOf(context);
        const target = manager.readableTask(context.session, taskRef(caller, args.task));
        const limit = args.limit ?? THREAD_DEFAULT;
        let budget = THREAD_BUDGET;
        /** One page of a thread in the budget left: at least one event when `first`. */
        const page = (task: string, from: number, first: boolean) => {
          const read = service.thread(task, { from, limit });
          const events: Record<string, unknown>[] = [];
          for (const [i, row] of read.events.entries()) {
            const event = row.event as { by?: string; data?: unknown };
            const item = {
              n: from + i,
              id: row.id,
              type: row.type,
              by: event.by ?? null,
              hlc: row.hlc,
              ...(row.applied ? {} : { applied: false, reason: row.reason }),
              data: event.data ?? null,
            };
            const size = JSON.stringify(item).length;
            if (size > budget && !(first && events.length === 0)) break;
            budget -= size;
            events.push(item);
          }
          const more = events.length < read.events.length || read.next !== null;
          return { task: read.task, events, next_from: more ? from + events.length : null };
        };
        const main = page(target.id, args.from ?? 0, true);
        // The parent threads after the task page, in the budget left, `limit` events each. A parent
        // with more events: thread {task: <parent>, from: next_from}.
        const ancestors = args.ancestors
          ? service
              .ancestry(target.id)
              .slice(0, -1)
              .map((task) => page(task.id, 0, false))
          : [];
        return { ...main, ancestors };
      }),
  );

  server.registerTool(
    "ask",
    {
      title: "Ask the human",
      description:
        "Open the gate Answer question and return at once with its id. Then end your turn: the answer arrives as your next input, after [AW answer <gate>].",
      inputSchema: z.object({
        task: taskArg,
        text: z.string().min(1).max(20_000).describe("The question, on one line"),
        details: z
          .string()
          .min(1)
          .max(MAX_ASK_DETAILS_CHARS)
          .optional()
          .describe(
            "The full context of the decision as Markdown: the options, trade-offs, risks and your recommendation",
          ),
        options: z
          .array(
            z.union([
              z.string().min(1).max(500),
              z.object({
                label: z.string().min(1).max(500),
                description: z.string().max(2000).optional(),
              }),
            ]),
          )
          .max(20)
          .optional()
          .describe("The answer options: a label, or {label, description}"),
      }),
      annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    (args) =>
      call(context, "ask", async () => {
        const { caller, manager } = sessionOf(context);
        const input = {
          task: taskRef(caller, args.task),
          text: args.text,
          ...(args.details !== undefined ? { details: args.details } : {}),
          options: args.options ?? [],
        };
        // A repeat gets the same gate only while it is open: a repeat of an answered question is
        // a new question.
        const reply = await context.cache.run(
          context.session,
          "ask",
          input,
          () => manager.ask(context.session, input),
          (known) =>
            manager.service.showTask(input.task).gates.find((g) => g.gate === known.gate)?.state ===
            "open",
        );
        return {
          ...reply,
          next: `End your turn now. Do not wait or poll: the answer arrives as your next input, after "[AW answer ${reply.gate}]".`,
        };
      }),
  );

  for (const [tool, method, what] of [
    ["message", "message", "Write a message to the human in the thread (message.agent)"],
    ["stage", "stage", "Update the progress line of the task (task.progress)"],
  ] as const) {
    server.registerTool(
      tool,
      {
        title: what,
        description: what,
        inputSchema: z.object({ task: taskArg, text: z.string().min(1).max(60_000) }),
        annotations: { destructiveHint: false, openWorldHint: false },
      },
      (args) =>
        call(context, tool, () => {
          const { caller, manager } = sessionOf(context);
          return manager[method](context.session, {
            task: taskRef(caller, args.task),
            text: args.text,
          });
        }),
    );
  }

  const fileArgs = z.object({
    task: taskArg,
    path: z
      .string()
      .min(1)
      .max(4096)
      .describe("A file in your working folder, absolute or relative to it, at most 50 MB"),
  });
  server.registerTool(
    "artifact_add",
    {
      title: "Add an artifact",
      description:
        "Copy a file of your working folder (a test report, a screenshot) into the task. AW copies it to each device of the workspace.",
      inputSchema: fileArgs,
      annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    (args) =>
      call(context, "artifact_add", async () => {
        const { caller, manager, record } = sessionOf(context);
        const input = {
          task: taskRef(caller, args.task),
          path: isAbsolute(args.path) ? args.path : resolve(record.cwd, args.path),
        };
        // The size and the time of the file are in the key: a new version is a new artifact.
        const file = await stat(input.path).catch(() => null);
        const version = file ? { size: file.size, mtime: file.mtimeMs } : null;
        return context.cache.run(context.session, "artifact_add", { ...input, version }, () =>
          manager.addArtifact(context.session, input),
        );
      }),
  );

  server.registerTool(
    "handoff",
    {
      title: "Write the handoff",
      description: "Write the context for the next session from a Markdown file of your folder.",
      inputSchema: fileArgs,
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    (args) =>
      call(context, "handoff", () => {
        const { caller, manager, record } = sessionOf(context);
        return manager.handoff(context.session, {
          task: taskRef(caller, args.task),
          path: isAbsolute(args.path) ? args.path : resolve(record.cwd, args.path),
        });
      }),
  );

  server.registerTool(
    "learn",
    {
      title: "Learn",
      description:
        "Record the learning step of the task before done: write what you learned as a new knowledge file of the project (title and content; shared: true writes to shared knowledge and waits for approval of the human), or nothing_new: true when you learned nothing new.",
      inputSchema: z.object({
        task: taskArg,
        title: z.string().min(1).max(200).optional(),
        content: z
          .string()
          .min(1)
          .max(48 * 1024)
          .optional(),
        shared: z.boolean().optional(),
        nothing_new: z
          .boolean()
          .optional()
          .describe('true: record "Nothing new" (no title, content or shared)'),
      }),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    (args) =>
      call(context, "learn", () => {
        const { caller, service } = sessionOf(context);
        const task = service.showTask(taskRef(caller, args.task));
        return recordLearning(
          service,
          {
            task,
            title: args.title,
            content: args.content,
            shared: args.shared,
            nothing_new: args.nothing_new,
          },
          { agent: caller.agent, session: caller.session, task: caller.task },
        ).then(appliedLearning);
      }),
  );

  registerLoopTools(server, context);

  // Test slots (add-continuity): a lease from the device that has the resource.
  const resource = z
    .string()
    .regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/)
    .max(64)
    .describe("The slot resource, for example k3d");
  server.registerTool(
    "slot_acquire",
    {
      title: "Lease a test slot",
      description:
        "Lease a slot of a test resource (for example k3d) for 30 min, or renew your lease (call it again before ttl/3). The result has the slot and a fencing token, or your queue position: then ask again in about 1 min. Release it when you are done.",
      inputSchema: z.object({ resource }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) =>
      call(context, "slot_acquire", () => {
        const { manager } = sessionOf(context);
        return manager.slotAcquire(context.session, { resource: args.resource });
      }),
  );
  server.registerTool(
    "slot_release",
    {
      title: "Release a test slot",
      description: "Release your lease of a test resource slot.",
      inputSchema: z.object({ resource }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) =>
      call(context, "slot_release", () => {
        const { manager } = sessionOf(context);
        return manager.slotRelease(context.session, { resource: args.resource });
      }),
  );

  server.registerResource(
    "task",
    "aw://task",
    {
      title: "The task of this session",
      description: "The fields of the task: key, title, stage, assignee, gates, first message",
      mimeType: "application/json",
    },
    (uri) => {
      const { caller, service } = sessionOf(context);
      const task = service.showTask(caller.task);
      return { contents: [{ uri: uri.href, text: JSON.stringify(compactTask(task)) }] };
    },
  );

  server.registerResource(
    "knowledge",
    "aw://knowledge",
    {
      title: "Knowledge list",
      description: `The knowledge files of the workspace with their apply mode (at most ${KNOWLEDGE_MAX})`,
      mimeType: "application/json",
    },
    async (uri) => {
      const { service } = sessionOf(context);
      const files = await service.knowledge.list({ kind: "all" });
      const body = { count: files.length, files: files.slice(0, KNOWLEDGE_MAX) };
      return { contents: [{ uri: uri.href, text: JSON.stringify(body) }] };
    },
  );

  server.registerResource(
    "knowledge-file",
    new ResourceTemplate("aw://knowledge/{+path}", { list: undefined }),
    {
      title: "Knowledge file",
      description: "One knowledge file, for example aw://knowledge/shared/rules/style.md",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const { service } = sessionOf(context);
      const path = String(variables.path ?? "");
      const file = await service.knowledge.read(path);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: file.content }] };
    },
  );

  return server;
}

/** Decisions are removed (openspec proposal-and-discussion): an old skill text gets the reason. */
const removedDecisions = z
  .unknown()
  .optional()
  .describe("Removed: ask each question with ask before the proposal");

function noDecisions(decisions: unknown): void {
  if (decisions !== undefined) {
    throw new ServiceError(
      "invalid_input",
      "decisions are removed: ask each question with ask before you write the proposal",
    );
  }
}
const markdownArg = z
  .string()
  .min(1)
  .max(256 * 1024)
  .describe("Markdown");

/** The tools of the work loop (add-task-loop): the same manager methods as the aw commands. */
function registerLoopTools(server: McpServer, context: ToolContext): void {
  const write = { destructiveHint: false, openWorldHint: false };
  // `approach` is the name of an older skill text (before openspec proposal-and-discussion).
  for (const name of ["proposal", "approach"] as const) {
    server.registerTool(
      name,
      {
        title: name === "proposal" ? "Send the proposal" : "Send the proposal (old name)",
        description:
          name === "proposal"
            ? "Write the proposal as a new version (proposal/v<n>.md) and open the gate Approve proposal. Send it only when no question is open; it has no open question and no choice. It replaces your open proposal and questions. Then end your turn."
            : "The old name of the tool proposal. Use proposal.",
        inputSchema: z.object({
          task: taskArg,
          content: markdownArg,
          decisions: removedDecisions,
        }),
        annotations: write,
      },
      (args) =>
        call(context, name, () => {
          noDecisions(args.decisions);
          const { caller, manager } = sessionOf(context);
          return manager.proposal(context.session, {
            task: taskRef(caller, args.task),
            content: args.content,
          });
        }),
    );
  }
  server.registerTool(
    "ready",
    {
      title: "Report ready",
      description:
        "Report that you have what you need to implement. Each missing item becomes a question to the human. AW checks the approach, the assignee and the sync, then sends 'Start implementing' as your next input. End your turn after it.",
      inputSchema: z.object({
        task: taskArg,
        missing: z.array(z.string().min(1).max(2000)).max(20).optional(),
      }),
      annotations: { ...write, idempotentHint: true },
    },
    (args) =>
      call(context, "ready", () => {
        const { caller, manager } = sessionOf(context);
        const input = { task: taskRef(caller, args.task), missing: args.missing ?? [] };
        return context.cache.run(context.session, "ready", input, () =>
          manager.ready(context.session, input),
        );
      }),
  );
  server.registerTool(
    "task_create",
    {
      title: "Create a subtask",
      description:
        "Create a subtask of the task of this session. from_parent copies the test server, the credential names and the links. The human assigns it, unless the project switch assigns new subtasks. A subtask starts only when its depends_on tasks are done.",
      inputSchema: z.object({
        title: z.string().min(1).max(500),
        first_message: z
          .string()
          .min(1)
          .max(256 * 1024),
        project: z.string().min(1).max(63).optional(),
        depends_on: z.array(z.string().min(1).max(64)).max(50).optional(),
        from_parent: z.boolean().optional(),
        test_server: z.string().min(1).max(63).optional(),
        credentials: z.array(z.string().min(1).max(63)).max(50).optional(),
        links: z.array(z.string().min(1).max(2000)).max(50).optional(),
      }),
      annotations: write,
    },
    (args) =>
      call(context, "task_create", () => {
        const { manager } = sessionOf(context);
        return manager.createSubtask(context.session, args);
      }),
  );
  server.registerTool(
    "gate",
    {
      title: "Open a decision gate",
      description:
        "Open a gate with any Markdown and its answer options. The answer arrives as your next input. Then end your turn.",
      inputSchema: z.object({
        task: taskArg,
        content: markdownArg,
        decisions: removedDecisions,
        options: z.array(z.string().min(1).max(500)).max(20).optional(),
      }),
      annotations: write,
    },
    (args) =>
      call(context, "gate", () => {
        noDecisions(args.decisions);
        const { caller, manager } = sessionOf(context);
        return manager.gate(context.session, {
          task: taskRef(caller, args.task),
          content: args.content,
          options: args.options,
        });
      }),
  );
  server.registerTool(
    "result",
    {
      title: "Post the result",
      description:
        "Post the result file (Markdown in your working folder) with optional artifacts, and open the gate Approve result. The task goes to Review. Then end your turn.",
      inputSchema: z.object({
        task: taskArg,
        path: z.string().min(1).max(4096).describe("The result file, absolute or relative"),
        artifacts: z.array(z.string().min(1).max(4096)).max(50).optional(),
      }),
      annotations: write,
    },
    (args) =>
      call(context, "result", () => {
        const { caller, manager, record } = sessionOf(context);
        const abs = (path: string) => (isAbsolute(path) ? path : resolve(record.cwd, path));
        return manager.result(context.session, {
          task: taskRef(caller, args.task),
          path: abs(args.path),
          artifacts: (args.artifacts ?? []).map(abs),
        });
      }),
  );
  server.registerTool(
    "done",
    {
      title: "End the task",
      description:
        "End the task after the human approved the result. Then end your turn: AW closes the session.",
      inputSchema: z.object({ task: taskArg }),
      annotations: { ...write, idempotentHint: true },
    },
    (args) =>
      call(context, "done", () => {
        const { caller, manager } = sessionOf(context);
        return manager.done(context.session, { task: taskRef(caller, args.task) });
      }),
  );
}
