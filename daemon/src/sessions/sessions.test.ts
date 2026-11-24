// Unit tests of the session texts, the permission waits on the fake clock, the log buffer, the
// spool order and the session records.
import { createRedactor, FakeClock, type TaskView } from "@aw/core";
import { idTime } from "@aw/schema";
import { execa } from "execa";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ServiceError } from "../service/errors.ts";
import { loadSettings } from "../settings.ts";
import { memoryLogger, startTestDaemon, tempDir, type TestDaemon } from "../testing.ts";
import { BUFFER_MS, EventBuffer, MAX_TRIES, PREVIEW_CHARS } from "./buffer.ts";
import {
  continueMessage,
  endsWithQuestion,
  firstInput,
  knowledgeUnavailable,
  launchMessage,
  MAX_CONTEXT_CHARS,
  MAX_MESSAGE_ARG_BYTES,
  readyLine,
  sessionContext,
  toolSummary,
} from "./context.ts";
import {
  decisionOf,
  inputHash,
  inputKey,
  isAllow,
  PermissionWaits,
  remainingWaitMs,
} from "./permissions.ts";
import { startTmuxOutsideAwd } from "./plugins.ts";
import {
  prepareSessionFolder,
  readRecord,
  saveRecord,
  sessionPaths,
  type SessionRecord,
} from "./records.ts";
import { SessionService } from "./service.ts";
import { hookEventId, readSpool, writeSpool } from "./spool.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function task(fields: Partial<TaskView> = {}): TaskView {
  return {
    id: "0193a7c2-5b1e-7c3a-9f20-6d1e2a4b8c01",
    key: "AW-7",
    title: "Fix the flaky invoice test",
    first_message: "/opsx:explore The invoice test fails 1 time in 5.",
    project: "billing-api",
    stage: "discuss",
    assignee: "claude@macbook-pro",
    branch: "aw/AW-7",
    parent: null,
    test_server: null,
    credentials: ["stripe-test"],
    links: [],
    approach: { latest: 0, confirmed: null },
    gates: [],
    ...fields,
  } as TaskView;
}

