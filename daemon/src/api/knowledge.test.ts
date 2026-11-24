// The knowledge routes through the real socket (spec local-api "Knowledge routes").
import { AwApiError } from "@aw/client";
import { KnowledgeClient } from "@aw/client/knowledge";
import { FakeClock } from "@aw/core";
import { sha256Of } from "@aw/kb-files";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestDaemon, type TestDaemon } from "../testing.ts";

let d: TestDaemon;
let kb: KnowledgeClient;
let task: string;
const clock = new FakeClock("2026-11-22T14:20:01.123Z");

beforeEach(async () => {
  d = await startTestDaemon({ workspace: true, clock });
  kb = new KnowledgeClient(d.client);
  const created = await d.client.createTask("-", {
    project: "billing-api",
    title: "Fix the flaky invoice test",
    first_message: "/opsx:explore The invoice test fails. Read projects/billing-api/deploy.md.",
  });
  task = created.task.id;
});
afterEach(async () => {
  await d.close();
});

async function apiError(promise: Promise<unknown>): Promise<AwApiError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AwApiError);
  return error as AwApiError;
}

describe("knowledge routes", () => {
  it("learns, lists, shows the history, undoes and shows the digest", async () => {
    const learned = await kb.learn("-", {
      task: "AW-1",
      title: "Reset the DB",
      content: "Run make db-reset before the invoice tests.\n",
      author: "claude@macbook-pro",
    });
    expect(learned.change).toMatchObject({
      path: "projects/billing-api/learned/2026-11-22-reset-the-db.md",
      kind: "learned",
      author: "claude@macbook-pro",
      task,
      label: "Learned by claude@macbook-pro on AW-1",
    });
    const list = await kb.list("-", { scope: "project", project: "billing-api" });
    expect(list.map((f) => f.path)).toEqual([learned.change!.path]);
    expect(list[0]!.front_matter).toMatchObject({
      apply: "auto",
      source: "claude@macbook-pro on AW-1",
    });
    expect((await kb.digest("-")).text).toBe("Agents learned 1 thing.");

    const undo = await kb.undo("-", learned.change!.id);
    expect(undo.change).toMatchObject({ kind: "undo", hash: null, author: "human@macbook-pro" });
    const history = await kb.history("-", learned.change!.path);
    expect(history.map((h) => h.kind)).toEqual(["learned", "undo"]);
    expect(history[0]!.diff).toContain("+Run make db-reset");
    await expect(
      readFile(join(d.folder, "knowledge", ...learned.change!.path.split("/"))),
    ).rejects.toThrow(/ENOENT/);
    // The history store is in the state folder, outside the synced folder.
    const store = join(d.home, "history", (await d.client.workspaces())[0]!.id);
    expect(await readdir(store)).toContain(learned.change!.hash);
  });

  it("refuses an old base (409), a path outside the scopes (403), another device (400), a missing version (404)", async () => {
    await kb.write("-", { path: "shared/notes.md", content: "one\n", base: null });
    const conflict = await apiError(
      kb.write("-", { path: "shared/notes.md", content: "two\n", base: null }),
    );
    expect(conflict).toMatchObject({ status: 409, code: "conflict" });
    expect(conflict.details).toMatchObject({ current: sha256Of("one\n") });
    expect(await apiError(kb.write("-", { path: "log/x.jsonl", content: "x" }))).toMatchObject({
      status: 403,
      code: "refused",
    });
    expect(
      await apiError(
        kb.learn("-", { task: "AW-1", title: "x", content: "x", author: "claude@ubuntu-01" }),
      ),
    ).toMatchObject({ status: 400, code: "invalid_input" });
    expect(await apiError(kb.read("-", "shared/notes.md", "e".repeat(64)))).toMatchObject({
      status: 404,
    });
    expect(await apiError(kb.undo("-", "0000000000"))).toMatchObject({ status: 404 });
  });

  it("keeps an agent change to shared knowledge as a suggestion until a human accepts it", async () => {
    const result = await kb.learn("-", {
      task: "AW-1",
      title: "Team rule",
      content: "Use the fake clock.\n",
      shared: true,
      author: "claude@macbook-pro",
    });
    expect(result.change).toBeNull();
    expect(result.suggestion).toMatchObject({
      state: "pending",
      reasons: ["shared"],
      task_key: "AW-1",
    });
    expect(await kb.list("-")).toEqual([]);
    expect((await kb.suggestions("-")).map((s) => s.id)).toEqual([result.suggestion!.id]);
    expect((await kb.digest("-")).text).toBe("1 change waits for approval.");
    const accepted = await kb.accept("-", result.suggestion!.id, { comment: "yes" });
    expect(accepted.change).toMatchObject({
      author: "claude@macbook-pro",
      by: "human@macbook-pro",
    });
    expect(accepted.suggestion).toMatchObject({ state: "accepted" });
    expect((await kb.list("-")).map((f) => f.path)).toEqual([accepted.change!.path]);
    const again = await apiError(kb.reject("-", result.suggestion!.id));
    expect(again).toMatchObject({ status: 409 });
  });

  it("builds the context of a task and searches", async () => {
    await kb.write("-", {
      path: "shared/rules/testing.md",
      content: "# Testing\n\nUse the fake clock.\n",
    });
    await kb.write("-", {
      path: "projects/billing-api/deploy.md",
      content: "---\napply: manual\n---\n# Deploy\n",
    });
    await kb.write("-", {
      path: "projects/billing-api/api.md",
      content: '---\napply: files\nglobs: ["src/api/**"]\n---\n# API\n',
    });
    const context = await kb.context("-", { task: "aw-1", paths: ["src/api/invoice.ts"] });
    expect(context.files.filter((f) => f.section === "read_now").map((f) => f.path)).toEqual([
      "shared/rules/testing.md",
      "projects/billing-api/deploy.md",
      "projects/billing-api/api.md",
    ]);
    expect(context.text.length).toBeLessThanOrEqual(9000);
    expect(context.text).toContain("# AW knowledge for AW-1 (project billing-api)");
    expect(context.budget.text_limit).toBe(9000);
    const hits = await kb.search("-", { q: "fake clock", limit: 5 });
    expect(hits.map((h) => h.path)).toEqual(["shared/rules/testing.md"]);
  });
});
