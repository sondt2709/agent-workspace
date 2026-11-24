// The fold of one task over its events in merge order (docs/architecture.md 4.3,
// docs/decisions/2026-11-22-device-sync.md, docs/decisions/2026-11-22-task-model.md §5,
// docs/workflow.md 3 and 4). It never reads the time or a file: the same events give the same state.
import type { AwEvent, EventOf, ProjectDocument, Stage } from "@aw/schema";
import { compareOrder, hlcIso, type OrderKey } from "./order.ts";
import type { LogLine } from "./source.ts";
import type {
  AnswerView,
  ClaimView,
  CommentView,
  EventRef,
  GateView,
  NeedsYouReason,
  PauseView,
  SessionOptionsView,
  SessionView,
  TaskView,
} from "./view.ts";

/** What the fold needs from outside the task. */
export interface TaskContext {
  /** The project document of a slug. */
  project(slug: string): ProjectDocument | undefined;
  /** The owner device of another task at a point of the merge order (for the parent rule). */
  ownerAt(task: string, key: OrderKey): string | undefined;
  /** The `revoked_at` HLC of a revoked device, else undefined (design of add-identity-and-pairing). */
  revokedAt?: (device: string) => string | undefined;
}

/**
 * True when an event comes from a revoked device after its revoke: the merge does not apply it
 * (reason `device_revoked`). An event at the revoke HLC or before it still counts.
 */
export function isAfterRevoke(
  e: { dev: string; hlc: string },
  revokedAt: ((device: string) => string | undefined) | undefined,
): boolean {
  const at = revokedAt?.(e.dev);
  return at !== undefined && e.hlc > at;
}

/** The result of the fold for one event: applied or not, and why. */
export interface Decision {
  applied: boolean;
  /** For a rejected event, the rule; for an applied event with a change of meaning, a note. */
  reason: string | null;
}

/** Events that count only from the owner device at that point (design decision 4). */
const STATE_EVENTS = new Set([
  "task.stage_changed",
  "task.paused",
  "task.resumed",
  "task.ready",
  "task.progress",
  "task.done",
  "task.learned",
  "task.released",
  "gate.opened",
  "gate.resolved",
  "approach.proposed",
  "result.posted",
  "handoff.written",
  "session.started",
  "session.resumed",
  "session.ended",
  "message.human",
  "message.agent",
]);

interface GateState {
  view: GateView;
}

function ref(e: AwEvent): EventRef {
  return { event: e.id, dev: e.dev, hlc: e.hlc };
}

export function isHuman(by: string | null | undefined): boolean {
  return typeof by === "string" && by.startsWith("human@");
}

/** The device of an assignee `agent@device`. */
export function assigneeDevice(assignee: string | null): string | null {
  if (assignee === null) return null;
  const at = assignee.indexOf("@");
  return at < 0 ? null : assignee.slice(at + 1);
}

export class TaskFold {
  readonly id: string;
  /** The last folded event, or null. */
  last: OrderKey | null = null;
  readonly decisions = new Map<string, Decision>();
  /** The owner history: the device that owns the task from each point on. */
  readonly owners: { key: OrderKey; device: string }[] = [];
  /** The count of folded events, applied or not. */
  eventCount = 0;

  created: EventRef | null = null;
  createdBy: string | null = null;
  sessionOptions: SessionOptionsView | null = null;
  createdKey: string | null = null;
  key: string | null = null;
  project: string | null = null;
  title: string | null = null;
  firstMessage: string | null = null;
  priority: string | null = null;
  stage: Stage = "backlog";
  paused: PauseView | null = null;
  assignee: string | null = null;
  claim: ClaimView | null = null;
  releasedEpoch: number | null = null;
  approach: { latest: number; confirmed: number | null } = { latest: 0, confirmed: null };
  ready: { passed_on: string | null; missing: string[] } | null = null;
  testServer: string | null = null;
  credentials: string[] = [];
  parent: string | null = null;
  dependsOn: string[] = [];
  links: string[] = [];
  branch: string | null = null;
  session: SessionView | null = null;
  sessionStarted = false;
  progress: string | null = null;
  result: string | null = null;
  artifacts: string[] = [];
  learned = false;
  archived = false;
  readonly gates = new Map<string, GateState>();
  readonly comments: CommentView[] = [];

