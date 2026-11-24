// The work loop of one workspace on its session device (docs/workflow.md 3 and 4, design of
// add-task-loop): stage effects after gate resolutions, the ready checks and "Start implementing",
// Done after "Result approved", the parent notice of a done subtask, the knowledge gates, and the
// gate pushes and reminders. The session manager calls it; each write goes through the manager
// (the log buffer), so the order of the events stays the order of the manager.
import { hlcMs, type Clock, type EventRow, type GateView, type TaskView } from "@aw/core";
import type { Suggestion } from "@aw/plugin-api";
import type { EventData, EventType, Stage } from "@aw/schema";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../log.ts";
import { isAgentAuthor } from "../service/queues.ts";
import type { WorkspaceService, WriteResult } from "../service/workspace.ts";
import { readThreadLine } from "../sessions/context.ts";
import type { SessionRecord } from "../sessions/records.ts";
import { writePrivate } from "../sessions/records.ts";
import { hookEventId } from "../sessions/spool.ts";
import { hasLearningStep, learnCommands, noLearningComment } from "./learning.ts";
import type { PushService } from "./push.ts";
import { firstStage, readyChecks, type SyncCheck } from "./ready.ts";
import { duePushes, type DuePush } from "./rules.ts";
import { staleGates } from "./stale-gates.ts";

/** The prefix of a notice of AW in the session input. */
export const NOTICE_PREFIX = "[AW notice";
/** The sent pushes are kept this long in the record file. */
const SENT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** The sync state is read at most this often (one REST round per peer). */
const SYNC_CACHE_MS = 5000;

/** The writes and reads that the loop needs from its session manager. */
export interface LoopHost {
  readonly service: WorkspaceService;
  readonly me: string;
  readonly clock: Clock;
  readonly log: Logger;
  /** Writes one event at once, after the waiting events of the task (the log buffer). */
  write<T extends EventType>(
    task: string,
    type: T,
    data: EventData<T>,
    by: string,
    options?: { id?: string },
  ): Promise<WriteResult>;
  /** The events of a task in merge order. */
  rows(task: string): EventRow[];
  task(id: string): TaskView | undefined;
  /** The running session of a task on this device that holds the accepted claim. */
  runningSession(task: string): SessionRecord | undefined;
  /** Asks for a new session of the task whose first input is this notice. */
  restartWith(task: string, notice: { id: string; text: string }): void;
  /** True when a person stopped the session of the claim on this device (`aw session stop`). */
  stoppedByPerson(task: string): boolean;
  /** Ends a done session and closes its window (state `ended`). */
  finish(record: SessionRecord): Promise<void>;
  /** The wait of a permission request before the hook denies (120 s). */
  readonly permissionTimeoutMs: number;
}

/** The sync check of a workspace, given by awd (the sync service). */
export type SyncProbe = (workspace: string) => Promise<SyncCheck>;

export interface TaskLoopOptions {
  push: PushService | null;
  sync: SyncProbe;
  /** The folder of the sent-push records: `<AW_HOME>/push`. */
  stateDir: string;
}

function data(row: EventRow): Record<string, unknown> {
  return (row.event as { data?: Record<string, unknown> }).data ?? {};
}

const isConfirm = (answer: string) => /^confirm/i.test(answer.trim());
const isApprove = (answer: string) => /^approve/i.test(answer.trim());
const isRequestChanges = (answer: string) => /^request changes/i.test(answer.trim());
const isReject = (answer: string) => /^reject/i.test(answer.trim());

/** The version of an approach gate file `approach/v<n>.md`, or null. */
export function approachVersion(gate: GateView): number | null {
  const match = /^approach\/v([1-9][0-9]*)\.md$/.exec(gate.file ?? "");
  return match ? Number(match[1]) : null;
}

/** The gate id of the "Approve knowledge change" gate of a suggestion: the same on each check. */
export function knowledgeGateId(suggestion: Pick<Suggestion, "id" | "hlc">): string {
  return hookEventId(hlcMs(suggestion.hlc), `knowledge/${suggestion.id}`);
}

export class TaskLoop {
  readonly #host: LoopHost;
  readonly #o: TaskLoopOptions;
  #sync: { at: number; value: SyncCheck } | null = null;
  #sent: Map<string, number> | null = null;

