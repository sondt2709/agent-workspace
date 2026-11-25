// The Activity rule of the task detail (openspec task-view-focus, phone-task-focus and
// proposal-and-discussion, docs/design.md 8.6): which event of the thread shows in the Activity tab,
// and in which of the 3 row styles. Each event shows in the Session tab (principle 8). The phone
// has the same rule (android/control Activity.kt): both tests read
// contracts/fixtures/activity/cases.json.
import { agentMessage } from "@aw/client/gates";
import type { EventRow } from "../../shared/channels.ts";
import { gateLabel } from "./model.ts";

export type ActivityPlace = "activity" | "session";

/**
 * One entry for each event type of `contracts/samples/schema-samples.json`. A test fails when a
 * type has no entry or the entry differs from `places` of the shared fixture, so a new event type
 * needs a decision here and on the phone.
 */
export const ACTIVITY: Readonly<Record<string, ActivityPlace>> = {
  // The task: what changed, as an issue shows it.
  "task.created": "activity",
  "task.assigned": "activity",
  "task.rekeyed": "activity",
  "task.edited": "activity",
  "task.stage_changed": "activity",
  "task.paused": "activity",
  "task.resumed": "activity",
  "task.done": "activity",
  "task.archived": "activity",
  "task.unarchived": "activity",
  "task.learned": "activity",
  // The conversation and the work products.
  "message.agent": "activity",
  "message.sent": "activity",
  "comment.added": "activity",
  "message.human": "activity", // only some sources: see inActivity()
  "gate.opened": "activity",
  "gate.answered": "activity",
  "proposal.proposed": "activity",
  "result.posted": "activity",
  "artifact.added": "activity",
  // A stop shows its cause (principle 2, decision 37): only some reasons, see inActivity().
  "session.ended": "activity",
  // The session detail.
  "task.claimed": "session",
  "task.released": "session",
  "task.ready": "session",
  "task.progress": "session",
  "gate.resolved": "session",
  "handoff.written": "session",
  "session.started": "session",
  "session.resumed": "session",
  "session.stop_requested": "session",
  // Workspace events: they do not belong to the task view.
  "slot.acquired": "session",
  "slot.renewed": "session",
  "slot.released": "session",
  "slot.revoked": "session",
  "queue.reordered": "session",
  "credential.added": "session",
  "credential.imported": "session",
  "credential.removed": "session",
  "project.removed": "session",
  "knowledge.changed": "session",
  "knowledge.undo_requested": "session",
  "knowledge.suggested": "session",
  "knowledge.suggestion_resolved": "session",
  "device.heartbeat": "session",
};

/** The reasons of a session end that show in Activity: the work stopped and waits for a person. */
const STOPS = new Set(["stopped", "crashed"]);

/**
 * True when the row shows in Activity. A `message.human` is each input of the session: it shows
 * only when the person typed it in the terminal (source `typed` or `phone` with no delivery id).
 * Each other input repeats a text that Activity has: the first message (the description), an
 * answer (`gate.answered`), a notice of AW, or a delivered message (`message.sent`).
 * A `session.ended` shows only when the session stopped or crashed (decision 37); a done, moved or
 * replaced session shows its effect in other rows (Done, the assignment).
 * The text of an agent turn (`message.agent` source `turn`) and the nudge notice show only in
 * Session: Activity has what the agent sent to AW (openspec agent-pushes-updates). A note of AW
 * (`comment.added` by `aw@<device>`, for example "Context compacted") shows only in Session.
 */
export function inActivity(row: EventRow): boolean {
  if (ACTIVITY[row.type] !== "activity") return false;
  const data = row.event.data;
  if (row.type === "session.ended") return STOPS.has(String(data.reason));
  if (row.type === "comment.added") return !isAw(row.event.by);
  if (row.type === "message.agent") return data.source !== "turn";
  if (row.type === "message.sent") return data.kind !== "nudge";
  if (row.type !== "message.human") return true;
  const { source, delivery_id: delivery } = data;
  return (
    (source === "typed" || source === "phone") && (delivery === null || delivery === undefined)
  );
}

const NO_NEW_SESSION = "AW starts no new session until a person starts one.";

/**
 * The line of an Activity row that has its own text in Activity, or null for the usual text. A
 * stopped or crashed session shows its cause and when the work continues (principle 2).
 */
export function activityLine(row: EventRow): string | null {
  if (row.type !== "session.ended") return null;
  switch (row.event.data.reason) {
    case "stopped":
      return `Session stopped on ${row.dev}: a person stopped it or ended the agent. ${NO_NEW_SESSION}`;
    case "crashed":
      return `Session crashed on ${row.dev}: the agent process ended and AW did not restart it. ${NO_NEW_SESSION}`;
    default:
      return null;
  }
}

/** The text of an agent message that Activity shows first: at most 6 lines. */
export const CLAMP_LINES = 6;

