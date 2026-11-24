// Unit tests of the pure parts of the work loop: the gate push rules, the ready checks, the sync
// check, the gate text and the credential files (add-task-loop).
import {
  createRedactor,
  FakeClock,
  TaskFold,
  type EventRow,
  type GateView,
  type TaskView,
} from "@aw/core";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/records.ts";
import {
  askGate,
  gateText,
  MAX_GATE_FILE_CHARS,
  MAX_GATE_TEXT_CHARS,
  openCustomGate,
  proposeApproach,
  type AgentContext,
  type Decision,
} from "./agent.ts";
import { writeCredentialFiles } from "./credentials.ts";
import { approachVersion, TaskLoop, type LoopHost } from "./loop.ts";
import { approachConfirmed, firstStage, readyChecks } from "./ready.ts";
import { duePushes, loginPush, OPEN_PUSH_WINDOW_MS } from "./rules.ts";
import { syncCheck } from "./sync-check.ts";

const HOUR = 3600_000;
const T0 = Date.parse("2026-11-23T10:00:00.000Z");
const hlc = (ms: number, n = 0) => `${new Date(ms).toISOString()}#${String(n).padStart(4, "0")}`;

function task(fields: Partial<TaskView> = {}): TaskView {
  const base = new TaskFold("01a206b8-f29e-7776-b986-8ff4fc98b6b4").toView();
  return {
    ...base,
    key: "AW-7",
    title: "A task",
    stage: "discuss",
    owner: "macbook-pro",
    assignee: "claude@macbook-pro",
    created: { event: "01a206b8-f29e-7776-b986-000000000001", dev: "macbook-pro", hlc: hlc(T0) },
    ...fields,
  };
}

function gate(fields: Partial<GateView> = {}): GateView {
  return {
    gate: "01a206b8-f29e-7776-b986-000000000010",
    kind: "question",
    version: 1,
    title: "Which limit?",
    options: [],
    file: null,
    opened: { event: "01a206b8-f29e-7776-b986-000000000011", dev: "macbook-pro", hlc: hlc(T0) },
    state: "open",
    answer: null,
    answer_event: null,
    resolved_by: null,
    answers: [],
    ...fields,
  };
}

function row(
  id: string,
  type: string,
  ms: number,
  data: Record<string, unknown> = {},
  dev = "macbook-pro",
): EventRow {
  return {
    id,
    hlc: hlc(ms),
    dev,
    type,
    task: "t",
    applied: true,
    reason: null,
    event: { id, hlc: hlc(ms), dev, type, data },
  } as unknown as EventRow;
}

