// End-to-end tests of the MCP server (add-mcp-server, test plan 1): the SDK client calls each tool
// against awd with a running session (the fake agent in tmux) and its session token.
import type { EventRow } from "@aw/core";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  startSessionDaemon,
  TEST_TMUX,
  waitFor,
  type SessionTestDaemon,
} from "../sessions/testing.ts";
import { tempDir } from "../testing.ts";
import { tokenFile } from "./tokens.ts";
import { MCP_INSTRUCTIONS, THREAD_BUDGET } from "./tools.ts";

let awd: SessionTestDaemon | null = null;
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  await awd?.close();
  awd = null;
});

const text = (row: EventRow) => String((row.event as { data: { text?: string } }).data.text ?? "");
const data = (row: EventRow) => (row.event as { data: Record<string, unknown> }).data;
const by = (row: EventRow) => (row.event as { by: string }).by;

function url(d: SessionTestDaemon): string {
  return `http://127.0.0.1:${d.server.mcp!.port}/mcp`;
}

async function connect(d: SessionTestDaemon, token: string): Promise<Client> {
  const client = new Client({ name: "mcp-e2e", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url(d)), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  clients.push(client);
  return client;
}

type ToolReply = { isError?: boolean; body: Record<string, unknown> };

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return {
    isError: result.isError === true,
    body: JSON.parse(content[0]!.text) as Record<string, unknown>,
  } satisfies ToolReply;
}

/** A raw POST of an MCP request, for the status codes and headers. */
async function rawPost(
  d: SessionTestDaemon,
  headers: Record<string, string>,
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url(d),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
  });
}

async function readySession(d: SessionTestDaemon) {
  const task = await d.createTask("reply ready");
  await d.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "ready");
  const session = d.session(task.id);
  return { task, key: task.key!, session, token: await d.token(session) };
}

