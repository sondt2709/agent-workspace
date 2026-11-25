// End-to-end test of the work loop (add-task-loop) with tmux and the fake agent: Discuss → Ready →
// Implement → Review → Done, through the MCP tools of the session, and a subtask.
import type { EventRow } from "@aw/core";
import { readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  startSessionDaemon,
  TEST_TMUX,
  waitFor,
  type SessionTestDaemon,
} from "../sessions/testing.ts";

let awd: SessionTestDaemon | null = null;

afterEach(async () => {
  await awd?.close();
  awd = null;
});

const data = (row: EventRow) => (row.event as { data: Record<string, unknown> }).data;
const by = (row: EventRow) => (row.event as { by?: string }).by;
const text = (row: EventRow) =>
  typeof data(row).text === "string" ? (data(row).text as string) : "";
const stages = (rows: EventRow[]) =>
  rows
    .filter((r) => r.type === "task.stage_changed" && r.applied)
    .map((r) => `${String(data(r).from)}>${String(data(r).to)}`);

describe.skipIf(!TEST_TMUX)("the work loop", () => {
  it("runs Discuss, Ready, Implement, Review and Done with the MCP tools", async () => {
    awd = await startSessionDaemon();
    const plan = JSON.stringify({ content: "# Add a limit\n\nUse 1000/min." });
    const task = await awd.createTask(`mcp proposal ${plan}`);
    const proposal = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_proposal",
    );
    const session = awd.session(task.id);
    expect(data(proposal)).toMatchObject({
      file: "proposal/v1.md",
      title: "Add a limit",
      options: ["Approve"],
    });
    expect((await awd.task(task.id)).stage).toBe("discuss");
    // The VAPID public key of this computer is in its bindings (docs/phase-1.md 8.1).
    const bindings = join(awd.folder, "tasks", "devices", "macbook-pro", "bindings.yaml");
    await waitFor(
      async () => /vapid_public_key: "?B[A-Za-z0-9_-]{86}"?/.test(await readFile(bindings, "utf8")),
      15_000,
    );

    // Approve: the stage moves to Ready, and the answer tells the agent to run ready.
    await awd.answerFrom("pixel-9", task.id, String(data(proposal).gate), "Approve");
    const delivered = await awd.waitRow(
      task.id,
      (r) => r.type === "message.human" && data(r).delivery_id === data(proposal).gate,
    );
    expect(text(delivered)).toContain(`Proposal v1 approved. Run \`aw ready ${task.key}\``);
    expect((await awd.task(task.id)).stage).toBe("ready");
    expect((await awd.task(task.id)).proposal.approved).toBe(1);

    // A missing item is a question; "Start implementing" waits for its answer.
    await awd.sendMessage("pixel-9", task.id, session, 'mcp ready {"missing":["test account"]}');
    const missing = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).title === "Missing: test account",
    );
    await awd.waitRow(task.id, (r) => r.type === "task.ready");
    await awd.waitChecks(session, 12);
    expect((await awd.task(task.id)).stage).toBe("ready");
    await awd.answerFrom("pixel-9", task.id, String(data(missing).gate), "Use the role tester");

    // The fake agent ends the answer turns with text only: each such turn got one nudge notice
    // (openspec agent-pushes-updates), so the wait looks for "Start implementing" by its text.
    const start = await awd.waitRow(
      task.id,
      (r) =>
        r.type === "message.human" &&
        data(r).source === "notice" &&
        text(r).includes("] Start implementing "),
      30_000,
    );
    expect(
      (await awd.rows(task.id)).some((r) => r.type === "message.sent" && data(r).kind === "nudge"),
    ).toBe(true);
    expect(text(start)).toMatch(/^\[AW notice [0-9a-f-]{36}\] Start implementing /);
    expect(by(start)).toBe("aw@macbook-pro");
    expect((await awd.task(task.id)).stage).toBe("implement");

    // The result: the gate Approve result and the stage Review.
    await writeFile(join(awd.worktree(task.id), "result.md"), "# Done\n\nAll tests pass.");
    await awd.sendMessage("pixel-9", task.id, session, 'mcp result {"path":"result.md"}');
    const result = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_result",
    );
    expect(String(data(result).file)).toMatch(/^artifacts\/macbook-pro\/result-\d{8}T\d{6}\.md$/);
    await waitFor(async () => (await awd!.task(task.id)).stage === "review", 10_000);

    // Request changes: back to Implement in the same session.
    await awd.answerFrom("pixel-9", task.id, String(data(result).gate), "Request changes");
    await waitFor(async () => (await awd!.task(task.id)).stage === "implement", 10_000);
    await awd.sendMessage("pixel-9", task.id, session, 'mcp result {"path":"result.md"}');
    const second = await awd.waitRow(
      task.id,
      (r) =>
        r.type === "gate.opened" &&
        data(r).kind === "approve_result" &&
        data(r).gate !== data(result).gate,
    );

    // Approve: "Result approved" is the next input, and the Stop of that turn ends the task.
    await awd.answerFrom("pixel-9", task.id, String(data(second).gate), "Approve");
    const approved = await awd.waitRow(
      task.id,
      (r) => r.type === "message.human" && data(r).delivery_id === data(second).gate,
    );
    expect(text(approved)).toContain("Result approved.");
    const ended = await awd.waitRow(task.id, (r) => r.type === "session.ended", 20_000);
    expect(data(ended)).toMatchObject({ session, reason: "done" });
    const done = await awd.task(task.id);
    expect(done.stage).toBe("done");
    expect(stages(await awd.rows(task.id))).toEqual([
      "backlog>discuss",
      "discuss>ready",
      "ready>implement",
      "implement>review",
      "review>implement",
      "implement>review",
    ]);
    await waitFor(async () => (await awd!.host.list()).length === 0, 10_000);
    expect(awd.server.daemon.sessions!.list().find((s) => s.id === session)?.state).toBe("ended");
  }, 120_000);

  it("never delivers a replaced proposal gate to the agent as an answer", async () => {
    awd = await startSessionDaemon();
    const v1 = JSON.stringify({ content: "# Plan one\n\nStep 1." });
    const task = await awd.createTask(`mcp proposal ${v1}`);
    const first = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_proposal",
    );
    const session = awd.session(task.id);
    const v2 = JSON.stringify({ content: "# Plan two\n\nStep 2." });
    // `approach` is the old tool name: it still works (an older skill text).
    await awd.sendMessage("pixel-9", task.id, session, `mcp approach ${v2}`);
    await awd.waitRow(
      task.id,
      (r) => r.type === "gate.resolved" && data(r).gate === data(first).gate,
    );
    await awd.waitRow(
      task.id,
      (r) =>
        r.type === "gate.opened" &&
        data(r).kind === "approve_proposal" &&
        data(r).file === "proposal/v2.md",
    );
    await awd.waitChecks(session, 12);
    // gate-full-context open issue 2: "Replaced by proposal v2" is no answer of a person.
    const rows = await awd.rows(task.id);
    expect(
      rows.some((r) => r.type === "message.human" && data(r).delivery_id === data(first).gate),
    ).toBe(false);
    expect(await awd.screen(task.id)).not.toContain(`[AW answer ${String(data(first).gate)}]`);
  }, 60_000);

  it("replaces an open question with a newer question and with a proposal (proposal-and-discussion)", async () => {
    awd = await startSessionDaemon();
    const q1 = JSON.stringify({
      text: "Where do the counters live?",
      options: ["Redis", "In memory"],
    });
    const task = await awd.createTask(`mcp ask ${q1}`);
    const first = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).title === "Where do the counters live?",
    );
    const session = awd.session(task.id);
    const q2 = JSON.stringify({ text: "Limit per key or per IP?" });
    await awd.sendMessage("pixel-9", task.id, session, `mcp ask ${q2}`);
    await awd.waitRow(
      task.id,
      (r) =>
        r.type === "gate.resolved" &&
        data(r).gate === data(first).gate &&
        data(r).answer === "Replaced by a newer question",
    );
    const second = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).title === "Limit per key or per IP?",
    );
    const plan = JSON.stringify({ content: "# Rate limits\n\nOne counter per key in Redis." });
    await awd.sendMessage("pixel-9", task.id, session, `mcp proposal ${plan}`);
    await awd.waitRow(
      task.id,
      (r) =>
        r.type === "gate.resolved" &&
        data(r).gate === data(second).gate &&
        data(r).answer === "Replaced by proposal v1",
    );
    // A late answer to a replaced question is a comment: it never reaches the agent.
    await awd.answerFrom("pixel-9", task.id, String(data(first).gate), "Redis");
    await awd.waitChecks(session, 12);
    const delivered = (await awd.rows(task.id))
      .filter((r) => r.type === "message.human")
      .map((r) => data(r).delivery_id);
    expect(delivered).not.toContain(data(first).gate);
    expect(delivered).not.toContain(data(second).gate);
    const open = (await awd.task(task.id)).gates.filter((g) => g.state === "open");
    expect(open.map((g) => g.kind)).toEqual(["approve_proposal"]);
  }, 90_000);

  it("creates a subtask that waits for the human, with the copy fields of the parent", async () => {
    awd = await startSessionDaemon();
    const input = JSON.stringify({
      title: "Write the docs",
      first_message: "/opsx:explore Write the docs",
      from_parent: true,
    });
    const task = await awd.createTask(`mcp task_create ${input}`);
    const reply = await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("Created AW-"),
    );
    expect(text(reply)).toContain("It waits for the human to assign it");
    const parent = await awd.task(task.id);
    expect(parent.subtasks).toHaveLength(1);
    const sub = await awd.task(parent.subtasks[0]!);
    expect(sub).toMatchObject({
      parent: task.id,
      assignee: null,
      needs_you_lane: true,
      stage: "backlog",
    });
    const created = (await awd.rows(sub.id)).find((r) => r.type === "task.created")!;
    expect(by(created)).toBe("claude@macbook-pro");
  }, 60_000);

  it("gives an agent subtask only the credentials of its parent, and starts no subtask of an agent subtask", async () => {
    awd = await startSessionDaemon();
    const edited = await awd.aw([
      "project",
      "edit",
      "billing-api",
      "--device",
      "macbook-pro",
      "--subtasks-to-default-device",
      "on",
    ]);
    expect(edited.code, edited.stderr).toBe(0);
    const parent = await awd.createTask("reply Ready to split");
    await awd.waitRow(parent.id, (r) => r.type === "message.agent");
    const first = awd.session(parent.id);
    const client = await awd.agentClient(first);
    // Fix list 0-1: the parent has no credentials, so the agent cannot name one for a subtask.
    const refused = await client
      .createSubtask(first, { title: "Leak", first_message: "x", credentials: ["prod-db"] })
      .catch((e: unknown) => e);
    expect(refused).toMatchObject({ status: 403, code: "refused" });
    expect((refused as Error).message).toContain("prod-db");
    expect((await awd.task(parent.id)).subtasks).toHaveLength(0);
    // The switch assigns a subtask of a task that a person created.
    const a = await client.createSubtask(first, { title: "Part A", first_message: "reply A" });
    expect(a.task.assignee).toBe("claude@macbook-pro");
    await awd.waitRow(a.task.id, (r) => r.type === "message.agent" && text(r) === "A");
    // Fix list 0-4 (owner Q8): a subtask of an agent-created task waits for the human.
    const subSession = awd.session(a.task.id);
    const nested = await (
      await awd.agentClient(subSession)
    ).createSubtask(subSession, {
      title: "Part A1",
      first_message: "reply A1",
    });
    expect(nested.task.assignee).toBeNull();
    expect(nested.next).toContain("waits for the human");
    // Final check fc1-13: a subtask in another project waits for the human too, also when the
    // switch of that project is on: no session starts in another repository with no person step.
    expect((await awd.aw(["project", "add", "other-api"])).code).toBe(0);
    const other = await awd.aw([
      "project",
      "edit",
      "other-api",
      "--device",
      "macbook-pro",
      "--subtasks-to-default-device",
      "on",
    ]);
    expect(other.code, other.stderr).toBe(0);
    const moved = await client.createSubtask(first, {
      title: "Part B",
      first_message: "reply B",
      project: "other-api",
    });
    expect(moved.task.assignee).toBeNull();
  }, 90_000);

  it("starts a subtask after its dependency, and gives the notice to the next session of a stopped parent", async () => {
    awd = await startSessionDaemon();
    const parent = await awd.createTask("reply Ready to split");
    await awd.waitRow(parent.id, (r) => r.type === "message.agent");
    const first = awd.session(parent.id);
    const client = await awd.agentClient(first);
    const a = await client.createSubtask(first, {
      title: "Part A",
      first_message: "reply A started",
    });
    const b = await client.createSubtask(first, {
      title: "Part B",
      first_message: "reply B started",
      depends_on: [a.task.id],
    });
    // The human stops the parent session, then assigns both subtasks.
    await awd.aw(["session", "stop", first]);
    await awd.aw(["task", "assign", a.task.id, "claude@macbook-pro"]);
    await awd.aw(["task", "assign", b.task.id, "claude@macbook-pro"]);
    await awd.waitRow(a.task.id, (r) => r.type === "message.agent" && text(r) === "A started");
    const subSession = awd.session(a.task.id);
    await awd.waitChecks(subSession, 12);
    // B depends on A, which is not done: no claim.
    expect((await awd.rows(b.task.id)).some((r) => r.type === "task.claimed")).toBe(false);

    await writeFile(join(awd.worktree(a.task.id), "r.md"), "# Part A done");
    await awd.sendMessage("pixel-9", a.task.id, subSession, 'mcp result {"path":"r.md"}');
    const gate = await awd.waitRow(
      a.task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_result",
    );
    await awd.answerFrom("pixel-9", a.task.id, String(data(gate).gate), "Approve");
    await awd.waitRow(a.task.id, (r) => r.type === "session.ended" && data(r).reason === "done");

    // B starts now that A is done.
    await awd.waitRow(b.task.id, (r) => r.type === "task.claimed", 30_000);
    await awd.waitRow(b.task.id, (r) => r.type === "message.agent" && text(r) === "B started");
    await awd.waitChecks(awd.session(b.task.id), 12);
    // A person stopped the parent session: AW starts no session for the notice (principle 4,
    // review task-loop workflow problem 3).
    const claims = async () =>
      (await awd!.rows(parent.id))
        .filter((r) => r.type === "task.claimed")
        .map((r) => data(r).epoch);
    expect(await claims()).toEqual([1]);
    // The person starts the parent again: its new session gets the notice.
    await awd.aw(["task", "assign", parent.id, "claude@macbook-pro"]);
    const notice = await awd.waitRow(
      parent.id,
      (r) =>
        r.type === "message.human" &&
        data(r).source === "notice" &&
        text(r).includes(`] Subtask ${a.task.key} done`),
      30_000,
    );
    expect(text(notice)).toMatch(
      new RegExp(`^\\[AW notice [0-9a-f-]{36}\\] Subtask ${a.task.key} done: Part A`),
    );
    expect(await claims()).toEqual([1, 2]);
  }, 120_000);

  it("opens Approve knowledge change for a shared learn, and the answer accepts it", async () => {
    awd = await startSessionDaemon();
    const learn = JSON.stringify({ title: "Tabs", content: "Use tabs.", shared: true });
    const task = await awd.createTask(`mcp learn ${learn}`);
    const gate = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_knowledge",
      30_000,
    );
    expect(data(gate).options).toEqual(["Approve", "Reject"]);
    await awd.answerFrom("pixel-9", task.id, String(data(gate).gate), "Approve");
    await awd.waitRow(
      task.id,
      (r) => r.type === "gate.resolved" && data(r).gate === data(gate).gate,
      30_000,
    );
    const knowledge = awd.server.daemon.workspace().knowledge;
    const all = await knowledge.suggestions("all");
    expect(all.map((s) => s.state)).toEqual(["accepted"]);
  }, 90_000);

  it("gives the credential values as 0600 files, comments a missing one once, and redacts the values and the token", async () => {
    awd = await startSessionDaemon();
    const SECRET = "sk_test_session_start_7171";
    const added = await awd.aw(["credential", "add", "stripe-test"], {
      stdin: () => Promise.resolve(`${SECRET}\n`),
    });
    expect(added.code).toBe(0);
    const created = await awd.client.createTask("-", {
      project: "billing-api",
      title: "Use the key",
      first_message: "reply ready",
      assignee: "claude@macbook-pro",
      credentials: ["stripe-test", "no-such-key"],
    });
    const task = created.task.id;
    await awd.waitRow(task, (r) => r.type === "message.agent" && text(r) === "ready");
    const session = awd.session(task);
    const dir = join(awd.home, "sessions", session, "credentials");
    expect(await readdir(dir)).toEqual(["stripe-test"]);
    expect(await readFile(join(dir, "stripe-test"), "utf8")).toBe(SECRET);
    expect((await stat(join(dir, "stripe-test"))).mode & 0o777).toBe(0o600);
    const missing = (rows: EventRow[]) =>
      rows.filter((r) => r.type === "comment.added" && text(r).includes("no-such-key"));
    expect(missing(await awd.rows(task)).map(text)).toEqual([
      "Credential no-such-key has no value on macbook-pro: the session starts without it. Add the credential on a computer of the workspace.",
    ]);

    // The agent prints its token and the value: the events have the markers only.
    const token = await awd.token(session);
    const agent = await awd.agentClient(session);
    await agent.agentMessage(session, { task, text: `token ${token} key ${SECRET}` });
    const row = await awd.waitRow(
      task,
      (r) => r.type === "message.agent" && text(r).startsWith("token "),
    );
    expect(text(row)).toBe("token [redacted:mcp-token] key [redacted:stripe-test]");
    await awd.waitChecks(session);
    expect(missing(await awd.rows(task))).toHaveLength(1);
    const all = JSON.stringify([await awd.rows(task), awd.logLines()]);
    expect(all).not.toContain(token);
    expect(all).not.toContain(SECRET);
  }, 60_000);

  it("runs the loop commands of the aw CLI in a session, and refuses done before an approval", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("reply Hello");
    await awd.waitRow(task.id, (r) => r.type === "message.agent");
    const env = await awd.agentEnv(task.id);
    const cwd = awd.worktree(task.id);
    await writeFile(join(cwd, "plan.md"), "# Plan\n\nStep 1.");
    await writeFile(
      join(cwd, "decisions.json"),
      JSON.stringify([{ question: "Store?", options: ["a", "b"], recommended: "c" }]),
    );
    // Decisions are removed (proposal-and-discussion): the command says why, with exit code 2.
    const bad = await awd.aw(
      ["proposal", task.id, "--file", "plan.md", "--decisions", "decisions.json"],
      { env, cwd },
    );
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("--decisions is removed");
    // Fix list 0-3: a file outside the working folder of the session is refused, also through a
    // link, for each agent command that reads a file in the CLI.
    const outside = join(awd.home, "private.md");
    await writeFile(outside, "# Private\n\nkey-material-7788");
    await symlink(outside, join(cwd, "link.md"));
    for (const args of [
      ["proposal", task.id, "--file", outside],
      ["proposal", task.id, "--file", "link.md"],
      ["gate", "open", task.id, "--file", outside],
      ["kb", "write", "projects/billing-api/x.md", "--file", outside],
      ["learn", task.id, "--title", "X", "--file", outside],
      ["task", "create", "--title", "X", "--first-message-file", outside],
    ]) {
      const refused = await awd.aw(args, { env, cwd });
      expect(refused.code, args.join(" ")).toBe(1);
      expect(refused.stderr).toContain("is not in the working folder of the session");
    }
    expect(JSON.stringify(await awd.rows(task.id))).not.toContain("key-material-7788");
    const ok = await awd.aw(["proposal", task.id, "--file", "plan.md"], { env, cwd });
    expect(ok.stdout).toContain("Proposal v1 sent to the human as gate");
    expect(ok.code).toBe(0);
    // The old command name is an alias.
    const old = await awd.aw(["approach", task.id, "--file", "plan.md"], { env, cwd });
    expect(old.stdout).toContain("Proposal v2 sent to the human as gate");
    const done = await awd.aw(["done", task.id], { env, cwd });
    expect(done.code).toBe(1);
    expect(done.stderr).toContain("has no approved result");
    const sub = await awd.aw(
      ["task", "create", "--title", "Docs", "--first-message", "Write docs", "--from-parent"],
      { env, cwd },
    );
    expect(sub.stdout).toMatch(/^Created AW-\d+\. It waits for the human/);
    // Outside a session, --from-parent is refused and the project is needed.
    expect((await awd.aw(["task", "create", "--title", "x", "--first-message", "y"])).code).toBe(2);
  }, 60_000);
});