describe("session texts", () => {
  it("gives a Discuss session the first message as is", () => {
    expect(firstInput(task(), null)).toBe("/opsx:explore The invoice test fails 1 time in 5.");
  });

  it("puts the first message first, then the approach word for word, then the thread line", () => {
    const text = firstInput(task(), "1. Retry the call.\n2. Add a test.");
    expect(text).toBe(
      "/opsx:explore The invoice test fails 1 time in 5.\n\nConfirmed approach:\n\n1. Retry the call.\n2. Add a test.\n\nRead `aw thread AW-7 --ancestors` before you act.",
    );
    expect(firstInput(task({ parent: "p" }), null)).toContain(
      "Read `aw thread AW-7 --ancestors` before you act.",
    );
    expect(text).not.toContain("aw ready");
  });

  it("gives a subtask that starts at Ready the ready step (review task-loop, workflow 2)", () => {
    for (const stage of ["backlog", "ready"] as const) {
      const text = firstInput(task({ parent: "p", stage }), "1. Retry the call.");
      expect(text.endsWith(readyLine("AW-7")), stage).toBe(true);
      expect(text).toContain("Run `aw ready AW-7`");
    }
  });

  it("keeps the SessionStart context at 10,000 characters or less, with the thread line", () => {
    const knowledge = [
      "# AW knowledge for AW-7 (project billing-api)",
      "",
      "## Read now",
      "- shared/rules/style.md (120 characters; rule)",
    ].join("\n");
    const small = sessionContext(task(), knowledge);
    expect(small).toContain("Read `aw thread AW-7 --ancestors` before you act.");
    expect(small).toContain("- Credentials: stripe-test");
    expect(small.endsWith(knowledge)).toBe(true);
    const many = [
      knowledge,
      ...Array.from(
        { length: 2000 },
        (_, i) => `- projects/billing-api/file-${i}.md: the description of file ${i}`,
      ),
    ].join("\n");
    const big = sessionContext(task(), many);
    expect(big.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    expect(big).toContain("- shared/rules/style.md (120 characters; rule)");
    expect(big.endsWith("Read `aw thread AW-7 --ancestors` before you act.")).toBe(true);
    // The cut is at a line end: each listed file line is whole.
    const lines = big.split("\n");
    expect(lines.at(-2)).toMatch(
      /^- projects\/billing-api\/file-\d+\.md: the description of file \d+$/,
    );
    expect(lines.at(-1)).toContain("more knowledge files: run `aw kb context AW-7`");
    expect(sessionContext(task(), knowledgeUnavailable(task(), "no project"))).toContain(
      "AW could not build the knowledge context: no project",
    );
  });

  it("names the interrupted step in the continue message", () => {
    expect(continueMessage("2026-11-22T10:41:40.000Z", { tool: "Bash", summary: "sleep 40" })).toBe(
      "[AW resume] AW resumed this session after the agent process stopped at 10:41:40 UTC. The interrupted step was Bash: sleep 40. Check its result before you run it again.",
    );
    expect(continueMessage("2026-11-22T10:41:40.000Z", null)).toContain("No tool was running.");
    expect(toolSummary("Write", { file_path: "/w/a.txt", content: "x" }, (t) => t)).toBe(
      "/w/a.txt",
    );
  });

  it("redacts a tool summary before the 300-character cut (fix list 0-41)", () => {
    const value = "stg_live_9f8e7d6c5b4a";
    const redactor = createRedactor([{ name: "staging-api-key", value }]);
    const redact = (text: string) => redactor.redactText(text);
    const command = `${"x".repeat(295)}${value} --rest`;
    const summary = toolSummary("Bash", { command }, redact);
    expect(summary).not.toContain(value.slice(0, 5));
    expect(summary.startsWith(`${"x".repeat(295)}[reda`)).toBe(true);
  });

  it("finds a turn that ends with a question", () => {
    expect(endsWithQuestion("Which limit do you want?")).toBe(true);
    expect(endsWithQuestion("Which limit do you want? **")).toBe(true);
    expect(endsWithQuestion("I asked: which limit? Then I ended my turn.")).toBe(false);
  });
});

describe("permission waits", () => {
  it("answers deny with interrupt after the timeout of the fake clock", async () => {
    const clock = new FakeClock();
    const waits = new PermissionWaits(clock, 120_000);
    let decision: unknown = null;
    void waits.wait("s1", "g1").then((d) => (decision = d));
    expect(waits.waiting("s1")).toBe(true);
    clock.advance(119_999);
    await flush();
    expect(decision).toBeNull();
    clock.advance(1);
    await flush();
    expect(decision).toMatchObject({ behavior: "deny", interrupt: true });
    expect((decision as { message: string }).message).toContain(
      "No answer from the human in 120 s",
    );
    expect(waits.waiting("s1")).toBe(false);
  });

  it("gives each answer only to the hook of its gate", async () => {
    const waits = new PermissionWaits(new FakeClock(), 120_000);
    const results: Record<string, unknown> = {};
    void waits.wait("s1", "g1").then((d) => (results.g1 = d));
    void waits.wait("s1", "g2").then((d) => (results.g2 = d));
    expect(waits.settle("s1", "g2", { behavior: "allow" })).toBe(1);
    await flush();
    expect(results).toEqual({ g2: { behavior: "allow" } });
    expect(waits.waiting("s1")).toBe(true);
    waits.closeAll();
    await flush();
    expect(results.g1).toBeNull();
    // A request that arrives while awd stops does not wait: the hook asks the new awd.
    expect(await waits.wait("s1", "g3")).toBeNull();
    expect(waits.waiting("s1")).toBe(false);
  });

  it("reads the answers of the gate Approve command", () => {
    expect(isAllow("Allow once")).toBe(true);
    expect(isAllow("allow for this task")).toBe(true);
    expect(isAllow("Deny")).toBe(false);
    expect(isAllow("Allowance")).toBe(false);
    expect(decisionOf("Deny", "human@pixel-9", "use perm-ok.txt")).toEqual({
      behavior: "deny",
      message: "Denied by human@pixel-9: Deny: use perm-ok.txt",
      interrupt: true,
    });
    expect(inputKey("Write", { b: 1, a: { d: 2, c: 3 } })).toBe(
      inputKey("Write", { a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(inputHash("Write", { content: "x".repeat(100_000) })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("waits only the rest of the timeout since the gate opened, also after a restart", async () => {
    expect(remainingWaitMs(1000, 1000, 120_000)).toBe(120_000);
    expect(remainingWaitMs(1000, 61_000, 120_000)).toBe(60_000);
    expect(remainingWaitMs(1000, 200_000, 120_000)).toBe(0);
    // A clock that is behind the gate time never waits more than the timeout.
    expect(remainingWaitMs(5000, 1000, 120_000)).toBe(120_000);
    const clock = new FakeClock();
    const waits = new PermissionWaits(clock, 120_000);
    let decision: unknown = null;
    void waits.wait("s1", "g1", 60_000).then((d) => (decision = d));
    clock.advance(60_000);
    await flush();
    expect(decision).toMatchObject({ behavior: "deny", interrupt: true });
  });
});

describe("session service while awd starts", () => {
  let home = "";
  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  it("answers 503 for a running session whose workspace is not attached yet, else 403", async () => {
    home = await tempDir("awss-");
    const settings = loadSettings({ AW_HOME: home, HOME: home });
    const service = new SessionService({
      settings,
      log: memoryLogger("info").log,
      clock: new FakeClock(),
    });
    const running = "0193a7d1-0000-7000-8000-000000000001";
    const stopped = "0193a7d1-0000-7000-8000-000000000002";
    for (const [id, state] of [
      [running, "running"],
      [stopped, "stopped"],
    ] as const) {
      const paths = sessionPaths(home, id);
      await prepareSessionFolder(paths);
      await writeFile(paths.record, JSON.stringify({ id, workspace: "w1", state }));
    }
    const code = (session: string) => {
      try {
        service.manager(session);
        return null;
      } catch (error) {
        return (error as ServiceError).code;
      }
    };
    // A hook of the running session tries again (503); the others are refused (403).
    expect(code(running)).toBe("not_ready");
    expect(code(stopped)).toBe("refused");
    expect(code("0193a7d1-0000-7000-8000-00000000dead")).toBe("refused");
  });
});

describe("spool and records", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("reads the spool in the order of the hooks and keeps the files private", async () => {
    dir = await tempDir("aws-");
    const paths = sessionPaths(dir, "0193a7d1-0000-7000-8000-000000000001");
    await prepareSessionFolder(paths);
    expect((await stat(paths.dir)).mode & 0o777).toBe(0o700);
    await writeSpool(
      paths.spool,
      { event: "Stop", at: 2, payload: { n: 2 }, gate: null },
      2_000_000,
    );
    await writeSpool(
      paths.spool,
      { event: "UserPromptSubmit", at: 1, payload: { n: 1 }, gate: null },
      1_000_000,
    );
    await writeSpool(
      paths.spool,
      { event: "PreToolUse", at: 3, payload: { n: 3 }, gate: "g" },
      3_000_000,
    );
    const files = await readSpool(paths.spool);
    expect(files.map((f) => f.entry?.event)).toEqual(["UserPromptSubmit", "Stop", "PreToolUse"]);
    for (const name of await readdir(paths.spool)) {
      if (name.endsWith(".json"))
        expect((await stat(join(paths.spool, name))).mode & 0o777).toBe(0o600);
    }
    const record = {
      kind: "aw-session",
      schema: 1,
      id: "0193a7d1-0000-7000-8000-000000000001",
    } as SessionRecord;
    await saveRecord(dir, {
      ...record,
      workspace: "w",
      task: "t",
      key: null,
      agent: "claude",
      epoch: 1,
      claim_event: "c",
      cwd: "/w",
      branch: null,
      state: "running",
      launch: {
        name: "AW-1",
        plugin_dir: "/p",
        settings_file: "/s",
        permission_mode: "default",
        model: null,
      },
      pane: null,
      resumes: 0,
      pending_tool: null,
      notification: null,
      first_seen: false,
      started: false,
      busy: false,
      failed_deliveries: [],
      rules: [],
      approvals: [],
    });
    expect((await stat(paths.record)).mode & 0o777).toBe(0o600);
    expect((await readRecord(dir, record.id))?.epoch).toBe(1);
    expect(JSON.parse(await readFile(paths.record, "utf8"))).toMatchObject({ kind: "aw-session" });
  });
});

describe("session log buffer", () => {
  let d: TestDaemon | null = null;
  afterEach(async () => {
    await d?.close();
    d = null;
  });

  it("writes agent text within 1 s, and an immediate event after the waiting events", async () => {
    const clock = new FakeClock(Date.now());
    d = await startTestDaemon({ workspace: true, clock });
    const service = d.server.daemon.workspace();
    const created = await d.client.createTask("-", {
      project: "billing-api",
      title: "t",
      first_message: "m",
    });
    const id = created.task.id;
    const buffer = new EventBuffer(service, clock, d.server.daemon.log);
    const log = join(d.folder, "tasks", id, "log", "macbook-pro.jsonl");
    const lines = async () => (await readFile(log, "utf8")).trim().split("\n").length;
    const before = await lines();
    buffer.later(id, "comment.added", { text: "first" }, "aw@macbook-pro");
    buffer.later(id, "comment.added", { text: "second" }, "aw@macbook-pro");
    await flush();
    expect(await lines()).toBe(before);
    clock.advance(BUFFER_MS);
    await buffer.settled();
    expect(await lines()).toBe(before + 2);
    buffer.later(id, "comment.added", { text: "third" }, "aw@macbook-pro");
    await buffer.now(id, "comment.added", { text: "now" }, "aw@macbook-pro");
    const texts = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((l) => (JSON.parse(l) as { data: { text?: string } }).data.text)
      .slice(-4);
    expect(texts).toEqual(["first", "second", "third", "now"]);
    expect(buffer.size).toBe(0);
  });

  it("redacts a long text before the preview cut (fix list 0-41)", async () => {
    const clock = new FakeClock(Date.now());
    d = await startTestDaemon({ workspace: true, clock });
    const service = d.server.daemon.workspace();
    const value = "stg_live_9f8e7d6c5b4a";
    service.setSecrets([{ name: "staging-api-key", value }]);
    const created = await d.client.createTask("-", {
      project: "billing-api",
      title: "t",
      first_message: "m",
    });
    const buffer = new EventBuffer(service, clock, d.server.daemon.log);
    // The value starts at character 1,990: the 2,000-character cut falls inside it.
    const long = `${"x".repeat(PREVIEW_CHARS - 10)}${value}${"y".repeat(40_000)}`;
    await buffer.now(created.task.id, "message.agent", { text: long, session: null }, "claude@x");
    const log = await readFile(
      join(d.folder, "tasks", created.task.id, "log", "macbook-pro.jsonl"),
      "utf8",
    );
    expect(log).not.toContain(value.slice(0, 5));
    expect(log).toContain(`${"x".repeat(PREVIEW_CHARS - 10)}[redacted:`);
  });

  it("runs the hook after each event of now(), and a hook error does not fail the event", async () => {
    const clock = new FakeClock(Date.now());
    d = await startTestDaemon({ workspace: true, clock });
    const service = d.server.daemon.workspace();
    const created = await d.client.createTask("-", {
      project: "billing-api",
      title: "t",
      first_message: "m",
    });
    const seen: string[] = [];
    const buffer = new EventBuffer(service, clock, d.server.daemon.log, (task, type) => {
      seen.push(`${task}:${type}`);
      throw new Error("hook failed");
    });
    const written = await buffer.now(created.task.id, "comment.added", { text: "c" }, "aw@x");
    expect(written.event.type).toBe("comment.added");
    expect(seen).toEqual([`${created.task.id}:comment.added`]);
  });

  it("puts a long text in an artifact, and keeps events of a failed write for the next try", async () => {
    const clock = new FakeClock(Date.now());
    d = await startTestDaemon({ workspace: true, clock });
    const service = d.server.daemon.workspace();
    const created = await d.client.createTask("-", {
      project: "billing-api",
      title: "t",
      first_message: "m",
    });
    const id = created.task.id;
    const buffer = new EventBuffer(service, clock, d.server.daemon.log);
    const log = join(d.folder, "tasks", id, "log", "macbook-pro.jsonl");
    const events = async () =>
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { type: string; data: { text?: string } });
    const tick = async () => {
      clock.advance(BUFFER_MS);
      await buffer.settled();
    };

    // A reply of 100,000 characters does not fit in a 64 KiB log line.
    const long = "x".repeat(100_000);
    await buffer.now(id, "message.agent", { text: long, session: null }, "claude@macbook-pro");
    const reply = (await events()).at(-1)!;
    expect(reply.data.text!.startsWith("x".repeat(PREVIEW_CHARS))).toBe(true);
    const path = /is in (artifacts\/macbook-pro\/text-[0-9a-f-]+\.md)\]$/.exec(
      reply.data.text!,
    )![1]!;
    expect(await readFile(join(d.folder, "tasks", id, path), "utf8")).toBe(long);

    // One failed write: the events stay in the buffer and go to disk at the next try.
    const append = service.appendTaskEvents.bind(service);
    let failures = 1;
    service.appendTaskEvents = (task, list) => {
      if (failures-- > 0) return Promise.reject(new Error("disk full"));
      return append(task, list);
    };
    buffer.later(id, "message.agent", { text: "kept", session: null }, "claude@macbook-pro");
    await tick();
    expect((await events()).some((e) => e.data.text === "kept")).toBe(false);
    expect(buffer.size).toBe(1);
    await tick();
    expect((await events()).some((e) => e.data.text === "kept")).toBe(true);

    // An event that fails each time is dropped after 3 tries, with a comment on the task.
    failures = MAX_TRIES;
    buffer.later(id, "task.progress", { text: "lost" }, "claude@macbook-pro");
    for (let i = 0; i < MAX_TRIES; i++) await tick();
    const last = (await events()).at(-1)!;
    expect(last.type).toBe("comment.added");
    expect(last.data.text).toContain("could not write a session event (task.progress)");
    expect(buffer.size).toBe(0);
    service.appendTaskEvents = append;
  });

  it("writes the event of the caller when a waiting event fails, and keeps the waiting one", async () => {
    const clock = new FakeClock(Date.now());
    d = await startTestDaemon({ workspace: true, clock });
    const service = d.server.daemon.workspace();
    const created = await d.client.createTask("-", {
      project: "billing-api",
      title: "t",
      first_message: "m",
    });
    const id = created.task.id;
    const buffer = new EventBuffer(service, clock, d.server.daemon.log);
    const log = join(d.folder, "tasks", id, "log", "macbook-pro.jsonl");
    const texts = async () =>
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((l) => (JSON.parse(l) as { data: { text?: string } }).data.text);
    const append = service.appendTaskEvents.bind(service);
    service.appendTaskEvents = (task, list) => {
      const bad = list.some((e) => (e as { data: { text?: string } }).data.text === "waiting");
      if (bad && buffer.size === 0) return Promise.reject(new Error("refused once"));
      return append(task, list);
    };
    buffer.later(id, "message.agent", { text: "waiting", session: null }, "claude@macbook-pro");
    const result = await buffer.now(id, "comment.added", { text: "claim" }, "aw@macbook-pro");
    expect(result.applied).toBe(true);
    expect((await texts()).at(-1)).toBe("claim");
    expect(buffer.size).toBe(1);
    service.appendTaskEvents = append;
    clock.advance(BUFFER_MS);
    await buffer.settled();
    expect((await texts()).slice(-2)).toEqual(["claim", "waiting"]);
    // A fixed id (a hook step) is the id of the event in the log.
    const fixed = hookEventId(clock.now(), "session/file/step");
    const step = await buffer.now(id, "comment.added", { text: "step" }, "aw@macbook-pro", {
      id: fixed,
    });
    expect(step.event.id).toBe(fixed);
  });
});

describe("hook event ids", () => {
  it("gives the same UUIDv7 to the same spool file and step, and another to another step", () => {
    const at = Date.parse("2026-11-23T10:00:00.000Z");
    const a = hookEventId(at, "s1/0001-Stop.json/message");
    expect(hookEventId(at, "s1/0001-Stop.json/message")).toBe(a);
    expect(hookEventId(at, "s1/0001-Stop.json/reply")).not.toBe(a);
    expect(hookEventId(at, "s2/0001-Stop.json/message")).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idTime(a)).toBe(at);
  });
});

describe("agent argv", () => {
  it("keeps a first input in the argv up to 96 KiB, and names the file of a longer one", () => {
    const short = "x".repeat(MAX_MESSAGE_ARG_BYTES);
    expect(launchMessage(short, "/s/first-input.md")).toBe(short);
    const long = launchMessage(`${short}y`, "/s/first-input.md");
    expect(long).toContain("Read the file /s/first-input.md first");
    expect(Buffer.byteLength(long)).toBeLessThan(1000);
  });
});

describe("tmux server outside awd", () => {
  const calls: string[] = [];
  const runner = (codes: Record<string, number>) => (command: string, args: string[]) => {
    const line = `${command} ${args.join(" ")}`;
    calls.push(line);
    const key = Object.keys(codes).find((k) => line.startsWith(k));
    return Promise.resolve({ exitCode: key === undefined ? 0 : codes[key]! });
  };
  const input = { binary: "/usr/bin/tmux", socket: "aw", configFile: "/h/run/tmux.conf" };

  it("starts aw-sessions.service when it is installed", async () => {
    calls.length = 0;
    const warnings: string[] = [];
    const started = await startTmuxOutsideAwd({
      ...input,
      platform: "linux",
      run: runner({}),
      warn: (m) => warnings.push(m),
    });
    expect(started).toBe(true);
    expect(calls).toEqual([
      "systemctl --user cat aw-sessions.service",
      "systemctl --user start aw-sessions.service",
    ]);
    expect(warnings).toEqual([]);
  });

  it("starts tmux in a systemd scope with a warning when the unit is missing", async () => {
    calls.length = 0;
    const warnings: string[] = [];
    const started = await startTmuxOutsideAwd({
      ...input,
      platform: "linux",
      run: runner({ "systemctl --user cat": 1 }),
      warn: (m) => warnings.push(m),
    });
    expect(started).toBe(true);
    expect(calls[1]).toBe(
      "systemd-run --user --scope --quiet --collect --description=AW sessions (tmux -L aw) /usr/bin/tmux -L aw -f /h/run/tmux.conf new-session -d -s aw -n aw-host -- tail -f /dev/null",
    );
    expect(warnings[0]).toContain("Run aw service install again");
  });

  it("warns and lets the host start tmux when systemd-run fails, and does nothing on macOS", async () => {
    calls.length = 0;
    const warnings: string[] = [];
    const run = runner({ "systemctl --user cat": 1, "systemd-run": 1 });
    expect(
      await startTmuxOutsideAwd({
        ...input,
        platform: "linux",
        run,
        warn: (m) => warnings.push(m),
      }),
    ).toBe(false);
    expect(warnings[0]).toContain("an awd restart can stop the sessions");
    calls.length = 0;
    expect(await startTmuxOutsideAwd({ ...input, platform: "darwin", run })).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("aw-launch", () => {
  it("exits with 3 and starts no agent when awd does not answer /readyz in the wait", async () => {
    const home = await tempDir("awl-");
    const id = "0193a7d1-0000-7000-8000-000000000002";
    const paths = sessionPaths(home, id);
    await prepareSessionFolder(paths);
    const marker = `${home}/agent-ran`;
    await writeFile(paths.firstInput, "hello");
    await writeFile(
      paths.launch,
      JSON.stringify({
        mode: "new",
        binary: "/usr/bin/touch",
        args: [marker],
        message_file: paths.firstInput,
        socket: `${home}/run/awd.sock`,
        env: {},
        trust: false,
        state_file: `${home}/.claude.json`,
        backup_dir: `${home}/backups`,
        ready_wait_ms: 1000,
      }),
    );
    const started = Date.now();
    const result = await execa(
      process.execPath,
      [fileURLToPath(new URL("../bin/aw-launch.ts", import.meta.url)), id],
      { env: { ...process.env, AW_HOME: home, HOME: home }, reject: false },
    );
    expect(result.exitCode).toBe(3);
    expect(String(result.stderr)).toContain("did not answer /readyz");
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
    await expect(stat(marker)).rejects.toThrow(/ENOENT/);
    await rm(home, { recursive: true, force: true });
  });
});