describe("gate push rules", () => {
  const input = (tasks: TaskView[], now: number, sent: string[] = [], byAgent = false) => ({
    tasks,
    me: "macbook-pro",
    now,
    sent: new Set(sent),
    createdByAgent: () => byAgent,
    doneAt: () => null,
  });

  it("pushes a question at the open, then once at 1 h and once at 24 h", () => {
    const t = task({ gates: [gate()], assignee: "claude@macbook-pro" });
    const open = duePushes(input([t], T0 + 1000));
    expect(open.map((p) => p.key)).toEqual([`${gate().gate}:open`]);
    expect(duePushes(input([t], T0 + 1000, [open[0]!.key]))).toEqual([]);
    const hour = duePushes(input([t], T0 + HOUR, [open[0]!.key]));
    expect(hour.map((p) => p.text)).toEqual(["Reminder: Which limit?"]);
    expect(hour.map((p) => [p.kind, p.gateKind])).toEqual([["gate", "question"]]);
    expect(duePushes(input([t], T0 + 2 * HOUR, [open[0]!.key, hour[0]!.key]))).toEqual([]);
    // After a long stop, only the newest reminder, and it covers the missed ones.
    const late = duePushes(input([t], T0 + 25 * HOUR));
    expect(late).toHaveLength(1);
    expect(late[0]!.key).toBe(`${gate().gate}:${24 * HOUR}`);
    expect(late[0]!.covers).toEqual([`${gate().gate}:open`, `${gate().gate}:${HOUR}`]);
  });

  it("sends no late open push, no push of another owner, and none for knowledge", () => {
    expect(duePushes(input([task({ gates: [gate()] })], T0 + OPEN_PUSH_WINDOW_MS + 1))).toEqual([]);
    expect(duePushes(input([task({ gates: [gate()], owner: "ubuntu-01" })], T0))).toEqual([]);
    expect(
      duePushes(input([task({ gates: [gate({ kind: "approve_knowledge" })] })], T0 + 25 * HOUR)),
    ).toEqual([]);
    // Fix a file: no push at the open, a reminder after 24 h.
    const fix = task({ gates: [gate({ kind: "fix_file", title: "" })] });
    expect(duePushes(input([fix], T0))).toEqual([]);
    expect(duePushes(input([fix], T0 + 24 * HOUR)).map((p) => p.text)).toEqual([
      "Reminder: Fix a file",
    ]);
  });

  it("pushes Assign task only for a task of an agent, and reminds after 24 h", () => {
    const t = task({ assignee: null, stage: "backlog" });
    expect(duePushes(input([t], T0 + 1000, [], true)).map((p) => p.gateKind)).toEqual(["assign"]);
    expect(duePushes(input([t], T0 + 24 * HOUR, [], true)).map((p) => p.text)).toEqual([
      "Reminder: Needs you: assign A task",
    ]);
  });

  it("sends no Assign task push and no reminder for a task that a person created (L3)", () => {
    const t = task({ assignee: null, stage: "backlog" });
    expect(duePushes(input([t], T0 + 1000))).toEqual([]);
    expect(duePushes(input([t], T0 + 24 * HOUR))).toEqual([]);
    expect(duePushes(input([t], T0 + 48 * HOUR))).toEqual([]);
  });

  it("names the login pushes by their kind, with no gate kind (M23)", () => {
    expect(loginPush("login_expired", "t", "AW-7", "AW-7 · Login expired on ubuntu-01")).toEqual({
      event: null,
      task: "t",
      key: "AW-7",
      kind: "login_expired",
      gate_kind: null,
      text: "AW-7 · Login expired on ubuntu-01",
    });
    expect(loginPush("login_ends", "t", null, "x").kind).toBe("login_ends");
  });

  it("pushes Done once", () => {
    const t = task({ stage: "done" });
    const due = (sent: string[]) => duePushes({ ...input([t], T0 + 1000, sent), doneAt: () => T0 });
    expect(due([]).map((p) => p.text)).toEqual(["Done: A task"]);
    expect(due([]).map((p) => [p.kind, p.gateKind])).toEqual([["done", null]]);
    expect(due([`done:${t.id}`])).toEqual([]);
  });
});

