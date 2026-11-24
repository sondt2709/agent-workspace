// The context builder: modes, scope, budget, warnings and the text limit (design decision 11).
import type { ApplyMode, FrontMatter } from "@aw/plugin-api";
import { describe, expect, it } from "vitest";
import { buildContext, namedPaths, type ContextSource, type ContextTask } from "./context.ts";

function file(
  path: string,
  size: number,
  front: Partial<FrontMatter> & { apply: ApplyMode },
  extra: Partial<ContextSource> = {},
): ContextSource {
  const project = /^projects\/([^/]+)\//.exec(path)?.[1] ?? null;
  return {
    path,
    scope: project ? "project" : "shared",
    project,
    size,
    rule: /^(shared|projects\/[^/]+)\/rules\//.test(path),
    title: null,
    front_matter: {
      description: null,
      globs: [],
      locked: false,
      source: null,
      author: null,
      task: null,
      learned_at: null,
      validated_at: null,
      ...front,
    },
    front_matter_error: null,
    ...extra,
  };
}

const task: ContextTask = {
  id: "01a2038e-7f00-70eb-b429-fa86d481c263",
  key: "AW-7",
  project: "billing-api",
  title: "Fix the flaky invoice test",
  first_message: "/opsx:explore The invoice test fails. See projects/billing-api/deploy.md.",
};

const sectionOf = (ctx: ReturnType<typeof buildContext>, path: string) =>
  ctx.files.find((f) => f.path === path)?.section;