export function clampText(text: string): { head: string; cut: boolean } {
  const lines = text.split("\n");
  if (lines.length <= CLAMP_LINES) return { head: text, cut: false };
  return { head: lines.slice(0, CLAMP_LINES).join("\n"), cut: true };
}

// ---- Row styles (openspec proposal-and-discussion, design decision 6) ----

/** The actor of AW itself: `aw@<device>`. */
function isAw(by: string | undefined): boolean {
  return by?.startsWith("aw@") === true;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** The author of a message row: the agent (2 px info edge) or a person (2 px outline edge). */
export type Author = "agent" | "person";

/** The style of one row with no later event: a message, a task line, or null (Session only). */
export function rowStyle(row: EventRow): {
  style: "message" | "line" | null;
  author: Author | null;
} {
  if (!inActivity(row)) return { style: null, author: null };
  switch (row.type) {
    case "message.agent":
      return { style: "message", author: "agent" };
    case "message.human":
      // A subagent report or a teammate message reads as the agent (task-review-layout).
      return {
        style: "message",
        author: agentMessage(str(row.event.data.text)) ? "agent" : "person",
      };
    case "message.sent":
    case "comment.added":
      return { style: "message", author: "person" };
    default:
      return { style: "line", author: null };
  }
}

/** The state of a proposal card: open (waits), approved, or closed with no approval. */
export type ProposalState = "open" | "approved" | "closed";

interface RowBase {
  /** The id of the event of the row. */
  event: string;
  row: EventRow;
}

/** One row of Activity. `line: null` means the usual text of the event (`systemLine`). */
export type ActivityRow =
  | (RowBase & { style: "message"; author: Author; kind: "message" })
  | (RowBase & {
      style: "message";
      author: "agent";
      kind: "question";
      gate: string;
      title: string;
      text: string;
      /** True while the question waits for an answer: no answer and no resolution. */
      open: boolean;
      /** The option buttons: only while the question is open. */
      options: string[];
      /** Why AW closed the question with no answer, for example "Replaced by a newer question". */
      note: string | null;
    })
  | (RowBase & {
      style: "message";
      author: "person";
      kind: "answer";
      gate: string;
      /** "<Gate label>: <answer>" for an answer of another gate kind; null for a question. */
      label: string | null;
      text: string;
    })
  | (RowBase & {
      style: "proposal";
      version: number;
      file: string;
      gate: string | null;
      state: ProposalState;
      /** The person who approved it, or null. */
      approvedBy: string | null;
      /** The gate text: the start of the proposal, for the time before the file loads. */
      gateText: string;
    })
  | (RowBase & { style: "line"; line: string | null })
  | (RowBase & { style: "card"; gate: string });

/** The gate kinds that show as an agent message with buttons (design decision 3). */
export const QUESTION_KINDS: ReadonlySet<string> = new Set(["question", "reply"]);

/** The answers that approve a proposal: "Approve", and "Confirm" from before the rename. */
const APPROVALS = new Set(["approve", "confirm"]);

export function approves(answer: string): boolean {
  return APPROVALS.has(answer.trim().toLowerCase());
}

interface GateFacts {
  kind: string | null;
  opened: EventRow | null;
  /** The applied answers, in merge order. */
  answers: EventRow[];
  resolved: { answer: string; answer_event: string | null } | null;
}

function gateFacts(rows: readonly EventRow[]): Map<string, GateFacts> {
  const gates = new Map<string, GateFacts>();
  const get = (id: string) => {
    let facts = gates.get(id);
    if (!facts) {
      facts = { kind: null, opened: null, answers: [], resolved: null };
      gates.set(id, facts);
    }
    return facts;
  };
  for (const row of rows) {
    const id = str(row.event.data.gate);
    if (!id) continue;
    if (row.type === "gate.opened" && !get(id).opened) {
      get(id).opened = row;
      get(id).kind = str(row.event.data.kind) || null;
    } else if (row.type === "gate.answered" && row.applied) {
      get(id).answers.push(row);
    } else if (row.type === "gate.resolved") {
      const answerEvent = row.event.data.answer_event;
      get(id).resolved = {
        answer: str(row.event.data.answer),
        answer_event: typeof answerEvent === "string" ? answerEvent : null,
      };
    }
  }
  return gates;
}

/** The answer that a gate used: the answer event of its resolution, else the first answer. */
function usedAnswer(facts: GateFacts): EventRow | null {
  const wanted = facts.resolved?.answer_event;
  if (wanted) return facts.answers.find((a) => a.id === wanted) ?? null;
  return facts.resolved ? null : (facts.answers[0] ?? null);
}

/**
 * The Activity rows of a thread page, oldest first (openspec proposal-and-discussion, design
 * decision 6): a message (agent or person, a question with its buttons while open, an answer), the
 * proposal card of the newest version, a task line (a replaced version, an approval, an answer of
 * another gate kind, the task events), and the gate card of an open gate of another kind. The
 * Assign gate is no row: the Assign card stays at the top of Activity. `rows` are in merge order.
 */
export function activityRows(rows: readonly EventRow[]): ActivityRow[] {
  const gates = gateFacts(rows);
  const versions = rows
    .filter((r) => r.type === "proposal.proposed" && typeof r.event.data.version === "number")
    .map((r) => r.event.data.version as number);
  const newest = versions.length > 0 ? Math.max(...versions) : null;
  /** The approve_proposal gate of each proposal version (by its file, else the next gate). */
  const proposalGate = new Map<number, string>();
  const versionOfGate = new Map<string, number>();
  let last: { version: number; file: string } | null = null;
  for (const row of rows) {
    const data = row.event.data;
    if (row.type === "proposal.proposed" && typeof data.version === "number") {
      last = { version: data.version, file: str(data.file) };
    }
    if (row.type === "gate.opened" && data.kind === "approve_proposal") {
      const byFile = rows.find(
        (r) =>
          r.type === "proposal.proposed" && str(r.event.data.file) === str(data.file) && data.file,
      );
      const version = byFile ? (byFile.event.data.version as number) : last?.version;
      if (version !== undefined && !proposalGate.has(version)) {
        proposalGate.set(version, str(data.gate));
        versionOfGate.set(str(data.gate), version);
      }
    }
  }
  const out: ActivityRow[] = [];
  for (const row of rows) {
    const data = row.event.data;
    const base = { event: row.id, row };
    const by = row.event.by ?? row.dev;
    if (row.type === "proposal.proposed" && typeof data.version === "number") {
      const version = data.version;
      if (version !== newest) {
        const next = Math.min(...versions.filter((v) => v > version));
        out.push({ ...base, style: "line", line: `Proposal v${version} · replaced by v${next}` });
        continue;
      }
      const gate = proposalGate.get(version) ?? null;
      const facts = gate ? gates.get(gate) : undefined;
      const used = facts ? usedAnswer(facts) : null;
      const approved = used && approves(str(used.event.data.answer)) ? used : null;
      out.push({
        ...base,
        style: "proposal",
        version,
        file: str(data.file) || `proposal/v${version}.md`,
        gate,
        state: approved ? "approved" : facts?.resolved ? "closed" : "open",
        approvedBy: approved ? (approved.event.by ?? approved.dev) : null,
        gateText: str(facts?.opened?.event.data.text),
      });
      continue;
    }
    if (row.type === "gate.opened") {
      const id = str(data.gate);
      const facts = gates.get(id)!;
      if (facts.opened !== row) continue;
      const kind = str(data.kind);
      if (QUESTION_KINDS.has(kind)) {
        const open = !facts.resolved && facts.answers.length === 0;
        const closedByAw = facts.resolved && facts.resolved.answer_event === null;
        out.push({
          ...base,
          style: "message",
          author: "agent",
          kind: "question",
          gate: id,
          title: str(data.title),
          text: str(data.text),
          open,
          options: open && Array.isArray(data.options) ? data.options.map(String) : [],
          note: closedByAw ? facts.resolved!.answer : null,
        });
      } else if (kind !== "approve_proposal" && kind !== "assign" && !facts.resolved) {
        out.push({ ...base, style: "card", gate: id });
      }
      continue;
    }
    if (row.type === "gate.answered") {
      if (!row.applied) continue;
      const id = str(data.gate);
      const facts = gates.get(id);
      const kind = facts?.kind ?? null;
      const answer = str(data.answer);
      const comment = str(data.comment);
      if (kind === "approve_proposal" && approves(answer) && facts && usedAnswer(facts) === row) {
        const version = versionOfGate.get(id);
        out.push({
          ...base,
          style: "line",
          line: `Proposal${version === undefined ? "" : ` v${version}`} approved by ${by}`,
        });
      } else if (kind === null || QUESTION_KINDS.has(kind)) {
        // A question, or a gate whose `gate.opened` is older than the page: a person message.
        const text = comment ? `${answer}\n\n${comment}` : answer;
        out.push({
          ...base,
          style: "message",
          author: "person",
          kind: "answer",
          gate: id,
          label: null,
          text,
        });
      } else if (comment) {
        const label = `${gateLabel(kind)}: ${answer}`;
        out.push({
          ...base,
          style: "message",
          author: "person",
          kind: "answer",
          gate: id,
          label,
          text: comment,
        });
      } else {
        out.push({ ...base, style: "line", line: `${by} answered ${gateLabel(kind)}: ${answer}` });
      }
      continue;
    }
    const { style, author } = rowStyle(row);
    if (style === "message") out.push({ ...base, style, author: author!, kind: "message" });
    else if (style === "line") out.push({ ...base, style, line: activityLine(row) });
  }
  return out;
}

/**
 * True when the Activity row waits for the person: an open question, an open proposal, or a gate
 * card. The header chip "Needs you" scrolls to the last such row.
 */
export function needsPerson(row: ActivityRow): boolean {
  if (row.style === "card") return true;
  if (row.style === "proposal") return row.state === "open" && row.gate !== null;
  return row.style === "message" && row.kind === "question" && row.open;
}
