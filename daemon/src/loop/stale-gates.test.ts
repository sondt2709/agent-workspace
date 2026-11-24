// Unit cases of the gates with no session (openspec stale-gates): which open gate the owner device
// closes, and with which answer.
import { TaskFold, type AnswerView, type EventRow, type GateView, type TaskView } from "@aw/core";
import { newId } from "@aw/schema";
import { describe, expect, it } from "vitest";
import { isCloseAnswer, SESSION_ENDED, staleGates, timeoutAnswer } from "./stale-gates.ts";

const T0 = Date.parse("2026-11-24T03:00:00.000Z");
const TIMEOUT = 120_000;
const S1 = "01a20bdd-0000-7000-8000-000000000001";
const S2 = "01a20bdd-0000-7000-8000-000000000002";
const hlc = (ms: number) => `${new Date(ms).toISOString()}#0000`;

let counter = 0;
function row(type: string, ms: number, data: Record<string, unknown>, applied = true): EventRow {
  counter++;
  return {
    id: newId({ now: () => ms }),
    task: "t",
    hlc: hlc(ms),
    dev: "macbook-pro",
    type,
    path: "tasks/t/log/macbook-pro.jsonl",
    line: counter,
    applied,
    reason: null,
    event: { type, data },
  };
}

function gate(id: string, kind: string, answers: Partial<AnswerView>[] = []): GateView {
  return {
    gate: id,
    kind: kind as GateView["kind"],
    version: 1,
    title: id,
    options: [],
    file: null,
    opened: { event: id, dev: "macbook-pro", hlc: hlc(T0) },
    state: "open",
    answer: null,
    answer_event: null,
    resolved_by: null,
    answers: answers.map((a) => ({
      event: "01a20bdd-0000-7000-8000-0000000000aa",
      dev: "pixel-9",
      hlc: hlc(T0),
      by: "human@pixel-9",
      version: 1,
      answer: "Allow once",
      comment: null,
      use: "pending",
      ...a,
    })),
  };
}

function view(gates: GateView[], session: string | null = S1, state = "running"): TaskView {
  const base = new TaskFold("t").toView();
  return {
    ...base,
    owner: "macbook-pro",
    gates,
    session:
      session === null
        ? null
        : {
            session,
            device: "macbook-pro",
            host: "tmux",
            state: state as "running",
            reason: null,
            cwd: "/w",
            branch: null,
            permission_mode: null,
            agent_teams: null,
            work_in: null,
          },
  };
}

const started = (s: string, ms = T0) => row("session.started", ms, { session: s });
const ended = (s: string, reason: string, ms: number) =>
  row("session.ended", ms, { session: s, reason });
const opened = (g: string, kind: string, ms: number) => row("gate.opened", ms, { gate: g, kind });
const human = (s: string, ms: number, delivery: string | null = null) =>
  row("message.human", ms, { session: s, delivery_id: delivery, text: "x" });

const answers = (rows: EventRow[], task: TaskView) =>
  Object.fromEntries(staleGates(task, rows, TIMEOUT).map((s) => [s.gate.gate, s.answer]));