describe("buildContext", () => {
  it("selects by scope and apply mode", () => {
    const ctx = buildContext({
      folder: "/w/knowledge",
      task: { ...task, paths: ["src/api/invoice.ts"] },
      files: [
        file("shared/rules/testing.md", 300, { apply: "always" }),
        file("projects/billing-api/rules/naming.md", 200, { apply: "auto" }),
        file("projects/billing-api/overview.md", 400, { apply: "always" }),
        file("projects/billing-api/learned/db.md", 100, {
          apply: "auto",
          description: "Reset the DB before the invoice tests",
        }),
        file("projects/billing-api/api.md", 100, { apply: "files", globs: ["src/api/**"] }),
        file("projects/billing-api/ui.md", 100, { apply: "files", globs: ["web/**/*.tsx"] }),
        file("projects/billing-api/deploy.md", 100, { apply: "manual" }),
        file("projects/billing-api/secret-ops.md", 100, { apply: "manual" }),
        file("projects/other-app/rules/x.md", 100, { apply: "always" }),
      ],
    });
    expect(sectionOf(ctx, "shared/rules/testing.md")).toBe("read_now");
    expect(sectionOf(ctx, "projects/billing-api/rules/naming.md")).toBe("read_now");
    expect(sectionOf(ctx, "projects/billing-api/overview.md")).toBe("read_now");
    expect(sectionOf(ctx, "projects/billing-api/api.md")).toBe("read_now");
    expect(sectionOf(ctx, "projects/billing-api/deploy.md")).toBe("read_now");
    expect(sectionOf(ctx, "projects/billing-api/learned/db.md")).toBe("relevant");
    expect(sectionOf(ctx, "projects/billing-api/ui.md")).toBe("matching");
    expect(sectionOf(ctx, "projects/billing-api/secret-ops.md")).toBe("not_listed");
    expect(sectionOf(ctx, "projects/other-app/rules/x.md")).toBeUndefined();
    expect(ctx.budget).toMatchObject({ load_limit: 40_000, load_used: 1100 });
    expect(ctx.warnings).toEqual([]);
    expect(ctx.text).toContain("# AW knowledge for AW-7 (project billing-api)");
    expect(ctx.text).toContain(
      "- projects/billing-api/learned/db.md: Reset the DB before the invoice tests",
    );
    expect(ctx.text).toContain("- projects/billing-api/ui.md: web/**/*.tsx");
    expect(ctx.text).toContain("1 manual files are not listed");
    expect(ctx.text).not.toContain("secret-ops");
  });

  it("drops the files of the lowest priority over the budget, each with a warning", () => {
    const ctx = buildContext({
      folder: "/w/knowledge",
      task,
      load_limit: 40_000,
      files: [
        file("shared/rules/testing.md", 10_000, { apply: "always" }),
        file("projects/billing-api/rules/naming.md", 12_000, { apply: "always" }),
        file("projects/billing-api/overview.md", 15_000, { apply: "always" }),
        file("shared/big.md", 15_000, { apply: "always" }),
      ],
    });
    expect(ctx.budget.load_used).toBe(37_000);
    expect(sectionOf(ctx, "shared/big.md")).toBe("dropped");
    expect(ctx.warnings).toEqual([
      expect.objectContaining({ code: "over_budget", path: "shared/big.md" }),
    ]);
    expect(ctx.warnings[0]!.message).toContain("15,000 characters");
    expect(ctx.warnings[0]!.message).toContain("40,000 characters");
    expect(ctx.text).toContain("## Dropped (over the budget)\n- shared/big.md (15,000 characters)");
  });

  it("keeps the text below the limit and says how many files are not listed", () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      file(`projects/billing-api/learned/item-${String(i).padStart(3, "0")}.md`, 50, {
        apply: "auto",
        description: `Learned item number ${i} about the invoice tests and the test database`,
      }),
    );
    const ctx = buildContext({
      folder: "/w/knowledge",
      task,
      files: [file("shared/rules/testing.md", 300, { apply: "always" }), ...many],
    });
    expect(ctx.text.length).toBeLessThanOrEqual(9_000);
    expect(ctx.budget.text_length).toBe(ctx.text.length);
    expect(ctx.text).toContain("shared/rules/testing.md");
    expect(ctx.text).toMatch(/\d+ more files are not listed \(text limit\)/);
    expect(ctx.warnings).toEqual([expect.objectContaining({ code: "text_limit" })]);
  });

  it("warns about a bad front matter", () => {
    const ctx = buildContext({
      folder: "/w/knowledge",
      task,
      files: [file("shared/notes.md", 10, { apply: "auto" }, { front_matter_error: "bad apply" })],
    });
    expect(ctx.warnings).toEqual([
      expect.objectContaining({ code: "front_matter", path: "shared/notes.md" }),
    ]);
    expect(ctx.text).toContain("## Warnings");
  });
});

describe("task paths named in the task (agent-learning)", () => {
  const api = file("projects/billing-api/api.md", 100, { apply: "files", globs: ["src/api/**"] });

  it("puts a files file in Read now when the first message names a matching path", () => {
    const ctx = buildContext({
      folder: "/w/knowledge",
      task: { ...task, first_message: "Fix the rounding in `src/api/invoice.ts`." },
      files: [api],
    });
    expect(ctx.files.find((f) => f.path === api.path)).toMatchObject({
      section: "read_now",
      reason: "a task path matches src/api/**",
    });
  });

  it("does not take a URL as a path", () => {
    const ctx = buildContext({
      folder: "/w/knowledge",
      task: { ...task, first_message: "See https://example.com/src/api/x.ts" },
      files: [api],
    });
    expect(sectionOf(ctx, api.path)).toBe("matching");
  });

  it("finds paths with a slash or an extension, with no punctuation, each once, up to the limit", () => {
    expect(
      namedPaths(
        "Fix ./src/api/invoice.ts, (lib/util.js) and README.md! Not https://example.com/a/b.ts, /etc/hosts, ../up/x.ts or @aw/core. Again src/api/invoice.ts.",
      ),
    ).toEqual(["src/api/invoice.ts", "lib/util.js", "README.md"]);
    expect(namedPaths("a/1 a/2 a/3", 2)).toEqual(["a/1", "a/2"]);
  });
});
