// Unit tests of the pure parts: paths, front matter, approval rules, search.
import { describe, expect, it } from "vitest";
import { readFrontMatter, renderFile } from "./front-matter.ts";
import { isLearned, isRule, parseKnowledgePath, slugOf } from "./paths.ts";
import { approvalReasons } from "./rules.ts";
import { searchTexts } from "./search.ts";

describe("knowledge paths", () => {
  it("accepts the 2 scopes and refuses each other path", () => {
    expect(parseKnowledgePath("shared/rules/testing.md")).toMatchObject({
      scope: "shared",
      project: null,
      rest: "rules/testing.md",
    });
    expect(parseKnowledgePath("projects/billing-api/learned/x.md")).toMatchObject({
      scope: "project",
      project: "billing-api",
    });
    for (const bad of [
      "log/macbook-pro.jsonl",
      "readme.md",
      "projects/Billing/x.md",
      "projects/billing-api",
      "shared/../x.md",
      "/shared/x.md",
      "shared/.DS_Store",
      "shared/x.md.aw-tmp",
      "shared/x.sync-conflict-20261122-101010-ABCDEFG.md",
      "shared/~syncthing~x.md.tmp",
    ]) {
      expect(parseKnowledgePath(bad), bad).toBeNull();
    }
  });

  it("finds a rule and a learned file in any case (fix list 0-0a: macOS ignores case)", () => {
    const of = (path: string) => parseKnowledgePath(path)!;
    for (const path of [
      "projects/billing-api/rules/x.md",
      "projects/billing-api/Rules/x.md",
      "projects/billing-api/RULES/a/x.md",
      "shared/rUles/x.md",
      "projects/billing-api/rule\u017f/x.md",
    ]) {
      expect(isRule(of(path)), path).toBe(true);
    }
    for (const path of ["projects/billing-api/rules", "projects/billing-api/rules.md"]) {
      expect(isRule(of(path)), path).toBe(false);
    }
    expect(isLearned(of("projects/billing-api/Learned/x.md"))).toBe(true);
  });

  it("makes a slug from a title", () => {
    expect(slugOf("Reset the DB before the invoice tests!")).toBe(
      "reset-the-db-before-the-invoice-tests",
    );
    expect(slugOf("???")).toBe("item");
    expect(slugOf("x".repeat(80))).toHaveLength(60);
  });
});

describe("front matter", () => {
  it("gives a rule the mode always and another Markdown file auto", () => {
    expect(readFrontMatter("# Naming\n", { rule: true, markdown: true }).front_matter.apply).toBe(
      "always",
    );
    expect(readFrontMatter("# Notes\n", { rule: false, markdown: true }).front_matter.apply).toBe(
      "auto",
    );
    expect(readFrontMatter("x", { rule: false, markdown: false }).front_matter.apply).toBe(
      "manual",
    );
  });

  it("reads the fields and keeps the unknown fields in data", () => {
    const parsed = readFrontMatter(
      "---\napply: files\nglobs: src/api/**\nlocked: true\nowner: team-a\n---\n# API style\n\nUse snake_case.\n",
      { rule: false, markdown: true },
    );
    expect(parsed.error).toBeNull();
    expect(parsed.front_matter).toMatchObject({
      apply: "files",
      globs: ["src/api/**"],
      locked: true,
    });
    expect(parsed.data.owner).toBe("team-a");
    expect(parsed.title).toBe("API style");
    expect(parsed.body).toBe("# API style\n\nUse snake_case.\n");
  });

  it("gives the defaults and an error for a bad front matter", () => {
    const wrong = readFrontMatter("---\napply: sometimes\n---\nx", { rule: false, markdown: true });
    expect(wrong.front_matter.apply).toBe("auto");
    expect(wrong.error).toMatch(/wrong field/);
    const list = readFrontMatter("---\n- a\n---\nx", { rule: true, markdown: true });
    expect(list.error).toMatch(/not a YAML map/);
    expect(list.front_matter.apply).toBe("always");
    const yaml = readFrontMatter("---\napply: [\n---\nx", { rule: false, markdown: true });
    expect(yaml.error).toMatch(/not valid YAML/);
  });

  it("reads an empty front matter and renders a file again", () => {
    const empty = readFrontMatter("---\n---\nbody\n", { rule: false, markdown: true });
    expect(empty.error).toBeNull();
    expect(empty.body).toBe("body\n");
    const text = renderFile({ apply: "auto", locked: false }, "# T\n");
    expect(readFrontMatter(text, { rule: false, markdown: true }).front_matter.apply).toBe("auto");
  });
});

describe("approval rules", () => {
  const parts = (path: string) => parseKnowledgePath(path)!;

  it("needs no approval for a human or for an agent in a project", () => {
    expect(
      approvalReasons({ parts: parts("shared/rules/x.md"), author: "human@pixel-9", locked: true }),
    ).toEqual([]);
    expect(
      approvalReasons({
        parts: parts("projects/billing-api/learned/x.md"),
        author: "claude@ubuntu-01",
        locked: false,
      }),
    ).toEqual([]);
  });

  it("gives each reason of an agent change", () => {
    expect(
      approvalReasons({
        parts: parts("shared/rules/x.md"),
        author: "claude@ubuntu-01",
        locked: true,
        from_person: "a-friend",
      }),
    ).toEqual(["rule", "locked", "shared", "other_person"]);
    expect(
      approvalReasons({
        parts: parts("projects/billing-api/rules/x.md"),
        author: "claude@ubuntu-01",
        locked: false,
      }),
    ).toEqual(["rule"]);
    expect(
      approvalReasons({
        parts: parts("projects/billing-api/notes.md"),
        author: "claude@ubuntu-01",
        locked: true,
      }),
    ).toEqual(["locked"]);
  });
});

describe("search", () => {
  it("needs each term and sorts by the count", () => {
    const hits = searchTexts(
      [
        { path: "shared/a.md", text: "Reset the invoice DB.\nThe invoice test fails." },
        { path: "shared/b.md", text: "Invoice only." },
        { path: "shared/c.md", text: "reset invoice reset invoice reset" },
      ],
      "INVOICE reset",
      10,
    );
    expect(hits.map((h) => h.path)).toEqual(["shared/c.md", "shared/a.md"]);
    expect(hits[1]).toMatchObject({ line: 1, snippet: "Reset the invoice DB." });
    expect(searchTexts([{ path: "shared/a.md", text: "x" }], "  ", 10)).toEqual([]);
  });
});
