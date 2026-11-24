// End-to-end tests of the caller rule of the local API (add-mcp-server, test plan 2): a session
// caller (its token, or a process of its tree with no token) is refused on each person route, in
// the API and in the CLI; the person is not.
import { AwApiError } from "@aw/client";
import { IdentityClient } from "@aw/client/identity";
import { KnowledgeClient } from "@aw/client/knowledge";
import type { EventRow } from "@aw/core";
import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { startSessionDaemon, TEST_TMUX, type SessionTestDaemon } from "../sessions/testing.ts";

let awd: SessionTestDaemon | null = null;

afterEach(async () => {
  await awd?.close();
  awd = null;
});

/** A raw request on the socket, with an Authorization header as given. */
function rawRequest(
  socketPath: string,
  method: string,
  path: string,
  options: { authorization: string; body: unknown },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path,
        method,
        headers: { "content-type": "application/json", authorization: options.authorization },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(body) }));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(options.body));
  });
}

const text = (row: EventRow) => String((row.event as { data: { text?: string } }).data.text ?? "");
const data = (row: EventRow) => (row.event as { data: Record<string, unknown> }).data;

describe.skipIf(!TEST_TMUX)("the caller rule of the local API", () => {
  it("refuses each person route to the session token, in the API and in the CLI", async () => {
    awd = await startSessionDaemon();
    const d = awd;
    const task = await d.createTask("ask Which limit? | 100/min|1000/min");
    const opened = await d.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "question",
    );
    const gate = String(data(opened).gate);
    const session = d.session(task.id);
    const agent = await d.agentClient(session);
    const ws = d.server.daemon.workspace().id;
    const routes: [string, string, unknown][] = [
      ["POST", "/v1/workspaces", { path: d.folder }],
      ["POST", `/v1/workspaces/${ws}/projects`, { slug: "other", name: "Other" }],
      [
        "POST",
        `/v1/workspaces/${ws}/tasks`,
        { project: "billing-api", title: "X", first_message: "x" },
      ],
      ["PATCH", `/v1/workspaces/${ws}/tasks/${task.id}`, { title: "Changed by the agent" }],
      ["POST", `/v1/workspaces/${ws}/tasks/${task.id}/assign`, { assignee: "claude@ubuntu-01" }],
      ["POST", `/v1/workspaces/${ws}/tasks/${task.id}/archive`, { stop: true }],
      ["POST", `/v1/workspaces/${ws}/tasks/${task.id}/unarchive`, {}],
      ["POST", `/v1/workspaces/${ws}/tasks/${task.id}/stop`, {}],
      ["POST", `/v1/workspaces/${ws}/tasks/${task.id}/messages`, { text: "Approve it" }],
      ["POST", `/v1/workspaces/${ws}/gates/${gate}/answer`, { answer: "1000/min" }],
      ["POST", `/v1/sessions/${session}/stop`, {}],
      ["POST", "/v1/sync/now", {}],
      ["POST", "/v1/sync/pause", {}],
      ["POST", "/v1/sync/resume", {}],
      ["POST", "/v1/sync/peers", { device_id: "A".repeat(63), addresses: ["dynamic"] }],
      ["DELETE", "/v1/sync/peers/ubuntu-01", undefined],
      [
        "POST",
        `/v1/workspaces/${ws}/knowledge/suggestions/0193a7d1-0000-7000-8000-000000000001/accept`,
        {},
      ],
      [
        "POST",
        `/v1/workspaces/${ws}/knowledge/suggestions/0193a7d1-0000-7000-8000-000000000001/reject`,
        {},
      ],
    ];
    for (const [method, path, body] of routes) {
      const error = await agent
        .request(method as "POST", path, z.unknown(), body === undefined ? {} : { body })
        .catch((e: unknown) => e);
      expect(error, `${method} ${path}`).toBeInstanceOf(AwApiError);
      expect(error, `${method} ${path}`).toMatchObject({ status: 403, code: "refused" });
      expect((error as Error).message).toContain("is an action of a person");
    }
    const view = await d.task(task.id);
    expect(view).toMatchObject({
      title: "Session test",
      assignee: "claude@macbook-pro",
      archived: false,
    });
    expect(view.gates.find((g) => g.gate === gate)).toMatchObject({ state: "open", answers: [] });
    expect(d.server.daemon.sessions!.list().find((s) => s.id === session)?.state).toBe("running");

    // A read with a body (knowledge context) takes the token; an unknown write route answers 404,
    // not 403 (fail-closed only for the routes); the thread of another task is refused, the own
    // thread is not (the same rule as the thread MCP tool).
    const context = await new KnowledgeClient(agent).context(ws, { task: task.id });
    expect(context.text.length).toBeGreaterThan(0);
    const unknown = await agent
      .request("POST", "/v1/no-such-route", z.unknown(), { body: {} })
      .catch((e: unknown) => e);
    expect(unknown).toMatchObject({ status: 404 });
    const other = await d.client.createTask("-", {
      project: "billing-api",
      title: "Other",
      first_message: "x",
    });
    await expect(agent.thread("-", other.task.id)).rejects.toMatchObject({
      status: 403,
      code: "refused",
    });
    expect((await agent.thread("-", task.id)).task.id).toBe(task.id);
    // The knowledge write header takes the same token forms as the other routes.
    const lower = await rawRequest(
      d.settings.socketPath,
      "PUT",
      `/v1/workspaces/${ws}/knowledge/file`,
      {
        authorization: `bearer  ${await d.token(session)}`,
        body: { path: "shared/rules/x.md", content: "# X\n" },
      },
    );
    expect(lower).toMatchObject({ status: 403, body: { error: { code: "refused" } } });

    // CLI: the token with no AW_SESSION (so the CLI does not refuse it first): awd refuses.
    const env = await d.agentEnv(task.id);
    const noSession = { ...env };
    delete noSession.AW_SESSION;
    const answer = await d.aw(["gate", "answer", gate, "1000/min"], { env: noSession });
    expect(answer.code).toBe(1);
    expect(answer.stderr).toContain("is an action of a person");
    const assign = await d.aw(["task", "assign", task.key!, "claude@ubuntu-01"], {
      env: noSession,
    });
    expect(assign.code).toBe(1);

    // The person (this test process, no token) answers the gate.
    const person = await d.client.answerGate("-", gate, { answer: "1000/min" });
    expect(person.applied).toBe(true);
  }, 60_000);

  it("refuses a person route to a process of the session that leaves out the token", async () => {
    awd = await startSessionDaemon();
    const d = awd;
    const task = await d.createTask("ask Which limit? | 100/min|1000/min");
    const opened = await d.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "question",
    );
    const gate = String(data(opened).gate);
    const session = d.session(task.id);
    // The agent removes the session variables and runs the person command of the CLI. The quoted
    // name `a""w` passes the text guard of the hook (the residual risk of session-options): this
    // test shows that awd still refuses it, as the last layer.
    await d.sendMessage(
      "pixel-9",
      task.id,
      session,
      `bash env -u AW_SESSION -u AW_MCP_TOKEN a""w gate answer ${gate} 1000/min`,
    );
    // Bash with no allow rule: the person allows it once (a mistake the check must survive).
    const permission = await d.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
    );
    await d.answerFrom("pixel-9", task.id, String(data(permission).gate), "Allow once");
    const ended = await d.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).startsWith("The command ended"),
      30_000,
    );
    expect(text(ended)).toContain("is an action of a person");
    expect(text(ended)).toContain(`agent session ${session}`);
    expect((await d.task(task.id)).gates.find((g) => g.gate === gate)).toMatchObject({
      state: "open",
      answers: [],
    });
  }, 60_000);
  it("refuses each identity, device, pairing and credential route to a session caller", async () => {
    awd = await startSessionDaemon();
    const d = awd;
    const ws = d.server.daemon.workspace().id;
    const SECRET = "sk_test_integration_4242";
    const added = await d.aw(["credential", "add", "stripe-test"], {
      stdin: () => Promise.resolve(`${SECRET}\n`),
    });
    expect(added.code).toBe(0);
    const task = await d.createTask("reply ready");
    await d.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "ready");
    const session = d.session(task.id);
    const agent = await d.agentClient(session);
    const pairing = "0".repeat(32);
    const routes: [string, string, unknown][] = [
      ["GET", "/v1/identity", undefined],
      ["GET", "/v1/identity/phrase", undefined],
      ["GET", `/v1/workspaces/${ws}/devices`, undefined],
      ["POST", `/v1/workspaces/${ws}/devices/ubuntu-01/revoke`, {}],
      ["POST", `/v1/workspaces/${ws}/pairing`, {}],
      ["GET", `/v1/pairing/${pairing}`, undefined],
      ["POST", `/v1/pairing/${pairing}/approve`, { check_code: "123456" }],
      ["DELETE", `/v1/pairing/${pairing}`, undefined],
      ["POST", "/v1/pairing/join", { code: "aw1:x" }],
      ["GET", `/v1/workspaces/${ws}/credentials`, undefined],
      ["POST", `/v1/workspaces/${ws}/credentials`, { name: "agent-key", value: "x" }],
      ["DELETE", `/v1/workspaces/${ws}/credentials/stripe-test`, undefined],
      ["GET", `/v1/workspaces/${ws}/credentials/stripe-test/value`, undefined],
    ];
    for (const [method, path, body] of routes) {
      const error = await agent
        .request(method as "POST", path, z.unknown(), body === undefined ? {} : { body })
        .catch((e: unknown) => e);
      expect(error, `${method} ${path}`).toBeInstanceOf(AwApiError);
      expect(error, `${method} ${path}`).toMatchObject({ status: 403, code: "refused" });
      expect((error as Error).message).toContain("is an action of a person");
    }

    // CLI: inside the session the CLI refuses first; with the token and no AW_SESSION, awd does.
    const env = await d.agentEnv(task.id);
    const inSession = await d.aw(["credential", "get", "stripe-test"], { env });
    expect(inSession.code).toBe(1);
    expect(inSession.stdout + inSession.stderr).not.toContain(SECRET);
    const noSession = { ...env };
    delete noSession.AW_SESSION;
    for (const argv of [
      ["credential", "get", "stripe-test"],
      ["identity", "phrase"],
    ]) {
      const result = await d.aw(argv, { env: noSession });
      expect(result.code, argv.join(" ")).toBe(1);
      expect(result.stderr).toContain("is an action of a person");
      expect(result.stdout + result.stderr).not.toContain(SECRET);
    }

    // A process of the session tree with no token is refused too.
    await d.sendMessage(
      "pixel-9",
      task.id,
      session,
      // `a""w` passes the text guard of the hook; awd is the last layer.
      'bash env -u AW_SESSION -u AW_MCP_TOKEN a""w credential get stripe-test',
    );
    const permission = await d.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
    );
    await d.answerFrom("pixel-9", task.id, String(data(permission).gate), "Allow once");
    const ended = await d.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).startsWith("The command ended"),
      30_000,
    );
    expect(text(ended)).toContain("is an action of a person");
    expect(text(ended)).not.toContain(SECRET);

    // Nothing changed, and the person still reads the value.
    const identity = new IdentityClient(d.client);
    expect((await identity.credentials(ws)).map((c) => c.name)).toEqual(["stripe-test"]);
    expect((await identity.credentialValue(ws, "stripe-test")).value).toBe(SECRET);
    expect((await identity.identity()).has_master_key).toBe(true);
  }, 60_000);
  it("refuses the token of one session on the agent route of another session", async () => {
    awd = await startSessionDaemon();
    const d = awd;
    const a = await d.createTask("reply ready");
    const b = await d.createTask("reply ready");
    for (const task of [a, b]) {
      await d.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "ready");
    }
    const sessionB = d.session(b.id);
    const agentA = await d.agentClient(d.session(a.id));
    await expect(
      agentA.ask(sessionB, { task: b.id, text: "Asked by the session of A?" }),
    ).rejects.toMatchObject({ status: 403, code: "refused" });
    await expect(
      agentA.agentMessage(sessionB, { task: b.id, text: "Written by the session of A" }),
    ).rejects.toMatchObject({ status: 403, code: "refused" });
    // The token of B on its own route works.
    const agentB = await d.agentClient(sessionB);
    expect((await agentB.ask(sessionB, { task: b.id, text: "Asked by B?" })).applied).toBe(true);
    const gates = (await d.task(b.id)).gates.map((g) => g.title);
    expect(gates).toEqual(["Asked by B?"]);
    expect((await d.rows(b.id)).some((r) => text(r) === "Written by the session of A")).toBe(false);
  }, 60_000);
});