describe("ready checks", () => {
  const claim = row("01a206b8-f29e-7776-b986-0000000000c1", "task.claimed", T0);
  const base = {
    parent: null,
    me: "macbook-pro",
    claimEvent: claim.id,
    sync: { ok: true } as const,
  };

  it("passes with a ready after the claim, a confirmed approach and an assignee", () => {
    const ready = row("01a206b8-f29e-7776-b986-0000000000c2", "task.ready", T0 + 1, {
      missing: [],
      gates: [],
    });
    const t = task({ stage: "ready", approach: { latest: 1, confirmed: 1 } });
    expect(readyChecks({ ...base, task: t, rows: [claim, ready] })).toMatchObject({
      pass: true,
      readyReported: true,
    });
    // A ready of another device or before the claim does not count.
    const other = { ...ready, dev: "ubuntu-01" };
    expect(readyChecks({ ...base, task: t, rows: [claim, other] }).readyReported).toBe(false);
    const before = row(ready.id, "task.ready", T0 - 1, {});
    expect(readyChecks({ ...base, task: t, rows: [before, claim] }).pass).toBe(false);
  });

  it("waits for open missing items, the approach, dependencies and sync", () => {
    const q = gate();
    const ready = row("01a206b8-f29e-7776-b986-0000000000c2", "task.ready", T0 + 1, {
      missing: ["test account"],
      gates: [q.gate],
    });
    const t = task({ approach: { latest: 1, confirmed: 1 }, gates: [q] });
    expect(readyChecks({ ...base, task: t, rows: [claim, ready] }).failing).toEqual([
      "1 missing item(s) wait for an answer",
    ]);
    const answered = task({ ...t, gates: [{ ...q, state: "resolved" }] });
    expect(readyChecks({ ...base, task: answered, rows: [claim, ready] }).pass).toBe(true);
    const waiting = readyChecks({
      ...base,
      task: answered,
      rows: [claim, ready],
      sync: { ok: false, text: "knowledge 92 % with ubuntu-01" },
    });
    expect(waiting.waitingForSync).toBe("Waiting for sync: knowledge 92 % with ubuntu-01");
    const deps = task({
      ...answered,
      open_dependencies: ["x"],
      approach: { latest: 1, confirmed: null },
    });
    expect(readyChecks({ ...base, task: deps, rows: [claim, ready] }).failing).toEqual([
      "the approach is not confirmed",
      "1 dependency task(s) are not done",
    ]);
  });

  it("starts a subtask at Ready with the confirmed approach of its parent", () => {
    const parent = task({ approach: { latest: 2, confirmed: 2 } });
    const sub = task({ parent: parent.id, approach: { latest: 0, confirmed: null } });
    expect(approachConfirmed(sub, parent)).toBe(true);
    expect(firstStage(sub, parent)).toBe("ready");
    // Its own approach needs its own confirm.
    const own = task({ parent: parent.id, approach: { latest: 1, confirmed: null } });
    expect(firstStage(own, parent)).toBe("discuss");
    expect(firstStage(task(), null)).toBe("discuss");
  });

  it("reads the version of an approach gate file", () => {
    expect(approachVersion(gate({ file: "approach/v3.md" }))).toBe(3);
    expect(approachVersion(gate({ file: null }))).toBeNull();
  });
});

describe("sync check", () => {
  const folder = (kind: string, inSync: boolean, completion: number | null = null) => ({
    folder: `aw-ws-${kind}`,
    workspace: "ws",
    kind: kind as "knowledge",
    needItems: inSync ? 0 : 3,
    needBytes: 0,
    remoteState: "valid",
    inSync,
    completion,
  });
  const source = (peers: unknown[]) => ({
    state: "running",
    transport: { status: () => Promise.resolve(peers as never) },
  });

  it("passes with no engine binary, and waits for an engine that does not run", async () => {
    expect(await syncCheck(null, "ws")).toEqual({ ok: true });
    expect(await syncCheck({ state: "not_installed", transport: null }, "ws")).toEqual({
      ok: true,
    });
    expect(await syncCheck({ state: "starting", transport: null }, "ws")).toEqual({
      ok: false,
      text: "the sync engine is starting",
    });
  });

  it("waits for knowledge or secure of a connected peer, not for tasks or an offline peer", async () => {
    const peers = [
      { device: "pixel-9", connected: false, folders: [folder("knowledge", false)] },
      {
        device: "ubuntu-01",
        connected: true,
        folders: [folder("tasks", false), folder("knowledge", false, 92.4), folder("secure", true)],
      },
    ];
    expect(await syncCheck(source(peers), "ws")).toEqual({
      ok: false,
      text: "knowledge 92 % with ubuntu-01",
    });
    expect(await syncCheck(source(peers), "other")).toEqual({ ok: true });
  });
});

