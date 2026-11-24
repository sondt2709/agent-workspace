import { describe, expect, it } from "vitest";
import type { HistoryEntry, KnowledgeFile } from "../../shared/channels.ts";
import { bodyOf, digestLine, groupFiles, learnedLabel, reasonsText } from "./kb-model.ts";

function file(path: string, extra: Partial<KnowledgeFile> = {}): KnowledgeFile {
  return { path, rule: false, learned: false, title: null, ...extra } as KnowledgeFile;
}

describe("kb-model", () => {
  it("groups files into Rules, Knowledge and Learned", () => {
    const groups = groupFiles([
      file("projects/p/learned/b.md", { learned: true }),
      file("projects/p/rules/a.md", { rule: true }),
      file("projects/p/notes.md"),
    ]);
    expect(groups.map((g) => [g.group, g.files.map((f) => f.path)])).toEqual([
      ["Rules", ["projects/p/rules/a.md"]],
      ["Knowledge", ["projects/p/notes.md"]],
      ["Learned", ["projects/p/learned/b.md"]],
    ]);
  });

  it("removes the front matter from the body", () => {
    expect(bodyOf("---\napply: auto\n---\n# Title\n")).toBe("# Title\n");
    expect(bodyOf("# No front matter\n")).toBe("# No front matter\n");
  });

  it("takes the learned label from the history", () => {
    const history = [
      { kind: "edit", label: "Edited by human@macbook-pro" },
      { kind: "learned", label: "Learned by claude@ubuntu-01 on AW-7" },
    ] as HistoryEntry[];
    expect(learnedLabel(history)).toBe("Learned by claude@ubuntu-01 on AW-7");
    expect(learnedLabel([])).toBeNull();
  });

  it("explains the reasons and the digest counts", () => {
    expect(reasonsText(["rule", "shared"])).toBe("It changes a rule and shared knowledge.");
    expect(digestLine({ learned: 1, changes: 0, pending: 1 })).toBe(
      "1 learned · 1 waits for approval",
    );
  });
});