  constructor(host: LoopHost, options: TaskLoopOptions) {
    this.#host = host;
    this.#o = options;
  }

  get #aw(): string {
    return `aw@${this.#host.me}`;
  }

  #parent(task: TaskView): TaskView | null {
    return task.parent ? (this.#host.task(task.parent) ?? null) : null;
  }

  // ---- Stages ------------------------------------------------------------------------------

  /** The stage of a task at its first claim: Discuss, or Ready for a subtask with an approach. */
  firstStage(task: TaskView): Stage {
    return firstStage(task, this.#parent(task));
  }

  async #stage(task: TaskView, from: Stage, to: Stage): Promise<void> {
    await this.#host.write(task.id, "task.stage_changed", { from, to }, this.#aw);
  }

  /** The effects of a gate resolution of the session device (docs/workflow.md 3). */
  async resolved(task: TaskView, gate: GateView, answer: string): Promise<void> {
    if (gate.kind === "confirm_approach" && isConfirm(answer) && task.stage === "discuss") {
      await this.#stage(task, "discuss", "ready");
    } else if (gate.kind === "approve_result" && isRequestChanges(answer)) {
      if (task.stage === "review") await this.#stage(task, "review", "implement");
    }
  }

  /** The line after the answer of a gate that moved the task, or null. */
  answerNote(task: TaskView, gate: GateView, answer: string): string | null {
    const key = task.key ?? task.id;
    if (gate.kind === "confirm_approach" && isConfirm(answer)) {
      const version = approachVersion(gate) ?? task.approach.confirmed ?? task.approach.latest;
      return `Approach v${version} confirmed. Run \`aw ready ${key}\` and end your turn.`;
    }
    if (gate.kind === "approve_result" && isApprove(answer)) {
      return `Result approved. Do the last steps of your workflow (for example archive, retrospective, clean-up). Record what you learned: ${learnCommands(key)}. Then run \`aw done ${key}\` or end your turn: AW then closes this session.`;
    }
    return null;
  }

  /** The approved result gate of the task whose answer reached this session, or undefined. */
  /**
   * The approved result gate whose "Result approved" this session got, or null. `midTurn` is true
   * when its UserPromptSubmit came while the result turn still ran: then the Stop of that turn is
   * no proof that the agent acted on it (fix list 0-27).
   */
  #approvalDelivered(
    record: SessionRecord,
    task: TaskView,
  ): { gate: string; at: number; midTurn: boolean } | null {
    // Only the newest result counts: after "Result approved", a newer result that waits for its
    // answer ends no task (review task-loop L1).
    const newest = task.gates.filter((g) => g.kind === "approve_result").at(-1);
    if (newest?.state !== "resolved" || !isApprove(newest.answer ?? "")) return null;
    const ids = new Set([newest.gate]);
    const row = this.#host
      .rows(task.id)
      .find(
        (r) =>
          r.type === "message.human" &&
          ids.has(String(data(r).delivery_id)) &&
          data(r).session === record.id,
      );
    if (!row) return null;
    const gate = String(data(row).delivery_id);
    return { gate, at: hlcMs(row.hlc), midTurn: record.busy_deliveries.includes(gate) };
  }

  /**
   * The Stop hook of a session: the task is Done at the first Stop after "Result approved" was
   * delivered, or after `done`. Writes `task.done` and `session.ended {reason: done}` with the
   * write of the hook (each step once), then closes the window. Returns true when it ended.
   */
  async stopped(
    record: SessionRecord,
    write: <T extends EventType>(
      step: string,
      type: T,
      data: EventData<T>,
      by: string,
    ) => Promise<void>,
  ): Promise<boolean> {
    const task = this.#host.task(record.task);
    if (!task || task.claim?.session !== record.id) return false;
    const done = task.stage === "done";
    const approval = done ? null : this.#approvalDelivered(record, task);
    if (!done && approval === null) return false;
    if (!done && approval?.midTurn) {
      // A fast "Approve" came into the result turn: the agent gets one notice as a new turn, and
      // the task is Done at the Stop of that turn, so the agent can record its learning step.
      const id = hookEventId(approval.at, `approved/${record.id}/${approval.gate}`);
      if (!this.#host.rows(task.id).some((r) => r.type === "message.sent" && r.id === id)) {
        const key = task.key ?? task.id;
        await this.notice(
          task.id,
          record.id,
          id,
          `Result of ${key} approved. Record what you learned (aw learn ${key} …, or aw learn ${key} --nothing-new), then run aw done ${key} and end your turn.`,
        );
      }
      return false;
    }
    if (!done) await write("done", "task.done", {}, this.#aw);
    // No block of done (decision D3, agent-learning): the person sees the missing learning step.
    if (!hasLearningStep(this.#host.rows(task.id))) {
      const text = noLearningComment(task.key ?? task.id);
      await write("done-learn", "comment.added", { text }, this.#aw);
    }
    await write("done-ended", "session.ended", { session: record.id, reason: "done" }, this.#aw);
    await this.#host.finish(record);
    return true;
  }

  // ---- Ready -------------------------------------------------------------------------------

  async #syncCheck(): Promise<SyncCheck> {
    const now = this.#host.clock.now();
    if (this.#sync && now - this.#sync.at < SYNC_CACHE_MS) return this.#sync.value;
    let value: SyncCheck;
    try {
      value = await this.#o.sync(this.#host.service.id);
    } catch (error) {
      value = { ok: false, text: `sync state unknown (${(error as Error).message})` };
    }
    this.#sync = { at: now, value };
    return value;
  }

  /** The id of the "Start implementing" notice of a session: one per session. */
  #startId(record: SessionRecord): string {
    const claim = this.#host.rows(record.task).find((r) => r.id === record.claim_event);
    return hookEventId(claim ? hlcMs(claim.hlc) : 0, `start/${record.id}`);
  }

  /**
   * The ready checks of a running session (docs/workflow.md 4.7). When they pass, AW moves the
   * task to Implement (when it is in Ready) and sends "Start implementing" once per session. While
   * only the sync check fails, the task has the pause `waiting_for_sync`. While the task has a
   * pause of another cause, the loop waits.
   */
  async check(record: SessionRecord, task: TaskView): Promise<void> {
    if (task.claim?.session !== record.id) return;
    if (task.stage !== "ready" && task.stage !== "implement") return;
    const rows = this.#host.rows(task.id);
    const startId = this.#startId(record);
    if (rows.some((r) => r.id === startId)) return;
    // The checks start after the agent reported ready in this session.
    const result = readyChecks({
      task,
      parent: this.#parent(task),
      rows,
      me: this.#host.me,
      claimEvent: record.claim_event,
      sync: { ok: true },
    });
    if (!result.readyReported) return;
    // A pause of another cause (the login, a usage limit, a restart) wins: the loop writes no sync
    // pause over it and starts nothing until it ends, so 2 writers never overwrite each other at
    // each check (fix list 0f).
    if (task.paused !== null && task.paused.cause !== "waiting_for_sync") return;
    const sync = result.pass ? await this.#syncCheck() : { ok: true as const };
    const waiting = result.pass && !sync.ok ? `Waiting for sync: ${sync.text}` : null;
    const paused = task.paused?.cause === "waiting_for_sync";
    if (waiting !== null) {
      if (!paused || task.paused?.next_step !== waiting) {
        await this.#host.write(
          task.id,
          "task.paused",
          { cause: "waiting_for_sync", next_step: waiting, needs_human: false },
          this.#aw,
        );
      }
      return;
    }
    if (paused) await this.#host.write(task.id, "task.resumed", {}, this.#aw);
    if (!result.pass) return;
    if (task.stage === "ready") await this.#stage(task, "ready", "implement");
    const key = task.key ?? task.id;
    await this.notice(
      task.id,
      record.id,
      startId,
      `Start implementing ${key}. AW checked on ${this.#host.me}: the approach is confirmed, nothing is missing, and the knowledge is in sync.`,
    );
  }

  /** Writes a notice of AW for a session (`message.sent` by `aw@<device>`, decision 3). */
  async notice(task: string, session: string, id: string, text: string): Promise<void> {
    await this.#host.write(task, "message.sent", { id, text, to_session: session }, this.#aw, {
      id,
    });
  }

  // ---- Owned tasks: parent notices, knowledge gates, pushes ---------------------------------

  /** One pass over the tasks that this device owns. Each part fails alone. */
  async tick(): Promise<void> {
    const parts: [string, () => Promise<void>][] = [
      ["parent notices", () => this.#parentNotices()],
      ["session gates", () => this.#sessionGates()],
      ["knowledge gates", () => this.#knowledgeGates()],
      ["pushes", () => this.#pushes()],
      // The key again after an edit of the bindings (a person or a tool wrote the file).
      ["push key", () => this.#o.push?.ensureBindings(this.#host.service) ?? Promise.resolve()],
    ];
    for (const [what, run] of parts) {
      try {
        await run();
      } catch (error) {
        this.#host.log.error({ err: error }, `The task loop failed in its ${what}`);
      }
    }
  }

  #doneAt(task: TaskView): number | null {
    const row = this.#host
      .rows(task.id)
      .filter((r) => r.type === "task.done" && r.applied)
      .at(-1);
    return row ? hlcMs(row.hlc) : null;
  }

  /** "Subtask AW-13 done" to the parent session, once per subtask (docs/workflow.md 4.10.4). */
  async #parentNotices(): Promise<void> {
    const service = this.#host.service;
    for (const parent of service.view.tasks) {
      if (parent.owner !== this.#host.me || parent.archived || parent.stage === "done") continue;
      if (parent.subtasks.length === 0) continue;
      for (const id of parent.subtasks) {
        const sub = this.#host.task(id);
        if (!sub || sub.stage !== "done") continue;
        const doneAt = this.#doneAt(sub) ?? hlcMs(sub.last_hlc ?? "1970-01-01T00:00:00.000Z#0000");
        const noticeId = hookEventId(doneAt, `subtask-done/${parent.id}/${sub.id}`);
        if (this.#host.rows(parent.id).some((r) => r.id === noticeId)) continue;
        const text =
          `[AW notice ${noticeId}] Subtask ${sub.key ?? sub.id} done: ${sub.title ?? ""}`.trimEnd();
        const running = this.#host.runningSession(parent.id);
        if (running) {
          await this.notice(
            parent.id,
            running.id,
            noticeId,
            `Subtask ${sub.key ?? sub.id} done: ${sub.title ?? ""}`.trimEnd(),
          );
        } else if (!this.#host.stoppedByPerson(parent.id)) {
          // A session that a person stopped stays stopped (principle 4): the notice waits for the
          // next session that the person starts (review task-loop, workflow problem 3).
          this.#host.restartWith(parent.id, {
            id: noticeId,
            text: `${text}\n\n${readThreadLine(parent.key ?? parent.id)}`,
          });
        }
      }
    }
  }

  /**
   * Closes each open gate of an owned task that no session can use (openspec stale-gates): the
   * gate leaves Needs you on each device, and each pending answer becomes a late-answer comment.
   */
  async #sessionGates(): Promise<void> {
    const service = this.#host.service;
    for (const task of service.view.tasks) {
      if (task.owner !== this.#host.me || task.archived) continue;
      const stale = staleGates(task, this.#host.rows(task.id), this.#host.permissionTimeoutMs);
      for (const { gate, answer } of stale) {
        await this.#host.write(
          task.id,
          "gate.resolved",
          { gate: gate.gate, version: gate.version, answer_event: null, answer },
          this.#aw,
        );
        this.#host.log.info({ task: task.id, gate: gate.gate, answer }, "AW closed a gate");
      }
    }
  }

  /** "Approve knowledge change" for each pending suggestion of an owned task (decision 11). */
  async #knowledgeGates(): Promise<void> {
    const service = this.#host.service;
    if (!service.hasKnowledge) return;
    const owned = service.view.tasks.filter((t) => t.owner === this.#host.me && !t.archived);
    const gates = owned.flatMap((t) =>
      t.gates.filter((g) => g.kind === "approve_knowledge").map((g) => ({ task: t, gate: g })),
    );
    const suggestions = await service.knowledge.suggestions("all");
    const ofGate = new Map(suggestions.map((s) => [knowledgeGateId(s), s]));
    // Open a gate for each pending suggestion of an owned task.
    for (const suggestion of suggestions) {
      if (suggestion.state !== "pending" || suggestion.task === null) continue;
      const task = owned.find((t) => t.id === suggestion.task);
      if (!task || task.stage === "done") continue;
      const gate = knowledgeGateId(suggestion);
      if (task.gates.some((g) => g.gate === gate)) continue;
      const content = suggestion.content ?? "(the file is removed)";
      await this.#host.write(
        task.id,
        "gate.opened",
        {
          gate,
          kind: "approve_knowledge",
          version: 1,
          title: `Knowledge change: ${suggestion.path}`.slice(0, 500),
          text: `${suggestion.author} suggests a change of ${suggestion.path} (${suggestion.reasons.join(", ")}).\n\n${this.#host.service.files.redactText(content).slice(0, 16_000)}`,
          options: ["Approve", "Reject"],
        },
        this.#aw,
      );
    }
    // Resolve each open gate: with the first answer, or by the state of its suggestion.
    for (const { task, gate } of gates) {
      if (gate.state !== "open") continue;
      const suggestion = ofGate.get(gate.gate);
      const answer = gate.answers.find((a) => a.use === "pending" && a.version === gate.version);
      if (suggestion && suggestion.state !== "pending") {
        await this.#resolveKnowledge(
          task,
          gate,
          suggestion.state === "accepted" ? "Approved" : "Rejected",
          null,
        );
        continue;
      }
      if (!answer) continue;
      if (suggestion) {
        const comment = answer.comment ?? undefined;
        try {
          if (isReject(answer.answer)) {
            await service.knowledge.reject(suggestion.id, comment ? { comment } : {});
          } else if (isApprove(answer.answer)) {
            await service.knowledge.accept(suggestion.id, comment ? { comment } : {});
          }
        } catch (error) {
          await this.#host.write(
            task.id,
            "comment.added",
            {
              text: `AW could not apply the answer "${answer.answer}" to the knowledge suggestion ${suggestion.id}: ${(error as Error).message.slice(0, 1000)}`,
            },
            this.#aw,
          );
        }
      }
      await this.#resolveKnowledge(task, gate, answer.answer, answer.event);
    }
  }

  async #resolveKnowledge(
    task: TaskView,
    gate: GateView,
    answer: string,
    answerEvent: string | null,
  ): Promise<void> {
    await this.#host.write(
      task.id,
      "gate.resolved",
      { gate: gate.gate, version: gate.version, answer_event: answerEvent, answer },
      this.#aw,
    );
  }

  async #sentRecord(): Promise<Map<string, number>> {
    if (this.#sent) return this.#sent;
    const file = join(this.#o.stateDir, `${this.#host.service.id}.json`);
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, number>;
      this.#sent = new Map(Object.entries(parsed).filter(([, at]) => typeof at === "number"));
    } catch {
      this.#sent = new Map();
    }
    return this.#sent;
  }

  async #saveSent(sent: Map<string, number>): Promise<void> {
    const now = this.#host.clock.now();
    for (const [key, at] of sent) if (now - at > SENT_KEEP_MS) sent.delete(key);
    await mkdir(this.#o.stateDir, { recursive: true, mode: 0o700 });
    await writePrivate(
      join(this.#o.stateDir, `${this.#host.service.id}.json`),
      `${JSON.stringify(Object.fromEntries(sent))}\n`,
    );
  }

  /** The pushes and reminders of the gate table (decision 10). */
  async #pushes(): Promise<void> {
    const service = this.#host.service;
    const sent = await this.#sentRecord();
    const now = this.#host.clock.now();
    const due: DuePush[] = duePushes({
      tasks: service.view.tasks,
      me: this.#host.me,
      now,
      sent: new Set(sent.keys()),
      createdByAgent: (task) => {
        const row = this.#host.rows(task.id).find((r) => r.id === task.created?.event);
        // The same rule as the "Assign task" notification of the desktop (queue-and-assign low 3).
        return isAgentAuthor((row?.event as { by?: string } | undefined)?.by);
      },
      doneAt: (task) => this.#doneAt(task),
    });
    if (due.length === 0) return;
    for (const item of due) {
      if (this.#o.push) {
        await this.#o.push.send(service, {
          event: item.event,
          task: item.task.id,
          key: item.task.key,
          kind: item.kind,
          gate_kind: item.gateKind,
          text: item.text,
        });
      }
      sent.set(item.key, now);
      for (const key of item.covers) sent.set(key, now);
    }
    await this.#saveSent(sent);
  }
}
