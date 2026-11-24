// End-to-end test of the learning step (openspec agent-learning) with tmux and the fake agent: the
// session context puts the files knowledge of a task path under "Read now"; the agent records
// "Nothing new" through MCP or the CLI fallback (no permission gate); a task that ends with no
// learning step gets the reminder comment, and done is not blocked.
import type { EventRow } from "@aw/core";
import { execa } from "execa";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatThreadRows } from "../cli/format.ts";
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
const REMINDER = /is done with no learned item and no "Nothing new" \(decision D3\)\.$/;

/** Posts a result, approves it as pixel-9, and waits for the end of the session. */
async function approveAndEnd(d: SessionTestDaemon, task: string, session: string) {
  await writeFile(join(d.worktree(task), "result.md"), "# Done\n\nAll tests pass.\n");
  await d.sendMessage("pixel-9", task, session, 'mcp result {"path":"result.md"}');
  const gate = await d.waitRow(
    task,
    (r) => r.type === "gate.opened" && data(r).kind === "approve_result",
  );
  await d.answerFrom("pixel-9", task, String(data(gate).gate), "Approve");
  const approved = await d.waitRow(
    task,
    (r) => r.type === "message.human" && data(r).delivery_id === data(gate).gate,
  );
  const ended = await d.waitRow(task, (r) => r.type === "session.ended", 20_000);
  expect(data(ended)).toMatchObject({ session, reason: "done" });
  expect((await d.task(task)).stage).toBe("done");
  return text(approved);
}

describe.skipIf(!TEST_TMUX)("the learning step", () => {
  it("gives Read now for a task path, records Nothing new through MCP, and ends with no reminder", async () => {
    awd = await startSessionDaemon();
    await awd.server.daemon.workspace().knowledge.write({
      path: "projects/billing-api/invoice-api.md",
      content:
        '---\napply: files\nglobs: ["src/api/**"]\ndescription: Rules of the invoice API\n---\n# Invoice API\n\nUse integer cents.\n',
    });
    const task = await awd.createTask("reply Fix the rounding in src/api/invoice.ts");
    await awd.waitRow(task.id, (r) => r.type === "message.agent");
    const session = awd.session(task.id);
    const context = await readFile(join(awd.home, "sessions", session, "context.md"), "utf8");
    expect(context).toMatch(
      /## Read now\n- projects\/billing-api\/invoice-api\.md \(\d+ characters; a task path matches src\/api\/\*\*\)/,
    );
    expect(context).toContain("- Search the knowledge first:");
    expect(context).toContain(`aw learn ${task.key} --nothing-new`);

    await awd.sendMessage("pixel-9", task.id, session, 'mcp learn {"nothing_new":true}');
    const learned = await awd.waitRow(task.id, (r) => r.type === "task.learned");
    expect(learned).toMatchObject({ applied: true });
    expect(by(learned)).toBe("claude@macbook-pro");
    expect(data(learned)).toEqual({ nothing_new: true });

    const approved = await approveAndEnd(awd, task.id, session);
    expect(approved).toContain(`\`aw learn ${task.key} --nothing-new\``);
    const rows = await awd.rows(task.id);
    expect(rows.filter((r) => r.type === "comment.added" && REMINDER.test(text(r)))).toEqual([]);
    // The rows of the test helper have the merge type; the CLI prints the client type.
    type Rows = Parameters<typeof formatThreadRows>[0];
    const steps = rows.filter((r) => r.type === "task.learned") as unknown as Rows;
    expect(formatThreadRows(steps)).toEqual([
      expect.stringMatching(/claude@macbook-pro task\.learned\n {2}Nothing new learned$/),
    ]);
  }, 120_000);

  it("gives Read now for a file that the work branch changed (a task that continues on aw/<key>)", async () => {
    awd = await startSessionDaemon();
    await awd.server.daemon.workspace().knowledge.write({
      path: "projects/billing-api/web.md",
      content: '---\napply: files\nglobs: ["web/**"]\n---\n# Web\n\nUse the design tokens.\n',
    });
    // The work of an earlier session on the branch of the next task key (AW-1).
    const git = (...args: string[]) =>
      execa("git", [
        "-C",
        awd!.checkout,
        "-c",
        "user.name=AW",
        "-c",
        "user.email=test@example.com",
        ...args,
      ]);
    await git("checkout", "-q", "-b", "aw/AW-1");
    await mkdir(join(awd.checkout, "web"));
    await writeFile(join(awd.checkout, "web", "page.tsx"), "export {};\n");
    await git("add", ".");
    await git("commit", "-qm", "page");
    await git("checkout", "-q", "main");
    const task = await awd.createTask("reply ready");
    expect(task.key).toBe("AW-1");
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "ready");
    const context = await readFile(
      join(awd.home, "sessions", awd.session(task.id), "context.md"),
      "utf8",
    );
    expect(context).toMatch(
      /## Read now\n- projects\/billing-api\/web\.md \(\d+ characters; a task path matches web\/\*\*\)/,
    );
  }, 60_000);

  it("runs the CLI fallback aw learn --nothing-new with no permission gate", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("reply ready");
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "ready");
    await awd.sendMessage(
      "pixel-9",
      task.id,
      awd.session(task.id),
      `bash aw learn ${task.key} --nothing-new`,
    );
    const reply = await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).startsWith("The command ended"),
    );
    expect(text(reply)).toBe(`The command ended: Recorded: nothing new learned on ${task.key}.`);
    const rows = await awd.rows(task.id);
    expect(rows.filter((r) => r.type === "gate.opened")).toEqual([]);
    expect(rows.filter((r) => r.type === "task.learned").map(by)).toEqual(["claude@macbook-pro"]);
  }, 60_000);

  it("does not block done with no learning step, and writes the reminder comment once", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("reply ready");
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "ready");
    await approveAndEnd(awd, task.id, awd.session(task.id));
    const comments = (await awd.rows(task.id)).filter(
      (r) => r.type === "comment.added" && REMINDER.test(text(r)),
    );
    expect(comments.map((r) => [by(r), text(r)])).toEqual([
      [
        "aw@macbook-pro",
        `${task.key} is done with no learned item and no "Nothing new" (decision D3).`,
      ],
    ]);
    await waitFor(async () => (await awd!.host.list()).length === 0, 10_000);
  }, 120_000);
});
