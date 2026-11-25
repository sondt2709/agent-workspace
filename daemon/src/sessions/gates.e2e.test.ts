// End-to-end tests: gates from tools and from a turn that ends with a question, the first message
// with special characters, a move and a forced stop by process group, and the agent commands.
import type { EventRow } from "@aw/core";
import { newId } from "@aw/schema";
import { execa } from "execa";
import { existsSync } from "node:fs";
import { copyFile, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sessionPaths } from "./records.ts";
import { writeSpool } from "./spool.ts";
import { startSessionDaemon, TEST_TMUX, waitFor, type SessionTestDaemon } from "./testing.ts";

let awd: SessionTestDaemon | null = null;

afterEach(async () => {
  await awd?.close();
  awd = null;
});

const data = (row: EventRow) => (row.event as { data: Record<string, unknown> }).data;
const text = (row: EventRow) =>
  typeof data(row).text === "string" ? (data(row).text as string) : "";

async function pgidMembers(pgid: number): Promise<number> {
  const ps = await execa("ps", ["-A", "-o", "pgid="]);
  return String(ps.stdout)
    .split("\n")
    .filter((l) => Number(l.trim()) === pgid).length;
}

describe.skipIf(!TEST_TMUX)("gates, moves and agent commands", () => {
  it("makes gates of AskUserQuestion, ExitPlanMode and a turn that ends with a question", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("ask-tool Which color? | red|blue");
    const question = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "question",
    );
    const gate = String(data(question).gate);
    expect(data(question)).toMatchObject({ title: "Which color?", options: ["red", "blue"] });
    await awd.waitRow(
      task.id,
      (r) =>
        r.type === "message.agent" && text(r).includes(`AW sent this to the human as gate ${gate}`),
    );

    await awd.answerFrom("pixel-9", task.id, gate, "plan 1. Paint it red.\n2. Test it.");
    // A multi-line answer is one input with one confirmed delivery id.
    const multi = await awd.waitRow(
      task.id,
      (r) => r.type === "message.human" && data(r).delivery_id === gate,
    );
    expect(text(multi)).toBe(`[AW answer ${gate}] plan 1. Paint it red.\n2. Test it.`);
    const proposal = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_proposal",
    );
    expect(data(proposal).file).toBe("proposal/v1.md");
    expect(data(proposal).options).toEqual(["Approve"]);
    expect(await readFile(join(awd.folder, "tasks", task.id, "proposal", "v1.md"), "utf8")).toBe(
      "1. Paint it red.",
    );
    expect((await awd.rows(task.id)).some((r) => r.type === "proposal.proposed")).toBe(true);

    await awd.answerFrom(
      "pixel-9",
      task.id,
      String(data(proposal).gate),
      "reply Do you want the 1000/min limit?",
    );
    const reply = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "reply",
    );
    expect(text(reply)).toBe("Do you want the 1000/min limit?");
    // The agent text of the same Stop is in the log before the gate (the log buffer).
    const rows = await awd.rows(task.id);
    const agent = rows.findIndex(
      (r) => r.type === "message.agent" && text(r) === "Do you want the 1000/min limit?",
    );
    expect(agent).toBeGreaterThan(-1);
    expect(agent).toBeLessThan(rows.findIndex((r) => r.id === reply.id));
  }, 60_000);

  it("asks with details, option descriptions, and AskUserQuestion questions (gate-context)", async () => {
    awd = await startSessionDaemon();
    const ask = JSON.stringify({
      questions: [
        {
          question: "Which queue library do we use?",
          header: "Library",
          multiSelect: false,
          options: [
            { label: "Library A", description: "Same process" },
            { label: "Library B", description: "A separate service" },
          ],
        },
        {
          question: "Which checks must run?",
          header: "Checks",
          multiSelect: true,
          options: [
            { label: "Unit tests", description: "Vitest" },
            { label: "E2E", description: "Docker" },
          ],
        },
      ],
    });
    const task = await awd.createTask(`ask-tool-json ${ask}`);
    const tool = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "question",
    );
    expect(data(tool)).toMatchObject({ title: "Which queue library do we use?", options: [] });
    expect(data(tool).questions).toEqual([
      {
        question: "Which queue library do we use?",
        header: "Library",
        multi_select: false,
        options: [
          { label: "Library A", description: "Same process" },
          { label: "Library B", description: "A separate service" },
        ],
      },
      {
        question: "Which checks must run?",
        header: "Checks",
        multi_select: true,
        options: [
          { label: "Unit tests", description: "Vitest" },
          { label: "E2E", description: "Docker" },
        ],
      },
    ]);
    // The answer of the question list goes to the session as one input (Claude Code format).
    const answer =
      '"Which queue library do we use?"="Library B", "Which checks must run?"="Unit tests, E2E"';
    await awd.answerFrom("pixel-9", task.id, String(data(tool).gate), answer);
    const delivered = await awd.waitRow(
      task.id,
      (r) => r.type === "message.human" && data(r).delivery_id === data(tool).gate,
    );
    expect(text(delivered)).toBe(`[AW answer ${String(data(tool).gate)}] ${answer}`);

    // aw ask with a details file of the session folder and option descriptions.
    const key = task.key!;
    const io = { env: await awd.agentEnv(task.id) };
    const cwd = awd.worktree(task.id);
    const details = `## Options\n${"- A runs in the same process.\n".repeat(800)}DETAILS-END`;
    await writeFile(join(cwd, "details.md"), details);
    const asked = await awd.aw(
      [
        "ask",
        key,
        "Which queue library?",
        "--details-file",
        join(cwd, "details.md"),
        "--option",
        "Library A::Same process",
        "--option",
        "Library B",
      ],
      io,
    );
    expect(asked.code).toBe(0);
    const id = /gate ([0-9a-f-]{36})/.exec(asked.stdout)![1]!;
    const opened = (await awd.rows(task.id)).find(
      (r) => r.type === "gate.opened" && data(r).gate === id,
    )!;
    const file = `artifacts/macbook-pro/text-${id}.md`;
    expect(data(opened)).toMatchObject({
      title: "Which queue library?",
      options: ["Library A", "Library B"],
      file,
      questions: [
        {
          question: "Which queue library?",
          options: [
            { label: "Library A", description: "Same process" },
            { label: "Library B", description: "" },
          ],
        },
      ],
    });
    expect(text(opened)).toContain(`(the full text is in ${file})`);
    expect(text(opened)).not.toContain("DETAILS-END");
    expect(await readFile(join(awd.folder, "tasks", task.id, file), "utf8")).toBe(details);
    // A short --details is the gate text; a file outside the session folder is refused.
    const short = await awd.aw(["ask", key, "Which?", "--details", "## Two options"], io);
    const shortId = /gate ([0-9a-f-]{36})/.exec(short.stdout)![1]!;
    expect((await awd.task(task.id)).gates.find((g) => g.gate === shortId)?.title).toBe("Which?");
    expect(
      text(
        (await awd.rows(task.id)).find(
          (r) => r.type === "gate.opened" && data(r).gate === shortId,
        )!,
      ),
    ).toBe("## Two options");
    const secret = join(awd.home, "notes.md");
    await writeFile(secret, "private\n");
    expect((await awd.aw(["ask", key, "Which?", "--details-file", secret], io)).code).toBe(1);
    const both = await awd.aw(["ask", key, "Which?", "--options", "a|b", "--option", "c::d"], io);
    expect(both.code).toBe(2);
    expect((await awd.aw(["ask", key, "Which?", "--details", " "], io)).code).toBe(2);
  }, 60_000);

  it("writes the prompt of the turn before an agent message, so the context stops at it (gate-context)", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("reply ready");
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "ready");
    const session = awd.session(task.id);
    const agent = await awd.agentClient(session);
    // The prompt of the turn waits in the spool (the tick drains it every 500 ms); the agent
    // writes its analysis at once, then asks.
    const at = Date.now();
    await writeSpool(
      sessionPaths(awd.home, session).spool,
      {
        event: "UserPromptSubmit",
        at,
        payload: { hook_event_name: "UserPromptSubmit", prompt: "Pick a queue library" },
      },
      at * 1000,
    );
    await agent.agentMessage(session, { task: task.id, text: "The analysis of A and B" });
    await agent.ask(session, { task: task.id, text: "Which option? (see the message above)" });
    const rows = await awd.rows(task.id);
    const at1 = rows.findIndex(
      (r) => r.type === "message.human" && text(r) === "Pick a queue library",
    );
    const at2 = rows.findIndex(
      (r) => r.type === "message.agent" && text(r) === "The analysis of A and B",
    );
    const at3 = rows.findIndex((r) => r.type === "gate.opened" && data(r).kind === "question");
    expect([at1 >= 0, at1 < at2, at2 < at3]).toEqual([true, true, true]);
  }, 60_000);

  it("passes a first message with quotes, a backtick, $(...) and 3 lines as is", async () => {
    awd = await startSessionDaemon();
    const message = 'Say "hi" and `date` $(touch pwned)\nline 2\nline 3';
    const task = await awd.createTask(message);
    const first = await awd.waitRow(
      task.id,
      (r) => r.type === "message.human" && data(r).source === "first",
    );
    expect(text(first)).toBe(message);
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === `Got: ${message}.`);
    for (const dir of [awd.home, awd.folder, awd.worktree(task.id), awd.checkout]) {
      expect(existsSync(join(dir, "pwned"))).toBe(false);
    }
    const panes = await awd.host.list();
    expect(panes.map((p) => p.name)).toEqual([`aw-${task.id}`]);
  }, 60_000);

  it("stops the session when a human moves the task, and a forced stop leaves no process", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("bash sleep 301");
    const opened = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
    );
    await awd.answerFrom("pixel-9", task.id, String(data(opened).gate), "Allow once");
    const session = awd.session(task.id);
    const pid = awd.server.daemon.sessions!.list().find((s) => s.id === session)!.pid!;
    // The agent and its sleep (sh can exec the sleep itself).
    await waitFor(async () => (await pgidMembers(pid)) >= 2, 10_000);
    await awd.aw(["task", "assign", task.id, "claude@ubuntu-01"]);
    const ended = await awd.waitRow(task.id, (r) => r.type === "session.ended");
    expect(data(ended)).toMatchObject({ session, reason: "moved" });
    await awd.waitRow(task.id, (r) => r.type === "task.released");
    expect(await pgidMembers(pid)).toBe(0);
    expect(await awd.host.list()).toEqual([]);
    expect((await awd.task(task.id)).moving_to).toBe("ubuntu-01");
    // A task of another device: this device writes no claim and starts no session.
    awd.server.daemon.sessions!.changed(awd.server.daemon.workspace().id);
    await awd.waitChecks(session, 3);
    expect((await awd.rows(task.id)).filter((r) => r.type === "task.claimed")).toHaveLength(1);
    expect(await awd.host.list()).toEqual([]);
  }, 60_000);

  it("denies aw gate answer with the AW guard, also in a wrapper (session-options)", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("ask Which region? | eu|us");
    const question = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "question",
    );
    const gate = String(data(question).gate);
    await awd.waitRow(task.id, (r) => r.type === "message.agent");
    // The agent tries to answer its own question. The deny rule of the settings matches only the
    // text, so the wrapper passes it; the PreToolUse guard of AW reads the whole command.
    await awd.sendMessage(
      "pixel-9",
      task.id,
      awd.session(task.id),
      `bash sh -c "aw gate answer ${gate} eu"`,
    );
    const denied = await awd.waitRow(
      task.id,
      (r) => r.type === "comment.added" && text(r).startsWith("AW denied Bash:"),
    );
    expect(text(denied)).toContain("it runs a command of a person");
    await awd.waitRow(
      task.id,
      (r) =>
        r.type === "message.agent" &&
        text(r).startsWith("The Bash tool was denied: AW denied this tool call"),
    );
    // No gate "Approve command": the guard denies before a permission request.
    const rows = await awd.rows(task.id);
    expect(rows.some((r) => r.type === "gate.opened" && data(r).kind === "approve_command")).toBe(
      false,
    );
    const now = (await awd.task(task.id)).gates.find((g) => g.gate === gate);
    expect(now?.state).toBe("open");
    expect(now?.answers).toEqual([]);
  }, 60_000);

  it("stops the session when a person gives the task to another agent on this device", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("reply ready");
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "ready");
    const session = awd.session(task.id);
    await awd.aw(["task", "assign", task.id, "codex@macbook-pro"]);
    const ended = await awd.waitRow(task.id, (r) => r.type === "session.ended");
    expect(data(ended)).toMatchObject({ session, reason: "replaced" });
    await awd.waitRow(task.id, (r) => r.type === "task.released");
    await waitFor(async () => (await awd!.host.list()).length === 0, 10_000);
    // The same agent again: one new session with a new claim, after the old one stopped.
    await awd.aw(["task", "assign", task.id, "claude@macbook-pro"]);
    await awd.waitRow(task.id, (r) => r.type === "task.claimed" && data(r).epoch === 2);
    await awd.waitRow(
      task.id,
      (r) =>
        r.type === "message.human" && data(r).session !== session && data(r).source === "first",
    );
    const running = awd.server.daemon.sessions!.list().filter((s) => s.state === "running");
    expect(running).toHaveLength(1);
    expect(running[0]!.id).not.toBe(session);
    expect((await awd.host.list()).filter((p) => !p.dead)).toHaveLength(1);
    // The same agent again while that session runs: it stops before the next session claims.
    const second = running[0]!.id;
    await awd.aw(["task", "assign", task.id, "claude@macbook-pro"]);
    await awd.waitRow(task.id, (r) => r.type === "task.claimed" && data(r).epoch === 3);
    const replaced = await awd.waitRow(
      task.id,
      (r) => r.type === "session.ended" && data(r).session === second,
    );
    expect(data(replaced).reason).toBe("replaced");
    const rows = await awd.rows(task.id);
    const claim3 = rows.findIndex((r) => r.type === "task.claimed" && data(r).epoch === 3);
    expect(rows.findIndex((r) => r.id === replaced.id)).toBeLessThan(claim3);
    // The claim is in the log a moment before the new session record.
    const sessions = () => awd!.server.daemon.sessions!.list();
    await waitFor(() => sessions().some((s) => s.state === "running" && s.id !== second), 10_000);
    const third = sessions().find((s) => s.state === "running")!.id;
    await awd.waitChecks(third, 3);
    expect(sessions().filter((s) => s.state === "running")).toHaveLength(1);
    expect((await awd.host.list()).filter((p) => !p.dead)).toHaveLength(1);
  }, 60_000);

  it("delivers the answer of a question of the earlier session to the new session", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("reply ready");
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "ready");
    const first = awd.session(task.id);
    await awd.sendMessage("pixel-9", task.id, first, "ask Which region? | eu|us");
    const question = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "question",
    );
    const gate = String(data(question).gate);
    // A person gives the task to the agent again: a new session claims it, the question stays open.
    await awd.aw(["task", "assign", task.id, "claude@macbook-pro"]);
    await awd.waitRow(task.id, (r) => r.type === "task.claimed" && data(r).epoch === 2);
    const human = await awd.waitRow(
      task.id,
      (r) => r.type === "message.human" && data(r).source === "first" && data(r).session !== first,
    );
    const second = String(data(human).session);
    expect((await awd.task(task.id)).gates.find((g) => g.gate === gate)?.state).toBe("open");
    await awd.answerFrom("pixel-9", task.id, gate, "eu");
    const delivered = await awd.waitRow(
      task.id,
      (r) => r.type === "message.human" && data(r).delivery_id === gate,
    );
    expect(data(delivered)).toMatchObject({ session: second, text: `[AW answer ${gate}] eu` });
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "Got: eu.");
  }, 60_000);

  it("moves a hook event that always fails out of the spool, and the next events go on", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("reply ready");
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "ready");
    const session = awd.session(task.id);
    const spool = sessionPaths(awd.home, session).spool;
    const service = awd.server.daemon.workspace();
    // A Stop event is in the log before its spool file moves to done/ (no loss on a SIGKILL).
    const at = Date.now();
    const stop = await writeSpool(
      spool,
      {
        event: "Stop",
        at,
        payload: { hook_event_name: "Stop", last_assistant_message: "on disk before done" },
        gate: null,
      },
      at * 1000,
    );
    await waitFor(() => existsSync(join(spool, "done", stop)), 10_000);
    expect(
      (await awd.rows(task.id)).some(
        (r) => r.type === "message.agent" && text(r) === "on disk before done",
      ),
    ).toBe(true);
    // awd was killed after the write and before the move to done/: the file is handled again, and
    // its event (the same id) is not written twice.
    await copyFile(join(spool, "done", stop), join(spool, stop));
    await waitFor(() => !existsSync(join(spool, stop)), 10_000);
    await awd.waitChecks(session, 2);
    const log = await readFile(
      join(awd.folder, "tasks", task.id, "log", "macbook-pro.jsonl"),
      "utf8",
    );
    expect(log.split("\n").filter((l) => l.includes('"on disk before done"'))).toHaveLength(1);
    const plan = (text: string, gate: string, at: number) =>
      writeSpool(
        spool,
        {
          event: "PreToolUse",
          at,
          payload: {
            hook_event_name: "PreToolUse",
            tool_name: "ExitPlanMode",
            tool_input: { plan: text },
            tool_use_id: `toolu_${at}`,
          },
          gate,
        },
        at * 1000,
      );
    // A retry after a crash: the version file of the first try is there, with the same plan.
    await service.writeTaskFile(`tasks/${task.id}/proposal/v1.md`, "Plan A");
    const retried = newId({ now: () => Date.now() });
    await plan("Plan A", retried, Date.now());
    const gate = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).gate === retried,
    );
    expect(data(gate).file).toBe("proposal/v1.md");
    // A file that fails each time: proposal/v2.md has another text.
    await service.writeTaskFile(`tasks/${task.id}/proposal/v2.md`, "Another plan");
    const now = Date.now();
    await plan("Plan B", newId({ now: () => now }), now);
    await writeSpool(
      spool,
      {
        event: "Stop",
        at: now + 1,
        payload: { hook_event_name: "Stop", last_assistant_message: "after the bad file" },
        gate: null,
      },
      (now + 1) * 1000,
    );
    const comment = await awd.waitRow(
      task.id,
      (r) => r.type === "comment.added" && text(r).includes("could not handle the PreToolUse"),
    );
    expect(text(comment)).toContain("proposal/v2.md exists with another text");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r) === "after the bad file",
    );
    expect(existsSync(join(spool, "failed"))).toBe(true);
  }, 60_000);

  it("runs the agent commands of a session, and refuses another task", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("reply ready");
    const other = await awd.client.createTask("-", {
      project: "billing-api",
      title: "Other",
      first_message: "x",
    });
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "ready");
    const session = awd.session(task.id);
    const key = task.key!;
    const io = { env: await awd.agentEnv(task.id) };
    expect((await awd.aw(["message", key, "Tests pass."], io)).code).toBe(0);
    expect((await awd.aw(["stage", key, "Running the tests"], io)).code).toBe(0);
    const cwd = awd.worktree(task.id);
    await writeFile(join(cwd, "report.txt"), "5 passed\n");
    const artifact = await awd.aw(["artifact", "add", key, join(cwd, "report.txt")], io);
    expect(artifact.stdout).toContain("artifacts/macbook-pro/report.txt");
    await writeFile(join(cwd, "handoff.md"), "# Handoff\n");
    expect((await awd.aw(["handoff", key, "--file", join(cwd, "handoff.md")], io)).code).toBe(0);
    // A file outside the working folder of the session, or a symlink to one, never leaves this
    // computer: exit 1, and nothing is copied (principle 4).
    const secret = join(awd.home, "secret.txt");
    await writeFile(secret, "a private key\n");
    const outsideFile = await awd.aw(["artifact", "add", key, secret], io);
    expect(outsideFile.code).toBe(1);
    expect(outsideFile.stderr).toContain("not in the working folder of the session");
    await symlink(secret, join(cwd, "link.txt"));
    expect((await awd.aw(["artifact", "add", key, join(cwd, "link.txt")], io)).code).toBe(1);
    expect((await awd.aw(["handoff", key, "--file", secret], io)).code).toBe(1);
    const refused = await awd.aw(["message", other.task.key!, "hi"], io);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("refused");
    const outside = await awd.aw(["ask", key, "Q?"]);
    expect(outside.code).toBe(2);
    expect(outside.stderr).toContain("inside an AW session");
    const started = Date.now();
    const ask = await awd.aw(["ask", key, "Which limit?", "--options", "100/min|1000/min"], io);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(ask.code).toBe(0);
    expect(ask.stdout).toContain("End your turn now");
    const askGate = /gate ([0-9a-f-]{36})/.exec(ask.stdout)![1]!;
    expect((await awd.task(task.id)).gates.find((g) => g.gate === askGate)).toMatchObject({
      state: "open",
      options: ["100/min", "1000/min"],
    });
    // The agent cannot answer its own gate, or move its own task (principle 4).
    const own = await awd.aw(["gate", "answer", askGate, "1000/min"], io);
    expect(own.code).toBe(1);
    expect(own.stderr).toContain("aw gate answer is a command of a person");
    expect((await awd.aw(["task", "assign", key, "claude@ubuntu-01"], io)).code).toBe(1);
    expect((await awd.aw(["session", "stop", session], io)).code).toBe(1);
    const gateView = (await awd.task(task.id)).gates.find((g) => g.gate === askGate);
    expect(gateView).toMatchObject({ state: "open", answers: [] });
    await expect(
      awd.client.ask("0193a7d1-0000-7000-8000-00000000dead", { task: key, text: "Q?" }),
    ).rejects.toMatchObject({ status: 403, code: "refused" });
    // The token of the session is the identity: no token, or the token of this session on
    // another session id, is refused (add-mcp-server).
    await expect(awd.client.ask(session, { task: key, text: "Q?" })).rejects.toMatchObject({
      status: 403,
      code: "refused",
    });
    const agent = await awd.agentClient(session);
    await expect(
      agent.ask("0193a7d1-0000-7000-8000-00000000dead", { task: key, text: "Q?" }),
    ).rejects.toMatchObject({ status: 403, code: "refused" });

    await awd.waitRow(task.id, (r) => r.type === "handoff.written");
    const rows = await awd.rows(task.id);
    expect(
      rows.find((r) => r.type === "message.agent" && text(r) === "Tests pass.")?.event,
    ).toMatchObject({ by: "claude@macbook-pro" });
    expect(rows.some((r) => r.type === "task.progress" && text(r) === "Running the tests")).toBe(
      true,
    );
    const added = rows.find((r) => r.type === "artifact.added")!;
    expect(data(added)).toMatchObject({ path: "artifacts/macbook-pro/report.txt", size: 9 });
    expect(
      await readFile(
        join(awd.folder, "tasks", task.id, "artifacts", "macbook-pro", "report.txt"),
        "utf8",
      ),
    ).toBe("5 passed\n");
    const copied = await readdir(join(awd.folder, "tasks", task.id, "artifacts", "macbook-pro"));
    expect(copied.sort()).toEqual([
      expect.stringMatching(/^handoff-\d{8}T\d{6}\.md$/),
      "report.txt",
    ]);
    expect(rows.filter((r) => r.type === "artifact.added")).toHaveLength(1);
    expect((await awd.rows(other.task.id)).some((r) => r.type === "message.agent")).toBe(false);

    const all = (await awd.rows(task.id)).length;
    const page = await awd.aw(["thread", key, "--from", String(all - 2), "--json"]);
    expect((JSON.parse(page.stdout) as { events: unknown[] }).events).toHaveLength(2);

    const list = await awd.aw(["session", "list"]);
    expect(list.stdout).toContain(session);
    const stop = await awd.aw(["session", "stop", session]);
    expect(stop.code).toBe(0);
    await awd.waitRow(task.id, (r) => r.type === "session.ended" && data(r).reason === "stopped");
    expect(await awd.host.list()).toEqual([]);
  }, 60_000);
});
