// The remove of a project (openspec project-remove): the merge case `project-removed` with the rule
// one item at a time, and the next free key after a remove.
import { mergeCases } from "@aw/schema/testing";
import { describe, expect, it } from "vitest";
import { nextFreeKey } from "./keys.ts";
import { runMergeCase } from "./testing.ts";

const item = mergeCases().find((c) => c.name === "project-removed")!;

async function view() {
  const run = await runMergeCase(item);
  await run.cleanup();
  return run.update.view;
}

describe("project-removed", () => {
  it("shows only the live projects: billing-api added again and docs-site", async () => {
    const v = await view();
    expect(v.projects.map((p) => p.slug)).toEqual(["billing-api", "docs-site"]);
    expect(v.projects.find((p) => p.slug === "billing-api")!.added_at).toBe(
      "2026-11-24T11:00:00.000Z#0000",
    );
  });

  it("removes each task that sorts before the remove, and each task of a project that is not live", async () => {
    const v = await view();
    expect(v.tasks.map((t) => t.key).sort()).toEqual(["AW-21", "AW-22", "AW-25"]);
    expect(v.removed_tasks.map((t) => t.key).sort()).toEqual(["AW-20", "AW-23", "AW-24", "AW-7"]);
    expect(v.projects.find((p) => p.slug === "billing-api")!.tasks.length).toBe(2);
  });

  it("drops a removed task from the open dependencies of a live task", async () => {
    const v = await view();
    const docs = v.tasks.find((t) => t.key === "AW-25")!;
    expect(docs.depends_on).toEqual(["01a2a200-0000-7000-8000-000000000004"]);
    expect(docs.open_dependencies).toEqual([]);
  });

  it("lists each removal of a person, with the copy of project.yaml", async () => {
    const v = await view();
    expect(v.removed_projects.map((r) => [r.slug, r.removed.dev, r.removed.by])).toEqual([
      ["billing-api", "macbook-pro", "human@macbook-pro"],
      ["web-app", "pixel-9", "human@pixel-9"],
    ]);
    expect(v.removed_projects[0]!.document.devices).toEqual(["ubuntu-01", "macbook-pro"]);
  });

  it("refuses the remove of an agent", async () => {
    const run = await runMergeCase(item);
    await run.cleanup();
    const row = run.engine
      .eventRows(null)
      .find((r) => r.id === "01a2a100-0000-7000-8000-000000000003")!;
    expect([row.applied, row.reason]).toEqual([false, "not_human"]);
  });

  it("gives a key above each removed task", async () => {
    const v = await view();
    // AW-25 is the highest key of the case, and AW-7 (removed) is below it.
    expect(nextFreeKey(v, "AW")).toBe("AW-26");
    expect(
      nextFreeKey(
        { tasks: [], removed_tasks: v.removed_tasks.filter((t) => t.key === "AW-24") },
        "AW",
      ),
    ).toBe("AW-25");
  });
});
