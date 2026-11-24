// The aw kb and aw learn commands in process against awd on a temp socket (spec aw-cli
// "Knowledge commands").
import { FakeClock } from "@aw/core";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { otherDevice, startTestDaemon, type TestDaemon } from "../testing.ts";

let d: TestDaemon;
beforeEach(async () => {
  d = await startTestDaemon({ workspace: true, clock: new FakeClock("2026-11-22T14:20:01.123Z") });
  await d.client.createTask("-", {
    project: "billing-api",
    title: "Fix the test",
    first_message: "x",
  });
});
afterEach(async () => {
  await d.close();
});

const knowledge = (path: string) => join(d.folder, "knowledge", ...path.split("/"));

describe("aw kb", () => {
  it("writes, shows the history, undoes, and refuses an old base with exit 1", async () => {
    await writeFile(join(d.folder, "one.md"), "one\n");
    await writeFile(join(d.folder, "two.md"), "two\n");
    const first = await d.aw([
      "kb",
      "write",
      "projects/billing-api/notes.md",
      "--file",
      "one.md",
      "--new",
    ]);
    expect(first).toMatchObject({ code: 0, stderr: "" });
    expect(first.stdout).toMatch(
      /^Edited by human@macbook-pro: projects\/billing-api\/notes\.md \(change [0-9a-f-]{36}\)\n$/,
    );
    const second = await d.aw([
      "kb",
      "write",
      "projects/billing-api/notes.md",
      "--file",
      "two.md",
      "--json",
    ]);
    const change = (JSON.parse(second.stdout) as { change: { id: string } }).change.id;

    const old = await d.aw([
      "kb",
      "write",
      "projects/billing-api/notes.md",
      "--file",
      "one.md",
      "--new",
    ]);
    expect(old.code).toBe(1);
    expect(old.stderr).toContain("[conflict");

    const history = await d.aw(["kb", "history", "projects/billing-api/notes.md"]);
    expect(history.code).toBe(0);
    expect(history.stdout).toContain("-one");
    expect(history.stdout).toContain("+two");

    const undo = await d.aw(["kb", "undo", change]);
    expect(undo.code).toBe(0);
    expect(undo.stdout).toMatch(/^Undone by human@macbook-pro/);
    expect(await readFile(knowledge("projects/billing-api/notes.md"), "utf8")).toBe("one\n");

    const show = await d.aw(["kb", "show", "projects/billing-api/notes.md"]);
    expect(show.stdout).toBe("one\n");
    const list = await d.aw(["kb", "list", "--project", "billing-api"]);
    expect(list.stdout).toContain(
      "projects/billing-api/notes.md  (auto; 4 bytes)  undo by human@macbook-pro",
    );
    expect((await d.aw(["kb", "show", "shared/none.md"])).code).toBe(2);
  });

  it("learns in shared knowledge as an agent: waits for approval; accept, digest, search, context", async () => {
    await writeFile(join(d.folder, "item.md"), "Reset the test DB before the invoice tests.\n");
    const learn = await d.aw([
      "learn",
      "AW-1",
      "--file",
      "item.md",
      "--title",
      "Reset the DB",
      "--shared",
      "--author",
      "claude@macbook-pro",
    ]);
    expect(learn.code).toBe(0);
    expect(learn.stdout).toMatch(
      /^Waits for approval: shared\/learned\/2026-11-22-reset-the-db\.md \(reasons: shared\)\. Suggestion [0-9a-f-]{36}\n$/,
    );
    await expect(readFile(knowledge("shared/learned/2026-11-22-reset-the-db.md"))).rejects.toThrow(
      /ENOENT/,
    );
    const id = /Suggestion (\S+)/.exec(learn.stdout)![1]!;

    expect((await d.aw(["kb", "suggestions"])).stdout).toContain(
      `${id}  pending  learned shared/learned/2026-11-22-reset-the-db.md by claude@macbook-pro on AW-1`,
    );
    const accept = await d.aw(["kb", "accept", id, "--comment", "ok"]);
    expect(accept.code).toBe(0);
    expect(accept.stdout).toMatch(
      /^Accepted\. Learned by claude@macbook-pro on AW-1 \(approved by human@macbook-pro\)/,
    );
    expect(
      await readFile(knowledge("shared/learned/2026-11-22-reset-the-db.md"), "utf8"),
    ).toContain("Reset the test DB");

    const digest = await d.aw(["kb", "digest"]);
    expect(digest.stdout).toMatch(
      /^Agents learned 1 thing\.\n {2}Learned by claude@macbook-pro on AW-1/,
    );
    expect((await d.aw(["kb", "search", "invoice", "db"])).stdout).toContain(
      "shared/learned/2026-11-22-reset-the-db.md:",
    );
    const context = await d.aw(["kb", "context", "AW-1"]);
    expect(context.code).toBe(0);
    expect(context.stdout).toContain(
      "## Read when relevant\n- shared/learned/2026-11-22-reset-the-db.md: Reset the DB",
    );
    expect((await d.aw(["kb", "reject", id])).code).toBe(1);
  });

  it("learns in the project of the task as an agent with no approval", async () => {
    await writeFile(join(d.folder, "item.md"), "x\n");
    const learn = await d.aw([
      "learn",
      "AW-1",
      "--file",
      "item.md",
      "--title",
      "Item",
      "--author",
      "claude@macbook-pro",
    ]);
    expect(learn).toMatchObject({ code: 0, stderr: "" });
    expect(learn.stdout).toMatch(
      /^Learned by claude@macbook-pro on AW-1: projects\/billing-api\/learned\/2026-11-22-item\.md/,
    );
    const bad = await d.aw([
      "learn",
      "AW-1",
      "--file",
      "item.md",
      "--title",
      "Item",
      "--author",
      "claude@ubuntu-01",
    ]);
    expect(bad.code).toBe(2);
  });
});

