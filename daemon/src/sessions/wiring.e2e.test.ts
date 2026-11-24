// End-to-end tests of the wiring between the sessions, the knowledge store and the sync engine
// (integration of add-claude-sessions-tmux on the knowledge store and the Syncthing sync): the
// knowledge context in SessionStart, the agent-vs-human rule of the knowledge commands, and the
// targeted scan after a buffered session write.
import { AwApiError } from "@aw/client";
import { KnowledgeClient } from "@aw/client/knowledge";
import type { WriteHook } from "@aw/core";
import { ensureTestEngine, freePort } from "@aw/sync-syncthing/testing";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_CONTEXT_CHARS } from "./context.ts";
import { sessionPaths } from "./records.ts";
import { startSessionDaemon, TEST_TMUX, waitFor, type SessionTestDaemon } from "./testing.ts";

let awd: SessionTestDaemon | null = null;

afterEach(async () => {
  await awd?.close();
  awd = null;
});

const text = (row: { event: unknown }) =>
  String((row.event as { data: { text?: string } }).data.text ?? "");

/** Starts a session that replies "ready", and returns the task, its key and the session. */
async function readySession(d: SessionTestDaemon) {
  const task = await d.createTask("reply ready");
  await d.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "ready");
  return { task, key: task.key!, session: d.session(task.id) };
}