describe("gate text and credentials", () => {
  it("writes the gate text of the shared cases (contracts/fixtures/gates)", () => {
    const fixture = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../../contracts/fixtures/gates/cases.json", import.meta.url)),
        "utf8",
      ),
    ) as { cases: { name: string; text: string; decisions: Decision[]; body: string }[] };
    for (const c of fixture.cases.filter((x) => x.text !== x.body || x.decisions.length === 0)) {
      const file = c.name.startsWith("own") ? "approach/v2.md" : "approach/v1.md";
      expect(gateText(c.body, c.decisions, file), c.name).toBe(c.text);
    }
  });

  it("lists the decisions with the recommended option, and cuts a long text", () => {
    const text = gateText(
      "# Plan",
      [{ question: "Store?", options: ["redis", "memory"], recommended: "redis" }],
      "approach/v1.md",
    );
    expect(text).toContain("1. Store?\n   Options: redis · memory\n   Recommended: redis");
    const long = gateText("x".repeat(20_000), [], "approach/v2.md");
    expect(long.length).toBeLessThan(17_000);
    expect(long).toContain("(the full text is in approach/v2.md)");
  });

  it("redacts the content before the gate title and text cuts (fix list 0-41)", async () => {
    const value = "stg_live_9f8e7d6c5b4a";
    const redactor = createRedactor([{ name: "staging-api-key", value }]);
    const writes: { type: string; data: Record<string, unknown> }[] = [];
    const ctx = {
      actor: "claude@ubuntu-01",
      task: { id: "t1", key: "AW-12", stage: "discuss", approach: { latest: 0 }, gates: [] },
      host: {
        clock: new FakeClock(Date.parse("2026-11-23T10:00:00.000Z")),
        me: "ubuntu-01",
        service: {
          files: {
            readText: () => Promise.reject(new Error("none")),
            redactText: (text: string) => redactor.redactText(text),
          },
          writeTaskFile: () => Promise.resolve(""),
        },
        write: (_task: string, type: string, data: Record<string, unknown>) => {
          writes.push({ type, data });
          return Promise.resolve({ event: {}, applied: true, reason: null });
        },
      },
    } as unknown as AgentContext;
    // The value starts at character 495 of the first line: the 500-character title cut is in it.
    const title = `# ${"t".repeat(493)}${value} end`;
    // The value starts 5 characters before the 16 KiB cut of the gate text.
    const fill = "b".repeat(MAX_GATE_TEXT_CHARS - 5 - title.length - 1);
    const body = `${title}\n${fill}${value}${"c".repeat(100)}`;
    await proposeApproach(ctx, { content: body });
    await openCustomGate(ctx, { content: body });
    const gates = writes.filter((w) => w.type === "gate.opened");
    expect(gates).toHaveLength(2);
    for (const gate of gates) {
      expect(String(gate.data.title)).not.toContain(value.slice(0, 5));
      expect(String(gate.data.text)).not.toContain(value.slice(0, 5));
      expect(String(gate.data.title)).toContain("[redac");
    }
  });

  it("asks with details: the question is the title, the details are the text (gate-context)", () => {
    const id = "01a206b8-f29e-7776-b986-000000000020";
    const same = (t: string) => t;
    const details = "## Options\n- A: one process\n- B: a service";
    const { data, file } = askGate(
      { text: "Which queue\nlibrary?", details, options: ["A", "B"] },
      id,
      "ubuntu-01",
      same,
    );
    expect(data).toMatchObject({
      gate: id,
      kind: "question",
      title: "Which queue library?",
      text: details,
      options: ["A", "B"],
      file: null,
      questions: [],
    });
    expect(file).toBeNull();
    // With no details, the gate stays as before: the first line as the title, the question as text.
    const plain = askGate(
      { text: "Which limit?\n100 or 1000", options: [] },
      id,
      "ubuntu-01",
      same,
    );
    expect([plain.data.title, plain.data.text]).toEqual([
      "Which limit?",
      "Which limit?\n100 or 1000",
    ]);
    // The push of the gate has the title, not the details.
    const t = task({ gates: [gate({ title: data.title })], assignee: "claude@macbook-pro" });
    const pushes = duePushes({
      tasks: [t],
      me: "macbook-pro",
      now: T0 + 1000,
      sent: new Set(),
      createdByAgent: () => false,
      doneAt: () => null,
    });
    expect(pushes.map((p) => p.text)).toEqual(["Which queue library?"]);
  });

  it("keeps long details in a file and the option descriptions in questions (gate-context)", () => {
    const id = "01a206b8-f29e-7776-b986-000000000021";
    const details = `${"d".repeat(40_000)}END`;
    const { data, file } = askGate(
      {
        text: "Which?",
        details,
        options: [{ label: "Library A", description: "Same process" }, "Library B"],
      },
      id,
      "ubuntu-01",
      (t) => t,
    );
    expect(file).toEqual({ path: `artifacts/ubuntu-01/text-${id}.md`, text: details });
    expect(data.file).toBe(`artifacts/ubuntu-01/text-${id}.md`);
    expect(String(data.text).length).toBeLessThan(MAX_GATE_TEXT_CHARS + 200);
    expect(data.text).toContain(`(the full text is in artifacts/ubuntu-01/text-${id}.md)`);
    expect(data.options).toEqual(["Library A", "Library B"]);
    expect(data.questions).toEqual([
      {
        question: "Which?",
        header: null,
        multi_select: false,
        options: [
          { label: "Library A", description: "Same process" },
          { label: "Library B", description: "" },
        ],
      },
    ]);
    expect(() =>
      askGate({ text: "Q", details: "  ", options: [] }, id, "ubuntu-01", (t) => t),
    ).toThrow(/details is empty/);
    expect(() =>
      askGate(
        { text: "Q", details: "x".repeat(MAX_GATE_FILE_CHARS + 1), options: [] },
        id,
        "ubuntu-01",
        (t) => t,
      ),
    ).toThrow(/longer than/);
  });

  it("redacts the question and the details before their cuts (gate-context)", () => {
    const value = "stg_live_9f8e7d6c5b4a";
    const redactor = createRedactor([{ name: "staging-api-key", value }]);
    const question = `${"q".repeat(490)}${value}`;
    const details = `${"b".repeat(MAX_GATE_TEXT_CHARS - 5)}${value}${"c".repeat(100)}`;
    const { data } = askGate(
      { text: question, details, options: [] },
      "01a206b8-f29e-7776-b986-000000000022",
      "ubuntu-01",
      (t) => redactor.redactText(t),
    );
    expect(data.title).not.toContain(value.slice(0, 5));
    expect(data.title).toContain("[redac");
    expect(data.text).not.toContain(value.slice(0, 5));
  });

  it("writes each value with mode 0600 and names the missing ones", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "aw-cred-")), "credentials");
    const missing = await writeCredentialFiles(
      dir,
      ["stripe-test", "db"],
      new Map([["db", "s3cret"]]),
    );
    expect(missing).toEqual(["stripe-test"]);
    expect(await readdir(dir)).toEqual(["db"]);
    expect(await readFile(join(dir, "db"), "utf8")).toBe("s3cret");
    expect((await stat(join(dir, "db"))).mode & 0o777).toBe(0o600);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });
});