describe("gates with no session", () => {
  it("closes each session gate of a stopped session, and keeps the result gate", () => {
    const rows = [
      started(S1),
      opened("cmd", "approve_command", T0 + 1000),
      opened("ask", "question", T0 + 2000),
      opened("res", "approve_result", T0 + 3000),
      opened("cus", "custom", T0 + 4000),
      ended(S1, "stopped", T0 + 60_000),
    ];
    const task = view(
      [
        gate("cmd", "approve_command", [{}]),
        gate("ask", "question"),
        gate("res", "approve_result"),
        gate("cus", "custom"),
      ],
      S1,
      "ended",
    );
    expect(answers(rows, task)).toEqual({
      cmd: SESSION_ENDED,
      ask: SESSION_ENDED,
      cus: SESSION_ENDED,
    });
  });

  it("closes only the permission gate after a crash, a move or a replace", () => {
    for (const reason of ["crashed", "moved", "replaced"]) {
      const rows = [
        started(S1),
        opened("cmd", "approve_command", T0 + 1000),
        opened("ask", "question", T0 + 2000),
        ended(S1, reason, T0 + 60_000),
      ];
      const task = view([gate("cmd", "approve_command"), gate("ask", "question")], S1, "ended");
      expect(answers(rows, task)).toEqual({ cmd: SESSION_ENDED });
    }
  });

  it("treats a gate of an earlier session as ended when the task shows another session", () => {
    // A move: the new owner writes no session.ended for the old session.
    const rows = [
      started(S1),
      opened("cmd", "approve_command", T0 + 1000),
      opened("ask", "question", T0 + 2000),
      started(S2, T0 + 60_000),
    ];
    const task = view([gate("cmd", "approve_command"), gate("ask", "question")], S2);
    expect(answers(rows, task)).toEqual({ cmd: SESSION_ENDED });
  });

  it("keeps the gates of a crashed session that runs again", () => {
    const rows = [
      started(S1),
      opened("ask", "question", T0 + 1000),
      ended(S1, "crashed", T0 + 60_000),
      row("session.resumed", T0 + 70_000, { session: S1 }),
    ];
    expect(answers(rows, view([gate("ask", "question")]))).toEqual({});
  });

  it("closes the gates of a done task", () => {
    const rows = [
      started(S1),
      opened("rep", "reply", T0 + 1000),
      opened("app", "confirm_approach", T0 + 2000),
      ended(S1, "done", T0 + 60_000),
    ];
    const task = view([gate("rep", "reply"), gate("app", "confirm_approach")], S1, "ended");
    expect(answers(rows, task)).toEqual({ rep: SESSION_ENDED, app: SESSION_ENDED });
  });

  it("keeps a permission gate after the deny while the agent waits on it", () => {
    const rows = [started(S1), human(S1, T0), opened("cmd", "approve_command", T0 + 1000)];
    expect(answers(rows, view([gate("cmd", "approve_command")]))).toEqual({});
  });

  it("closes a permission gate when its session starts a new turn", () => {
    const rows = [
      started(S1),
      human(S1, T0),
      opened("cmd", "approve_command", T0 + 1000),
      human(S1, T0 + 300_000),
    ];
    expect(answers(rows, view([gate("cmd", "approve_command")]))).toEqual({
      cmd: "Denied after 120 s",
    });
  });

  it("keeps parallel requests when the late Allow of one of them reaches the session", () => {
    const rows = [
      started(S1),
      human(S1, T0),
      opened("c1", "approve_command", T0 + 1000),
      opened("c2", "approve_command", T0 + 1010),
      human(S1, T0 + 300_000, "c1"),
    ];
    const task = view([gate("c2", "approve_command")]);
    expect(answers(rows, task)).toEqual({});
  });

  it("reads the time of a turn from its hook, not from the log order", () => {
    // The spool drained after the gate open: the prompt of the same turn is after the gate in the log.
    const prompt = { ...human(S1, T0), hlc: hlc(T0 + 5000) };
    const rows = [started(S1), opened("cmd", "approve_command", T0 + 1000), prompt];
    expect(answers(rows, view([gate("cmd", "approve_command")]))).toEqual({});
  });

  it("closes a permission gate when the session asks again more than 120 s later", () => {
    const rows = [
      started(S1),
      opened("c1", "approve_command", T0 + 1000),
      opened("c2", "approve_command", T0 + 1000 + TIMEOUT + 1),
    ];
    const task = view([gate("c1", "approve_command"), gate("c2", "approve_command")]);
    expect(answers(rows, task)).toEqual({ c1: "Denied after 120 s" });
  });

  it("leaves a pending answer of a running session to the session check", () => {
    const rows = [
      started(S1),
      opened("cmd", "approve_command", T0 + 1000),
      human(S1, T0 + 300_000),
    ];
    expect(answers(rows, view([gate("cmd", "approve_command", [{}])]))).toEqual({});
  });

  it("skips resolved gates, gates with no session and events that do not count", () => {
    const resolved = { ...gate("old", "approve_command"), state: "resolved" as const };
    const rows = [
      opened("asg", "approve_command", T0),
      started(S1, T0 + 1000),
      opened("old", "approve_command", T0 + 2000),
      ended(S1, "stopped", T0 + 3000),
      ended(S2, "stopped", T0 + 4000),
    ].map((r, i) => (i === 4 ? { ...r, applied: false } : r));
    const task = view([gate("asg", "approve_command"), resolved], S1, "ended");
    expect(answers(rows, task)).toEqual({});
  });

  it("names the close answers", () => {
    expect(timeoutAnswer(1500)).toBe("Denied after 2 s");
    expect(isCloseAnswer(SESSION_ENDED)).toBe(true);
    expect(isCloseAnswer("Denied after 120 s")).toBe(true);
    expect(isCloseAnswer("Deny")).toBe(false);
    expect(isCloseAnswer("Replaced by approach v2")).toBe(false);
  });
});