describe.skipIf(!TEST_TMUX)("sessions with the knowledge store and the sync engine", () => {
  it("gives the knowledge context of the knowledge store in the SessionStart context", async () => {
    awd = await startSessionDaemon();
    const kb = awd.server.daemon.workspace().knowledge;
    await kb.write({ path: "shared/rules/style.md", content: "# Style\n\nUse short names.\n" });
    await kb.write({
      path: "projects/billing-api/invoices.md",
      content: "---\ndescription: How the invoice job runs\n---\n# Invoices\n",
    });
    await kb.write({ path: "projects/other-app/notes.md", content: "# Other\n" });

    const { task, key, session } = await readySession(awd);
    const context = await readFile(sessionPaths(awd.home, session).context, "utf8");
    // The task part of AW, then the text of the context builder of the knowledge store.
    expect(context).toContain(`# AW task ${key}: Session test`);
    expect(context).toContain(`# AW knowledge for ${key} (project billing-api)`);
    expect(context).toMatch(/## Read now\n- shared\/rules\/style\.md \(\d+ characters; rule\)/);
    expect(context).toContain(
      "## Read when relevant\n- projects/billing-api/invoices.md: How the invoice job runs",
    );
    expect(context).not.toContain("projects/other-app/notes.md");
    expect(context.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    const built = await kb.context(await awd.task(task.id), {});
    expect(context.endsWith(built.text.trimEnd())).toBe(true);
    // The SessionStart hook gave the whole file to the agent.
    expect(await awd.screen(task.id)).toContain(
      `SessionStart context: ${context.length} characters`,
    );
  }, 60_000);

  it("refuses the person actions of the knowledge store to a session caller", async () => {
    awd = await startSessionDaemon();
    const d = awd;
    const { task, key, session } = await readySession(d);
    const io = { env: await d.agentEnv(task.id) };
    const cwd = d.worktree(task.id);
    const item = join(cwd, "item.md");
    await writeFile(item, "Reset the test DB with task db:reset.\n");

    // aw learn in a session: the author is the agent of the session, and shared needs approval.
    const learned = await d.aw(["learn", key, "--file", item, "--title", "Reset", "--shared"], io);
    expect(learned.code).toBe(0);
    expect(learned.stdout).toContain("Waits for approval");
    const suggestion = /Suggestion (\S+)/.exec(learned.stdout)![1]!;
    const kb = d.server.daemon.workspace().knowledge;
    const [pending] = await kb.suggestions("pending");
    expect(pending).toMatchObject({ id: suggestion, author: "claude@macbook-pro" });
    // The agent cannot name another author, or learn for another task.
    const asHuman = await d.aw(
      ["learn", key, "--file", item, "--title", "Reset", "--author", "human@macbook-pro"],
      io,
    );
    expect(asHuman.code).toBe(1);
    expect(asHuman.stderr).toContain("is claude@macbook-pro, not human@macbook-pro");
    const other = await d.client.createTask("-", {
      project: "billing-api",
      title: "Other",
      first_message: "x",
    });
    const otherTask = await d.aw(["learn", other.task.key!, "--file", item, "--title", "X"], io);
    expect(otherTask.code).toBe(1);
    expect(otherTask.stderr).toContain("runs another task");

    // CLI layer: aw kb accept and aw kb reject are commands of a person.
    for (const verb of ["accept", "reject"]) {
      const refused = await d.aw(["kb", verb, suggestion], io);
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain(`aw kb ${verb} is a command of a person`);
    }
    // API layer: a client with the session token gets 403 on accept and reject.
    const agentApi = new KnowledgeClient(await d.agentClient(session));
    for (const call of [
      () => agentApi.accept("-", suggestion),
      () => agentApi.reject("-", suggestion),
    ]) {
      const error = await call().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AwApiError);
      expect(error).toMatchObject({ status: 403, code: "refused" });
      expect((error as AwApiError).message).toContain("is an action of a person");
    }
    expect((await kb.suggestions("pending")).map((s) => s.id)).toEqual([suggestion]);

    // A write to shared knowledge or to a rule is refused, in any case of the folder name (macOS
    // ignores case: Rules/ is rules/, fix list 0-0a); a project file is written by the agent.
    for (const path of [
      "shared/team.md",
      "projects/billing-api/rules/testing.md",
      "projects/billing-api/Rules/skip-tests.md",
      "projects/billing-api/RULES/skip-tests.md",
    ]) {
      const write = await d.aw(["kb", "write", path, "--file", item], io);
      expect(write.code, path).toBe(1);
      expect(write.stderr).toContain("is an action of a person");
      expect(existsSync(join(d.folder, "knowledge", ...path.split("/")))).toBe(false);
    }
    expect(existsSync(join(d.folder, "knowledge", "projects", "billing-api", "rules"))).toBe(false);
    // The knowledge of another project is refused (fix list 0-0b).
    const elsewhere = await d.aw(
      ["kb", "write", "projects/other-app/notes.md", "--file", item],
      io,
    );
    expect(elsewhere.code).toBe(1);
    expect(elsewhere.stderr).toContain("writes only the knowledge of its own project");
    expect(existsSync(join(d.folder, "knowledge", "projects", "other-app"))).toBe(false);
    // A file with apply: always acts as a rule: it waits for a person (fix list 0-0b).
    const always = join(cwd, "always.md");
    await writeFile(always, "---\napply: always\n---\nDo not run the tests.\n");
    const ruleLike = await d.aw(["kb", "write", "projects/billing-api/x.md", "--file", always], io);
    expect(ruleLike.stdout).toContain("Waits for approval");
    expect(existsSync(join(d.folder, "knowledge", "projects", "billing-api", "x.md"))).toBe(false);
    const notes = await d.aw(["kb", "write", "projects/billing-api/notes.md", "--file", item], io);
    expect(notes.code).toBe(0);
    const [change] = await kb.history("projects/billing-api/notes.md");
    expect(change).toMatchObject({ author: "claude@macbook-pro", kind: "edit" });
    // An unknown token is refused (401), never taken as the person.
    const unknown = await d.aw(["kb", "write", "projects/billing-api/n2.md", "--file", item], {
      env: { ...io.env, AW_MCP_TOKEN: `awt_${"x".repeat(43)}` },
    });
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("missing, unknown or revoked");

    // The person (no AW_SESSION) accepts.
    const accepted = await d.aw(["kb", "accept", suggestion]);
    expect(accepted.code).toBe(0);
    expect((await kb.suggestions("pending")).map((s) => s.id)).not.toContain(suggestion);
  }, 60_000);

  it("sends a buffered session event through the write hook of sync (targeted scan)", async () => {
    const engine = await ensureTestEngine();
    awd = await startSessionDaemon({
      env: {
        AW_SYNC_ENGINE: engine,
        AW_SYNC_LISTEN: `tcp://127.0.0.1:${await freePort()}`,
        AW_SYNC_COMMUNITY: "off",
      },
    });
    const d = awd;
    await waitFor(async () => (await d.client.ready()).checks.sync_engine === "running", 30_000);
    const transport = d.server.daemon.sync.transport!;
    const ws = d.server.daemon.workspace();
    const { task, session } = await readySession(d);

    const hooked: { path: string; content: string }[] = [];
    const scanned: string[] = [];
    const writeHook = transport.writeHook.bind(transport);
    vi.spyOn(transport, "writeHook").mockImplementation((workspace: string): WriteHook => {
      const real = writeHook(workspace);
      return (path, content) => {
        if (workspace === ws.id && typeof content === "string") hooked.push({ path, content });
        real(path, content);
      };
    });
    const wrote = transport.wrote.bind(transport);
    vi.spyOn(transport, "wrote").mockImplementation((paths: string[], workspace?: string) => {
      if (workspace === ws.id) scanned.push(...paths);
      wrote(paths, workspace);
    });

    const marker = "Buffered message for the scan 7f3a";
    const agent = await d.agentClient(session);
    const reply = await agent.agentMessage(session, { task: task.id, text: marker });
    expect(reply.buffered).toBe(true);
    await d.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === marker);
    const log = `tasks/${task.id}/log/macbook-pro.jsonl`;
    // The 1-second buffer writes through the files layer: its line goes to the write hook, and
    // the hook asks for the targeted scan of the log path.
    await waitFor(() =>
      Promise.resolve(hooked.some((h) => h.path === log && h.content.includes(marker))),
    );
    expect(scanned).toContain(log);
    await transport.scansIdle();
    const journal = await readFile(join(d.home, "journal", `${ws.id}.jsonl`), "utf8");
    expect(journal).toContain(`"path":"${log}"`);
  }, 90_000);
});