describe("the sync pause of the ready checks (fix list 0f)", () => {
  const claim = row("01a206b8-f29e-7776-b986-0000000000c1", "task.claimed", T0);
  const ready = row("01a206b8-f29e-7776-b986-0000000000c2", "task.ready", T0 + 1, {
    missing: [],
    gates: [],
  });
  function loopOf(writes: string[]): TaskLoop {
    const host = {
      me: "macbook-pro",
      clock: new FakeClock("2026-11-23T10:00:00.000Z"),
      service: { id: "ws" },
      rows: () => [claim, ready],
      task: () => undefined,
      write: (_task: string, type: string, data: { cause?: string }) => {
        writes.push(`${type}${data.cause ? `:${data.cause}` : ""}`);
        return Promise.resolve({});
      },
    } as unknown as LoopHost;
    return new TaskLoop(host, {
      push: null,
      sync: () => Promise.resolve({ ok: false, text: "knowledge 92 % with ubuntu-01" }),
      stateDir: "/nonexistent",
    });
  }
  const record = { id: "s1", task: "t", claim_event: claim.id } as SessionRecord;
  const running = task({
    stage: "ready",
    approach: { latest: 1, confirmed: 1 },
    claim: { epoch: 1, device: "macbook-pro", session: "s1", event: claim.id },
  });

  it("writes no sync pause over the pause of another cause, so the 2 never overwrite each other", async () => {
    const writes: string[] = [];
    const loop = loopOf(writes);
    const login = {
      cause: "login_expired",
      next_step: "Sign in",
      resumes_at: null,
      needs_human: true,
    } as unknown as TaskView["paused"];
    await loop.check(record, { ...running, paused: login });
    expect(writes).toEqual([]);
    // With no other pause, the sync pause is written once.
    await loop.check(record, running);
    expect(writes).toEqual(["task.paused:waiting_for_sync"]);
  });
});