describe("aw learn --nothing-new (agent-learning)", () => {
  const learned = async () =>
    (await d.client.thread("-", "AW-1", { limit: 1000 })).events.filter(
      (r) => r.type === "task.learned",
    );

  it('records "Nothing new", and aw thread shows it', async () => {
    const out = await d.aw(["learn", "AW-1", "--nothing-new"]);
    expect(out).toMatchObject({ code: 0, stderr: "" });
    expect(out.stdout).toBe("Recorded: nothing new learned on AW-1\n");
    expect((await learned()).map((r) => r.event.data)).toEqual([{ nothing_new: true }]);
    const thread = await d.aw(["thread", "AW-1"]);
    expect(thread.stdout).toMatch(/human@macbook-pro task\.learned\n {2}Nothing new learned\n/);
  });

  it("refuses a step for a task of another device, and writes no knowledge file", async () => {
    // The fake time of the daemon: with the real clock, the event is more than the 24 h skew in the
    // future after 2026-11-23T14:20Z, and the merge ignores it (gate-full-context).
    const other = otherDevice(d.folder, "ubuntu-01", {
      clock: new FakeClock("2026-11-22T14:20:02.000Z"),
    });
    const id = other.newId();
    await other.writeEvent(
      `tasks/${id}/log/ubuntu-01.jsonl`,
      "task.created",
      { key: "AW-9", project: "billing-api", title: "Remote", first_message: "hi" },
      { task: id, by: "human@ubuntu-01" },
    );
    await d.server.daemon.workspace().refresh();
    const out = await d.aw(["learn", "AW-9", "--nothing-new"]);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("AW-9 is owned by ubuntu-01");
    // Fix list 0-0c: a learned item is refused before its file is written, so a retry makes no copy.
    await writeFile(join(d.folder, "item.md"), "Use cents.\n");
    for (let i = 0; i < 2; i++) {
      const item = await d.aw(["learn", "AW-9", "--file", "item.md", "--title", "Use cents"]);
      expect(item.code).toBe(1);
      expect(item.stderr).toContain("AW-9 is owned by ubuntu-01");
    }
    expect(existsSync(join(d.folder, "knowledge", "projects", "billing-api", "learned"))).toBe(
      false,
    );
  });

  it("exits 2 for a mix or for no item, and calls no route", async () => {
    await writeFile(join(d.folder, "item.md"), "x\n");
    for (const args of [
      ["learn", "AW-1", "--nothing-new", "--file", "item.md"],
      ["learn", "AW-1", "--nothing-new", "--title", "x"],
      ["learn", "AW-1", "--nothing-new", "--shared"],
      ["learn", "AW-1"],
      ["learn", "AW-1", "--file", "item.md"],
    ]) {
      const out = await d.aw(args);
      expect(out.code, args.join(" ")).toBe(2);
    }
    expect(await learned()).toEqual([]);
  });

  it("puts a files knowledge file of a path named in the first message under Read now", async () => {
    await d.client.createTask("-", {
      project: "billing-api",
      title: "Round the total",
      first_message: "Fix the rounding in `src/api/invoice.ts`.",
    });
    await writeFile(
      join(d.folder, "api.md"),
      '---\napply: files\nglobs: ["src/api/**"]\n---\n# API\n',
    );
    expect(
      (await d.aw(["kb", "write", "projects/billing-api/api.md", "--file", "api.md", "--new"]))
        .code,
    ).toBe(0);
    const out = await d.aw(["kb", "context", "AW-2"]);
    expect(out.stdout).toMatch(
      /## Read now\n- projects\/billing-api\/api\.md \(\d+ characters; a task path matches src\/api\/\*\*\)/,
    );
    const other = await d.aw(["kb", "context", "AW-1"]);
    expect(other.stdout).not.toContain("## Read now");
  });
});