describe.skipIf(!TEST_TMUX)("the MCP server of awd", () => {
  it("calls each tool for the session of the token, with the same events as the API", async () => {
    awd = await startSessionDaemon();
    const d = awd;
    const { task, key, session, token } = await readySession(d);
    const other = await d.client.createTask("-", {
      project: "billing-api",
      title: "Other",
      first_message: "x",
    });
    const client = await connect(d, token);

    // The tool list, the hints and the instructions.
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "approach",
        "artifact_add",
        "ask",
        "done",
        "gate",
        "handoff",
        "learn",
        "message",
        "ready",
        "result",
        "slot_acquire",
        "slot_release",
        "stage",
        "task_create",
        "thread",
      ].sort(),
    );
    expect(tools.find((t) => t.name === "thread")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "ask")?.annotations?.idempotentHint).toBe(true);
    expect(client.getInstructions()).toBe(MCP_INSTRUCTIONS);
    expect(MCP_INSTRUCTIONS.length).toBeLessThan(4096);

    // thread: the same events as GET .../thread, word for word, in pages.
    const thread = await call(client, "thread", { limit: 2 });
    expect(thread.isError).toBe(false);
    const api = await d.client.thread("-", task.id, { limit: 1000 });
    const events = thread.body.events as { n: number; id: string; data: unknown }[];
    expect(events.map((e) => e.id)).toEqual(api.events.slice(0, 2).map((e) => e.id));
    expect(events[0]).toMatchObject({ n: 0, type: "task.created" });
    expect(thread.body.next_from).toBe(2);
    const page2 = await call(client, "thread", { from: 2, limit: 200 });
    expect((page2.body.events as { id: string }[]).map((e) => e.id)).toEqual(
      api.events.slice(2).map((e) => e.id),
    );
    expect(page2.body.next_from).toBeNull();

    // ask: the gate question by the agent; the same call again gets the same gate (retry cache).
    const ask = await call(client, "ask", {
      text: "Which limit?",
      options: ["100/min", "1000/min"],
    });
    expect(ask.isError).toBe(false);
    const gate = ask.body.gate as string;
    expect(ask.body.next).toContain("End your turn now");
    const again = await call(client, "ask", {
      text: "Which limit?",
      options: ["100/min", "1000/min"],
    });
    expect(again.body.gate).toBe(gate);
    const gates = (await d.task(task.id)).gates.filter((g) => g.kind === "question");
    expect(gates).toEqual([
      expect.objectContaining({ gate, state: "open", options: ["100/min", "1000/min"] }),
    ]);
    const opened = await d.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).gate === gate,
    );
    expect(by(opened)).toBe("claude@macbook-pro");
    // The human answers: the same question again is a new question with a new gate.
    await d.answerFrom("pixel-9", task.id, gate, "1000/min");
    await waitFor(
      async () => (await d.task(task.id)).gates.find((g) => g.gate === gate)?.state === "resolved",
      20_000,
    );
    const asked = await call(client, "ask", {
      text: "Which limit?",
      options: ["100/min", "1000/min"],
    });
    expect(asked.isError).toBe(false);
    expect(asked.body.gate).not.toBe(gate);
    const after = (await d.task(task.id)).gates.filter((g) => g.kind === "question");
    expect(after.map((g) => [g.gate, g.state])).toEqual([
      [gate, "resolved"],
      [asked.body.gate, "open"],
    ]);

    // ask with details and an option with a description (gate-context).
    const detailed = await call(client, "ask", {
      text: "Which queue library?",
      details: "## Options\n- A: one process\n- B: a service",
      options: [{ label: "Library A", description: "Same process" }, "Library B"],
    });
    expect(detailed.isError).toBe(false);
    const detailedRow = await d.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).gate === detailed.body.gate,
    );
    expect(data(detailedRow)).toMatchObject({
      title: "Which queue library?",
      text: "## Options\n- A: one process\n- B: a service",
      options: ["Library A", "Library B"],
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
    expect(MCP_INSTRUCTIONS).toContain('never write "see the message above"');

    // message and stage: the buffered events of the agent.
    expect((await call(client, "message", { task: key, text: "Tests pass." })).isError).toBe(false);
    expect((await call(client, "stage", { text: "Running the tests" })).isError).toBe(false);
    const message = await d.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r) === "Tests pass.",
    );
    expect(by(message)).toBe("claude@macbook-pro");
    await d.waitRow(task.id, (r) => r.type === "task.progress" && text(r) === "Running the tests");

    // artifact_add with a path relative to the working folder; a repeat copies nothing more.
    const cwd = d.worktree(task.id);
    await writeFile(join(cwd, "report.txt"), "5 passed\n");
    const artifact = await call(client, "artifact_add", { path: "report.txt" });
    expect(artifact.body.path).toBe("artifacts/macbook-pro/report.txt");
    expect((await call(client, "artifact_add", { path: "report.txt" })).body.path).toBe(
      "artifacts/macbook-pro/report.txt",
    );
    expect(
      existsSync(join(d.folder, "tasks", task.id, "artifacts", "macbook-pro", "2-report.txt")),
    ).toBe(false);
    // A new version of the file (a test rerun) within the retry window is a new artifact.
    await writeFile(join(cwd, "report.txt"), "6 passed, 1 new\n");
    expect((await call(client, "artifact_add", { path: "report.txt" })).isError).toBe(false);
    await waitFor(
      async () => (await d.rows(task.id)).filter((r) => r.type === "artifact.added").length === 2,
      20_000,
    );
    const added = (await d.rows(task.id)).filter((r) => r.type === "artifact.added");
    expect(added.map((r) => data(r).size)).toEqual([9, 16]);
    const outside = await call(client, "artifact_add", { path: join(d.home, "config.yaml") });
    expect(outside).toMatchObject({ isError: true, body: { error: { code: "refused" } } });

    // handoff and learn.
    await writeFile(join(cwd, "handoff.md"), "# Handoff\n");
    expect((await call(client, "handoff", { path: join(cwd, "handoff.md") })).isError).toBe(false);
    await d.waitRow(task.id, (r) => r.type === "handoff.written");
    const learned = await call(client, "learn", {
      title: "Reset the DB",
      content: "Run task db:reset.",
    });
    expect(learned.isError).toBe(false);
    const kb = d.server.daemon.workspace().knowledge;
    const file = (learned.body.change as { path: string } | null)?.path ?? "";
    expect(file).toMatch(/^projects\/billing-api\/learned\//);
    expect((await kb.history(file))[0]).toMatchObject({ author: "claude@macbook-pro" });
    expect(learned.body.task_event).toMatchObject({ applied: true });
    // "Nothing new" (agent-learning): task.learned by the agent, and no knowledge file.
    const nothing = await call(client, "learn", { nothing_new: true });
    expect(nothing).toMatchObject({ isError: false, body: { change: null, suggestion: null } });
    const steps = (await d.rows(task.id)).filter((r) => r.type === "task.learned");
    expect(steps.map((r) => [by(r), data(r).nothing_new, data(r).path ?? null])).toEqual([
      ["claude@macbook-pro", false, file],
      ["claude@macbook-pro", true, null],
    ]);
    const mixed = await call(client, "learn", { nothing_new: true, title: "X" });
    expect(mixed).toMatchObject({ isError: true, body: { error: { code: "invalid_input" } } });

    // The token of AW-1 cannot act on another task, or read its thread.
    const before = (await d.rows(other.task.id)).length;
    for (const [tool, args] of [
      ["message", { task: other.task.key!, text: "hi" }],
      ["stage", { task: other.task.id, text: "hi" }],
      ["ask", { task: other.task.key!, text: "Q?" }],
      ["thread", { task: other.task.key! }],
      ["learn", { task: other.task.key!, title: "X", content: "x" }],
    ] as const) {
      const refused = await call(client, tool, args);
      expect(refused, tool).toMatchObject({ isError: true, body: { error: { code: "refused" } } });
    }
    await d.waitChecks(session, 3);
    expect((await d.rows(other.task.id)).length).toBe(before);

    // Test slots (add-continuity): no device of the workspace has the resource.
    const slot = await call(client, "slot_acquire", { resource: "k3d" });
    expect(slot).toMatchObject({
      isError: true,
      body: { error: { code: "not_found", details: { resource: "k3d" } } },
    });
    // The work loop tools are built (add-task-loop): ready answers with the next step.
    const ready = await call(client, "ready", {});
    expect(ready).toMatchObject({ isError: false });

    // Resources: the task fields and the knowledge.
    await kb.write({ path: "shared/rules/style.md", content: "# Style\n\nUse short names.\n" });
    const taskResource = await client.readResource({ uri: "aw://task" });
    expect(JSON.parse((taskResource.contents[0] as { text: string }).text)).toMatchObject({
      id: task.id,
      key,
      stage: "discuss",
      assignee: "claude@macbook-pro",
    });
    const list = await client.readResource({ uri: "aw://knowledge" });
    const listed = JSON.parse((list.contents[0] as { text: string }).text) as {
      count: number;
      files: { path: string }[];
    };
    expect(listed.files.map((f) => f.path)).toContain("shared/rules/style.md");
    const style = await client.readResource({ uri: "aw://knowledge/shared/rules/style.md" });
    expect((style.contents[0] as { text: string }).text).toContain("Use short names.");
  }, 90_000);

  it("pages the parent threads with the limit, and a long thread in a character budget", async () => {
    awd = await startSessionDaemon();
    const d = awd;
    const parent = await d.client.createTask("-", {
      project: "billing-api",
      title: "Parent",
      first_message: "x",
    });
    for (let i = 0; i < 8; i++) {
      await d.client.editTask("-", parent.task.id, { title: `Parent ${i}` });
    }
    const child = await d.client.createTask("-", {
      project: "billing-api",
      title: "Child",
      first_message: "reply ready",
      assignee: "claude@macbook-pro",
      parent: parent.task.id,
    });
    await d.waitRow(
      child.task.id,
      (r) => r.type === "message.agent" && text(r).startsWith("ready"),
    );
    const client = await connect(d, await d.token(d.session(child.task.id)));

    // The parent page has `limit` events and its next_from; the agent reads on with the parent key.
    const first = await call(client, "thread", { limit: 5, ancestors: true });
    const ancestors = first.body.ancestors as {
      task: { id: string };
      events: unknown[];
      next_from: number;
    }[];
    expect(ancestors).toHaveLength(1);
    expect(ancestors[0]!.task.id).toBe(parent.task.id);
    expect(ancestors[0]!.events).toHaveLength(5);
    expect(ancestors[0]!.next_from).toBe(5);
    const rest = await call(client, "thread", { task: parent.task.key!, from: 5, limit: 200 });
    expect((rest.body.events as unknown[]).length).toBe(4);
    expect(rest.body.next_from).toBeNull();

    // 4 messages of 25,000 characters: one page holds what fits in the budget.
    const big = "y".repeat(25_000);
    for (let i = 0; i < 4; i++) {
      expect((await call(client, "message", { text: `${i} ${big}` })).isError).toBe(false);
    }
    await waitFor(
      async () =>
        (await d.rows(child.task.id)).filter(
          (r) => r.type === "message.agent" && text(r).endsWith(big),
        ).length === 4,
      20_000,
    );
    const total = (await d.rows(child.task.id)).length;
    let from = 0;
    let pages = 0;
    const seen: number[] = [];
    for (;;) {
      const page = await call(client, "thread", { from, limit: 200 });
      const events = page.body.events as { n: number }[];
      expect(events.length).toBeGreaterThan(0);
      expect(JSON.stringify(events).length).toBeLessThan(THREAD_BUDGET + 1000);
      seen.push(...events.map((e) => e.n));
      pages++;
      if (page.body.next_from === null) break;
      from = page.body.next_from as number;
    }
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(seen).toEqual(Array.from({ length: total }, (_, i) => i));
  }, 90_000);

  it("refuses a missing, bad or revoked token with 401 and no OAuth challenge, and checks Host and Origin", async () => {
    awd = await startSessionDaemon();
    const d = awd;
    const { session, token } = await readySession(d);
    const bad: Record<string, string>[] = [
      {},
      { Authorization: "Bearer none" },
      { Authorization: `Bearer awt_${"A".repeat(43)}` },
      { Authorization: "Basic abc" },
    ];
    for (const headers of bad) {
      const reply = await rawPost(d, headers);
      expect(reply.status, JSON.stringify(headers)).toBe(401);
      expect(reply.headers["www-authenticate"]).toBeUndefined();
      expect(JSON.parse(reply.body)).toMatchObject({ jsonrpc: "2.0", error: { code: -32001 } });
    }
    const good = await rawPost(d, { Authorization: `Bearer ${token}` });
    expect(good.status).toBe(200);
    // DNS rebinding and a browser page of another site: 403 before the token check.
    expect(
      (await rawPost(d, { Authorization: `Bearer ${token}`, Host: "attacker.example.com:7433" }))
        .status,
    ).toBe(403);
    expect(
      (
        await rawPost(d, {
          Authorization: `Bearer ${token}`,
          Origin: "https://attacker.example.com",
        })
      ).status,
    ).toBe(403);
    // No OAuth metadata: Claude Code finds no authorization server.
    const wellKnown = await fetch(
      `http://127.0.0.1:${d.server.mcp!.port}/.well-known/oauth-protected-resource`,
    );
    expect(wellKnown.status).toBe(404);
    // The token is never in the log.
    expect(JSON.stringify(d.logLines())).not.toContain(token);

    // The person stops the session: the token is revoked at once and its file is gone.
    const client = await connect(d, token);
    await d.client.stopSession(session);
    expect(existsSync(tokenFile(d.home, session))).toBe(false);
    expect((await rawPost(d, { Authorization: `Bearer ${token}` })).status).toBe(401);
    await expect(client.callTool({ name: "thread", arguments: {} })).rejects.toThrow();
    // The local API refuses the revoked token too.
    const agent = await d.agentClientWithToken(token);
    await expect(agent.thread("-", "AW-1")).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
  }, 60_000);

  it("keeps the token over an awd restart, and answers not_ready while the workspace waits", async () => {
    const marker = join(await tempDir("awv-"), "claude-ok");
    await writeFile(marker, "");
    awd = await startSessionDaemon({ versionNeeds: marker, prepareRetryMs: 500 });
    const d = awd;
    const { task, session, token } = await readySession(d);

    // awd restarts while the agent runs: the same token works on the new listener.
    await d.restart();
    const after = await connect(d, token);
    const thread = await call(after, "thread", {});
    expect(thread.isError).toBe(false);
    expect((thread.body.task as { id: string }).id).toBe(task.id);
    await after.close();

    // The agent binary does not answer at the next start: the workspace has no session manager.
    await rm(marker);
    await d.restart();
    const waiting = await connect(d, token);
    const pending = await call(waiting, "message", { text: "hi" });
    expect(pending).toMatchObject({ isError: true, body: { error: { code: "not_ready" } } });
    const agent = await d.agentClientWithToken(token);
    await expect(agent.agentMessage(session, { task: task.id, text: "hi" })).rejects.toMatchObject({
      status: 503,
      code: "not_ready",
    });
    // The agent answers again: the manager attaches, and the same token works.
    await writeFile(marker, "");
    await waitFor(async () => !(await call(waiting, "message", { text: "back" })).isError, 20_000);
    await d.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "back");
  }, 90_000);

  it("gives the agent the MCP variables of aw-launch, and the plugin .mcp.json reaches awd", async () => {
    awd = await startSessionDaemon();
    const d = awd;
    // The fake agent reads the plugin .mcp.json, expands it with its own environment (set by
    // aw-launch from run/mcp.port and mcp-token), and calls stage.
    const task = await d.createTask('mcp stage {"text":"From the plugin config"}');
    await d.waitRow(
      task.id,
      (r) => r.type === "task.progress" && text(r) === "From the plugin config",
    );
    const reply = await d.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).startsWith("MCP "),
    );
    expect(text(reply)).toMatch(/^MCP result /);
    // The token is in no command line of the session processes.
    const token = await d.token(d.session(task.id));
    const { execa } = await import("execa");
    const ps = await execa("ps", ["-A", "-o", "args="]);
    expect(ps.stdout).not.toContain(token);
  }, 60_000);
  it("gives the token to a session with MCP off: the aw CLI and the permission hook work", async () => {
    awd = await startSessionDaemon({ env: { AW_MCP_PORT: "off" } });
    const d = awd;
    expect(d.server.mcp).toBeNull();
    const task = await d.createTask("ask Which region? | eu|us");
    const question = await d.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "question",
    );
    expect(by(question)).toBe("claude@macbook-pro");
    // A Bash call with no allow rule: the hook asks awd with the token, and a gate opens (with no
    // token, awd refuses the hook and the agent gets a deny).
    await d.sendMessage("pixel-9", task.id, d.session(task.id), "bash sleep 1");
    const approve = await d.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
    );
    expect(text(approve)).toBe("Bash: sleep 1");
    // The MCP tools fail: no AW_MCP_URL, so the .mcp.json default names a host that does not exist.
    await d.answerFrom("pixel-9", task.id, String(data(approve).gate), "Allow once");
    await d.sendMessage("pixel-9", task.id, d.session(task.id), 'mcp stage {"text":"x"}');
    const failed = await d.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).startsWith("MCP failed"),
    );
    expect(text(failed)).not.toContain("401");
  }, 60_000);

  it("gives the MCP variables to a session that resumes during the awd start", async () => {
    awd = await startSessionDaemon();
    const d = awd;
    const { task, session } = await readySession(d);
    const pid = d.server.daemon.sessions!.list().find((s) => s.id === session)!.pid!;
    // awd stops, and the agent dies while awd is down: the next start resumes it.
    await d.server.close();
    process.kill(pid, "SIGKILL");
    await waitFor(() => {
      try {
        process.kill(pid, 0);
        return Promise.resolve(false);
      } catch {
        return Promise.resolve(true);
      }
    }, 10_000);
    await d.restart();
    await d.waitRow(task.id, (r) => r.type === "session.resumed", 30_000);
    await d.sendMessage("pixel-9", task.id, session, 'mcp stage {"text":"Resumed at the start"}');
    await d.waitRow(
      task.id,
      (r) => r.type === "task.progress" && text(r) === "Resumed at the start",
    );
  }, 90_000);

  it("keeps the token over a resume of the agent, and revokes it when the task moves", async () => {
    awd = await startSessionDaemon();
    const d = awd;
    const { task, session, token } = await readySession(d);
    const before = d.server.daemon.sessions!.list().find((s) => s.id === session)!;
    // The agent process dies: awd resumes the session with the same token.
    process.kill(before.pid!, "SIGKILL");
    await d.waitRow(task.id, (r) => r.type === "session.resumed", 30_000);
    expect(await d.token(session)).toBe(token);
    await d.sendMessage("pixel-9", task.id, session, 'mcp stage {"text":"After the resume"}');
    await d.waitRow(task.id, (r) => r.type === "task.progress" && text(r) === "After the resume");
    // The person moves the task to another device: the session stops with "moved", and its token
    // gets 401 on the MCP endpoint and on the local API.
    await d.client.assignTask("-", task.id, "claude@ubuntu-01");
    await waitFor(
      () =>
        Promise.resolve(
          d.server.daemon.sessions!.list().find((s) => s.id === session)?.state === "moved",
        ),
      20_000,
    );
    expect((await rawPost(d, { Authorization: `Bearer ${token}` })).status).toBe(401);
    const agent = await d.agentClientWithToken(token);
    await expect(agent.thread("-", task.id)).rejects.toMatchObject({ status: 401 });
  }, 90_000);
});