describe("Done at the Stop after Result approved (fix list 0-27)", () => {
  const claim = row("01a206b8-f29e-7776-b986-0000000000c1", "task.claimed", T0);
  const approved = gate({
    gate: "01a206b8-f29e-7776-b986-0000000000a1",
    kind: "approve_result",
    state: "resolved",
    answer: "Approve",
  });
  const human = row("01a206b8-f29e-7776-b986-0000000000a2", "message.human", T0 + 2, {
    text: `[AW answer ${approved.gate}] Approve`,
    source: "answer",
    session: "s1",
    delivery_id: approved.gate,
  });
  const review = task({
    stage: "review",
    gates: [approved],
    claim: { epoch: 1, device: "macbook-pro", session: "s1", event: claim.id },
  });
  function loopOf(writes: string[], rows: EventRow[], view: TaskView = review): TaskLoop {
    const host = {
      me: "macbook-pro",
      clock: new FakeClock("2026-11-23T10:00:00.000Z"),
      service: { id: "ws" },
      rows: () => rows,
      task: () => view,
      finish: () => Promise.resolve(),
      write: (
        _task: string,
        type: string,
        data: { text?: string },
        _by: string,
        o?: { id?: string },
      ) => {
        writes.push(type);
        rows.push(row(o?.id ?? "x", type, T0 + 3, data));
        return Promise.resolve({});
      },
    } as unknown as LoopHost;
    return new TaskLoop(host, {
      push: null,
      sync: () => Promise.resolve({ ok: true }),
      stateDir: "/x",
    });
  }
  const hookWrite = (writes: string[]) => (_step: string, type: string) => {
    writes.push(type);
    return Promise.resolve();
  };

  it("sends one notice, not Done, when the approval came into the result turn", async () => {
    const writes: string[] = [];
    const loop = loopOf(writes, [claim, human]);
    const record = { id: "s1", task: review.id, busy_deliveries: [approved.gate] } as SessionRecord;
    expect(await loop.stopped(record, hookWrite(writes))).toBe(false);
    expect(await loop.stopped(record, hookWrite(writes))).toBe(false);
    expect(writes).toEqual(["message.sent"]);
    // The next Stop ends the turn of the notice: Done.
    const after = { ...record, busy_deliveries: [] } as SessionRecord;
    expect(await loop.stopped(after, hookWrite(writes))).toBe(true);
    expect(writes).toEqual(["message.sent", "task.done", "comment.added", "session.ended"]);
  });

  it("ends no task when a newer result waits for its answer (review task-loop L1)", async () => {
    const writes: string[] = [];
    const newer = gate({ gate: "01a206b8-f29e-7776-b986-0000000000a3", kind: "approve_result" });
    const loop = loopOf(writes, [claim, human], { ...review, gates: [approved, newer] });
    const record = { id: "s1", task: review.id, busy_deliveries: [] } as unknown as SessionRecord;
    expect(await loop.stopped(record, hookWrite(writes))).toBe(false);
    expect(writes).toEqual([]);
  });
});