  constructor(id: string) {
    this.id = id;
  }

  /** The owner device now. */
  get owner(): string | null {
    return this.owners.at(-1)?.device ?? null;
  }

  /** The owner device at a point of the merge order: the last owner entry at or before the key. */
  ownerAt(key: OrderKey): string | undefined {
    let owner: string | undefined;
    for (const entry of this.owners) {
      if (compareOrder(entry.key, key) > 0) break;
      owner = entry.device;
    }
    return owner;
  }

  /** True when the line sorts after the last folded event, so the fold can continue. */
  canAppend(line: LogLine): boolean {
    return this.last === null || compareOrder(this.last, line.event) < 0;
  }

  /** Folds one event. The caller gives the events in merge order. */
  apply(line: LogLine, context: TaskContext): void {
    const e = line.event;
    this.last = { hlc: e.hlc, dev: e.dev, id: e.id };
    this.eventCount++;
    if (isAfterRevoke(e, context.revokedAt)) {
      this.decisions.set(e.id, { applied: false, reason: "device_revoked" });
      return;
    }
    if (!line.known) {
      this.decisions.set(e.id, { applied: false, reason: "unknown_type" });
      return;
    }
    this.decisions.set(e.id, this.#apply(e as AwEvent, context));
  }

  #apply(e: AwEvent, context: TaskContext): Decision {
    const ok: Decision = { applied: true, reason: null };
    const reject = (reason: string): Decision => ({ applied: false, reason });
    if (STATE_EVENTS.has(e.type) && !this.#mayWriteState(e)) return reject("not_owner");

    switch (e.type) {
      case "task.created":
        return this.#created(e, context);
      case "task.claimed": {
        const data = e.data;
        if (data.device !== e.dev) return reject("claim_device_mismatch");
        // Only the device of the current assignee claims: AW never moves a task by itself
        // (docs/decisions/2026-11-23-manual-move.md items 1 and 4).
        if (assigneeDevice(this.assignee) !== e.dev) return reject("not_assignee_device");
        if (this.claim !== null && data.epoch <= this.claim.epoch) return reject("stale_claim");
        this.claim = { epoch: data.epoch, device: data.device, session: data.session, event: e.id };
        this.owners.push({ key: e, device: e.dev });
        return ok;
      }
      case "task.assigned":
        if (!this.#mayAssign(e, context)) return reject("assignment_not_allowed");
        this.assignee = e.data.assignee;
        return this.#options(e) ? ok : { applied: true, reason: "session_options_ignored" };
      case "task.edited": {
        const { field, value } = e.data;
        if (field === "title") this.title = value;
        else if (field === "priority") this.priority = value;
        else {
          if (this.sessionStarted) return reject("first_message_locked");
          this.firstMessage = value;
        }
        return ok;
      }
      case "task.rekeyed":
        if (this.created === null || e.dev !== this.created.dev) return reject("not_creator");
        if (e.data.from !== this.key) return reject("stale_rekey");
        this.key = e.data.to;
        return ok;
      case "task.archived":
        this.archived = true;
        return ok;
      case "task.unarchived":
        // A person makes the task active again; the newest of the two events wins (openspec task-actions).
        this.archived = false;
        return ok;
      case "task.stage_changed":
        this.stage = e.data.to;
        return ok;
      case "task.paused":
        this.paused = {
          cause: e.data.cause,
          since: hlcIso(e.hlc),
          resumes_at: e.data.resumes_at,
          next_step: e.data.next_step,
          needs_human: e.data.needs_human,
        };
        return ok;
      case "task.resumed":
        this.paused = null;
        return ok;
      case "task.ready":
        this.ready = {
          passed_on: e.data.missing.length === 0 ? e.dev : null,
          missing: [...e.data.missing],
        };
        return ok;
      case "task.progress":
        this.progress = e.data.text;
        return ok;
      case "task.done":
        this.stage = "done";
        return ok;
      case "task.learned":
        this.learned = true;
        return ok;
      case "task.released":
        this.releasedEpoch = e.data.epoch;
        return ok;
      case "approach.proposed":
        this.approach = {
          latest: Math.max(this.approach.latest, e.data.version),
          confirmed: this.approach.confirmed,
        };
        return ok;
      case "result.posted":
        this.result = e.data.file;
        return ok;
      case "handoff.written":
      case "message.human":
      case "message.agent":
      case "message.sent":
        return ok;
      case "artifact.added":
        this.artifacts.push(e.data.path);
        return ok;
      case "session.started":
        this.session = {
          session: e.data.session,
          device: e.dev,
          host: e.data.host,
          state: "running",
          reason: null,
          cwd: e.data.cwd,
          branch: e.data.branch,
          permission_mode: e.data.permission_mode ?? null,
          agent_teams: e.data.agent_teams ?? null,
          work_in: e.data.work_in ?? null,
        };
        if (!this.sessionStarted) this.branch ??= e.data.branch;
        this.sessionStarted = true;
        return ok;
      case "session.resumed": {
        const same = this.session?.session === e.data.session ? this.session : null;
        this.session = {
          session: e.data.session,
          device: e.dev,
          host: same?.host ?? "unknown",
          state: "running",
          reason: null,
          cwd: same?.cwd ?? null,
          branch: same?.branch ?? null,
          permission_mode: same?.permission_mode ?? null,
          agent_teams: same?.agent_teams ?? null,
          work_in: same?.work_in ?? null,
        };
        return ok;
      }
      case "session.stop_requested":
        // A request of a person; the session device acts on it (openspec session-options).
        return isHuman(e.by) ? ok : reject("not_human");
      case "session.ended":
        if (this.session?.session !== e.data.session) return reject("unknown_session");
        this.session = { ...this.session, state: "ended", reason: e.data.reason };
        return ok;
      case "comment.added":
        this.comments.push({
          ...ref(e),
          by: e.by ?? null,
          text: e.data.text,
          source: "comment",
          gate: null,
        });
        return ok;
      case "gate.opened":
        return this.#gateOpened(e);
      case "gate.answered":
        return this.#gateAnswered(e);
      case "gate.resolved":
        return this.#gateResolved(e);
      default:
        // A known type of another log kind: the reader already refuses it in a task log.
        return reject("wrong_log");
    }
  }

  /** A state event counts only from the owner, also a gate of each kind. */
  #mayWriteState(e: AwEvent): boolean {
    return this.owner !== null && this.owner === e.dev;
  }

  /** The device of the assignee while the accepted claim is on another device (a move). */
  get movingTo(): string | null {
    const target = assigneeDevice(this.assignee);
    return this.claim !== null && target !== this.claim.device ? target : null;
  }

  /**
   * An assignee counts from a human, or with the project switch on, from the owner device of the
   * parent task at that point, and then only as the first assignment of the subtask (task-model
   * decision §5.1, docs/architecture.md 4.3.1, add-task-loop): AW never changes an assignee alone.
   */
  #mayAssign(e: AwEvent, context: TaskContext): boolean {
    if (isHuman(e.by)) return true;
    if (this.assignee !== null) return false;
    if (this.parent === null || this.project === null) return false;
    const project = context.project(this.project);
    if (!project?.switches.assign_new_subtasks_to_default_device) return false;
    return context.ownerAt(this.parent, e) === e.dev;
  }

  #created(e: EventOf<"task.created">, context: TaskContext): Decision {
    if (this.created !== null) return { applied: false, reason: "duplicate_created" };
    const data = e.data;
    this.created = ref(e);
    this.createdBy = e.by ?? null;
    this.createdKey = data.key;
    this.key = data.key;
    this.project = data.project;
    this.title = data.title;
    this.firstMessage = data.first_message;
    this.parent = data.parent;
    this.dependsOn = [...data.depends_on];
    this.testServer = data.test_server;
    this.credentials = [...data.credentials];
    this.links = [...data.links];
    // Before the first claim, the creating device owns the task. A claim before task.created in
    // the order stays the owner.
    if (this.claim === null) this.owners.push({ key: e, device: e.dev });
    const options = this.#options(e);
    if (data.assignee !== null) {
      if (!this.#mayAssign(e, context)) return { applied: true, reason: "assignee_ignored" };
      this.assignee = data.assignee;
    }
    return { applied: true, reason: options ? null : "session_options_ignored" };
  }

  /**
   * Takes the session options of the event when a person wrote it: the newest such event replaces
   * the whole object. Only a person sets them (openspec session-options): an agent never gives a
   * task "skip". Returns false when the event had options that the fold ignored.
   */
  #options(e: EventOf<"task.created"> | EventOf<"task.assigned">): boolean {
    const options = e.data.session_options;
    if (options === undefined) return true;
    if (!isHuman(e.by)) return false;
    this.sessionOptions = {
      permission_mode: options.permission_mode,
      agent_teams: options.agent_teams,
      work_in: options.work_in,
      folder: options.work_in === "folder" ? options.folder : null,
    };
    return true;
  }

  #gateOpened(e: EventOf<"gate.opened">): Decision {
    const data = e.data;
    const old = this.gates.get(data.gate);
    if (old && data.version <= old.view.version) return { applied: false, reason: "stale_version" };
    if (old) {
      // The pending answers of the older version become comments.
      for (const answer of old.view.answers) {
        if (answer.use === "pending") this.#toComment(answer, data.gate);
      }
    }
    const view: GateView = {
      gate: data.gate,
      kind: data.kind,
      version: data.version,
      title: data.title,
      options: [...data.options],
      file: data.file,
      opened: ref(e),
      state: "open",
      answer: null,
      answer_event: null,
      resolved_by: null,
      answers: old ? old.view.answers : [],
    };
    this.gates.set(data.gate, { view });
    return { applied: true, reason: null };
  }

  #gateAnswered(e: EventOf<"gate.answered">): Decision {
    const data = e.data;
    const answer: AnswerView = {
      ...ref(e),
      by: e.by ?? null,
      version: data.version,
      answer: data.answer,
      comment: data.comment,
      use: "pending",
    };
    const gate = this.gates.get(data.gate)?.view;
    if (!gate) {
      this.#toComment(answer, data.gate);
      return { applied: true, reason: "gate_unknown" };
    }
    gate.answers.push(answer);
    if (gate.state !== "open" || data.version !== gate.version) {
      this.#toComment(answer, data.gate);
      return { applied: true, reason: gate.state === "open" ? "old_version" : "late_answer" };
    }
    return { applied: true, reason: null };
  }

  #gateResolved(e: EventOf<"gate.resolved">): Decision {
    const data = e.data;
    const gate = this.gates.get(data.gate)?.view;
    if (!gate) return { applied: false, reason: "gate_unknown" };
    if (gate.state !== "open") return { applied: false, reason: "already_resolved" };
    if (data.version !== gate.version) return { applied: false, reason: "stale_version" };
    this.#resolve(gate, data.answer, data.answer_event, e.dev);
    // The answer of the "Confirm" option confirms the approach (spec workspace-merge "Gate
    // answers"): the Kotlin port uses the same rule.
    if (gate.kind === "confirm_approach" && /^confirm/i.test(data.answer)) {
      // A version number above the safe integers counts as no version (the Kotlin port has the
      // same rule: a Long cannot hold each number of the file name).
      const match = /^approach\/v([1-9][0-9]*)\.md$/.exec(gate.file ?? "");
      const version = match ? Number(match[1]) : Number.NaN;
      this.approach = {
        latest: this.approach.latest,
        confirmed: Number.isSafeInteger(version) ? version : this.approach.latest,
      };
    }
    return { applied: true, reason: null };
  }

  #resolve(gate: GateView, answer: string, answerEvent: string | null, by: string): void {
    gate.state = "resolved";
    gate.answer = answer;
    gate.answer_event = answerEvent;
    gate.resolved_by = by;
    for (const item of gate.answers) {
      if (item.use !== "pending") continue;
      if (item.event === answerEvent) item.use = "used";
      else this.#toComment(item, gate.gate);
    }
  }

  /**
   * The view of the task. The fields that need other tasks (key state, subtasks, open
   * dependencies, includes) get their values in the view assembly. Each nested value is a copy, so
   * a later fold does not change an earlier view.
   */
  toView(): TaskView {
    const gates = [...this.gates.values()].map((g) => structuredClone(g.view));
    const open = gates.filter((g) => g.state === "open");
    // Only an active task is in the "Needs you" lane: an open gate of a done or archived task
    // stays in `needs_you` and `gates`, but it is no reason.
    const active = this.created !== null && this.stage !== "done" && !this.archived;
    const reasons: NeedsYouReason[] = active
      ? open.map((g) => ({
          reason: "gate",
          gate: g.gate,
          kind: g.kind,
          waiting_for_owner: g.answers.some((a) => a.use === "pending"),
        }))
      : [];
    if (active && this.assignee === null) reasons.push({ reason: "assign" });
    if (active && this.paused?.needs_human)
      reasons.push({ reason: "paused", cause: this.paused.cause });
    const comments = structuredClone(this.comments).sort((a, b) =>
      compareOrder(
        { hlc: a.hlc, dev: a.dev, id: a.event },
        { hlc: b.hlc, dev: b.dev, id: b.event },
      ),
    );
    return {
      id: this.id,
      key: this.key,
      created_key: this.createdKey,
      key_state: "ok",
      rekey_by: null,
      project: this.project,
      title: this.title,
      first_message: this.firstMessage,
      priority: this.priority,
      stage: this.stage,
      needs_you: open.map((g) => g.gate),
      needs_you_reasons: reasons,
      needs_you_lane: reasons.length > 0,
      paused: this.paused ? { ...this.paused } : null,
      assignee: this.assignee,
      owner: this.owner,
      created: this.created ? { ...this.created } : null,
      created_by: this.createdBy,
      session_options: this.sessionOptions ? { ...this.sessionOptions } : null,
      claim: this.claim ? { ...this.claim } : null,
      moving_to: this.movingTo,
      released_epoch: this.releasedEpoch,
      approach: { ...this.approach },
      ready: this.ready
        ? { passed_on: this.ready.passed_on, missing: [...this.ready.missing] }
        : null,
      test_server: this.testServer,
      credentials: [...this.credentials],
      parent: this.parent,
      subtasks: [],
      depends_on: [...this.dependsOn],
      open_dependencies: [],
      links: [...this.links],
      branch: this.branch,
      session: this.session ? { ...this.session } : null,
      progress: this.progress,
      result: this.result,
      artifacts: [...this.artifacts],
      learned: this.learned,
      archived: this.archived,
      gates,
      comments,
      includes: {},
      last_hlc: this.last?.hlc ?? null,
      event_count: this.eventCount,
    };
  }

  #toComment(answer: AnswerView, gate: string): void {
    answer.use = "comment";
    this.comments.push({
      event: answer.event,
      dev: answer.dev,
      hlc: answer.hlc,
      by: answer.by,
      text: answer.comment ? `${answer.answer}\n\n${answer.comment}` : answer.answer,
      source: "late_answer",
      gate,
    });
  }
}
