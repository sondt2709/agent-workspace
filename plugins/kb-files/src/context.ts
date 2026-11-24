// The context builder: the knowledge of a session by scope and apply mode, with the size budget
// and a warning for each dropped file (docs/architecture.md 4.8.1, prd KB-09, design decision 11).
// The agent reads the files itself: the text is a short header and a list, below the hook limit.
import type { ContextFile, ContextWarning, KnowledgeFile, SessionContext } from "@aw/plugin-api";
import { matchesGlob } from "node:path";

/** The default size of the "Read now" files, in characters. */
export const DEFAULT_LOAD_LIMIT = 40_000;
/** The longest context text: below the 10,000-character SessionStart limit, with room for the task. */
export const TEXT_LIMIT = 9_000;
const DESCRIPTION_LIMIT = 200;

export type ContextSource = Pick<
  KnowledgeFile,
  "path" | "scope" | "project" | "size" | "rule" | "title" | "front_matter" | "front_matter_error"
>;

export interface ContextTask {
  id: string;
  key: string | null;
  project: string;
  title: string;
  first_message: string;
  /**
   * Paths of the checkout that the task changes, for the Files mode. The paths that the title and
   * the first message name are task paths too (agent-learning).
   */
  paths?: string[];
}

export interface ContextInput {
  files: ContextSource[];
  task: ContextTask;
  /** The absolute path of the `knowledge/` folder. */
  folder: string;
  load_limit?: number;
  text_limit?: number;
}

const number = (n: number) => n.toLocaleString("en-US");

interface Candidate {
  file: ContextSource;
  priority: number;
  reason: string;
}

/** The most task paths that the text of a task gives. */
export const NAMED_PATHS_LIMIT = 200;

/**
 * The file paths named in a text (agent-learning): a token with a `/` or a file extension, for
 * example `src/api/invoice.ts` or `README.md`, with no quotes or punctuation around it. A URL is not
 * a path. At most `NAMED_PATHS_LIMIT` paths, in the order of the text, each once.
 */
export function namedPaths(text: string, limit = NAMED_PATHS_LIMIT): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/[\s,;()[\]{}<>"'`]+/)) {
    if (out.size >= limit) break;
    // An absolute path, a package name and a URL (its `:`) are not task paths.
    if (raw.startsWith("@") || raw.startsWith("/")) continue;
    const token = raw.replace(/^(?:\.\/)+/, "").replace(/[.:!?]+$/, "");
    if (!/^[\w.@-]+(?:\/[\w.@-]+)*\/?$/.test(token) || token.includes("..")) continue;
    const path = token.replace(/\/$/, "");
    if (path.includes("/") || /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(path)) out.add(path);
  }
  return [...out];
}

function mentioned(task: ContextTask, path: string): boolean {
  const text = `${task.title}\n${task.first_message}`;
  return text.includes(path);
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > DESCRIPTION_LIMIT ? `${line.slice(0, DESCRIPTION_LIMIT - 1)}…` : line;
}

export function buildContext(input: ContextInput): SessionContext {
  const loadLimit = input.load_limit ?? DEFAULT_LOAD_LIMIT;
  const textLimit = input.text_limit ?? TEXT_LIMIT;
  const task = input.task;
  // The task paths: the given paths and the paths that the title and the first message name.
  const paths = [
    ...new Set([...(task.paths ?? []), ...namedPaths(`${task.title}\n${task.first_message}`)]),
  ];
  const files = input.files
    .filter((f) => f.scope === "shared" || f.project === task.project)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const warnings: ContextWarning[] = [];
  const candidates: Candidate[] = [];
  const out: ContextFile[] = [];
  const add = (file: ContextSource, section: ContextFile["section"], reason: string) =>
    out.push({ path: file.path, mode: file.front_matter.apply, size: file.size, section, reason });

  for (const file of files) {
    if (file.front_matter_error) {
      warnings.push({
        code: "front_matter",
        path: file.path,
        message: `${file.path}: ${file.front_matter_error}. AW used the default apply mode.`,
      });
    }
    const project = file.scope === "project";
    const mode = file.front_matter.apply;
    if (file.rule) {
      candidates.push({ file, priority: project ? 0 : 1, reason: "rule" });
    } else if (mode === "always") {
      candidates.push({ file, priority: project ? 2 : 3, reason: "always" });
    } else if (mode === "manual") {
      if (mentioned(task, file.path)) {
        candidates.push({ file, priority: 4, reason: "named in the task" });
      } else add(file, "not_listed", "manual, not named in the task");
    } else if (mode === "files") {
      const glob = file.front_matter.globs.find((g) => paths.some((p) => matchesGlob(p, g)));
      if (glob !== undefined) {
        candidates.push({ file, priority: 5, reason: `a task path matches ${glob}` });
      } else add(file, "matching", file.front_matter.globs.join(", ") || "no globs");
    } else {
      add(file, "relevant", "auto");
    }
  }

  // Keep the files in priority order; drop from the end until the sum fits the budget.
  candidates.sort((a, b) => a.priority - b.priority || (a.file.path < b.file.path ? -1 : 1));
  const kept = [...candidates];
  let used = kept.reduce((sum, c) => sum + c.file.size, 0);
  const dropped: Candidate[] = [];
  while (used > loadLimit && kept.length > 0) {
    const last = kept.pop()!;
    used -= last.file.size;
    dropped.unshift(last);
  }
  for (const c of kept) add(c.file, "read_now", c.reason);
  for (const c of dropped) {
    add(c.file, "dropped", `over the budget (${c.reason})`);
    warnings.push({
      code: "over_budget",
      path: c.file.path,
      message: `AW dropped ${c.file.path} (${number(c.file.size)} characters, ${c.reason}): "Read now" is over the budget of ${number(loadLimit)} characters.`,
    });
  }

  const label = task.key ?? task.id;
  const header = [
    `# AW knowledge for ${label} (project ${task.project})`,
    `The files are in ${input.folder}. Read each file of "Read now" before you act. Read the other files when their condition applies. Search with \`aw kb search <terms>\`.`,
    `Budget: ${number(used)} of ${number(loadLimit)} characters in "Read now".`,
  ];
  const describe = (f: ContextFile): string => {
    const file = files.find((x) => x.path === f.path)!;
    switch (f.section) {
      case "read_now":
        return `- ${f.path} (${number(f.size)} characters; ${f.reason})`;
      case "relevant":
        return `- ${f.path}: ${oneLine(file.front_matter.description ?? file.title ?? "no description")}`;
      case "matching":
        return `- ${f.path}: ${f.reason}`;
      case "dropped":
        return `- ${f.path} (${number(f.size)} characters): read it only when you need it`;
      default:
        return "";
    }
  };
  const sections: { title: string; section: ContextFile["section"] }[] = [
    { title: "## Read now", section: "read_now" },
    { title: "## Dropped (over the budget)", section: "dropped" },
    { title: "## Read when relevant", section: "relevant" },
    { title: "## Read before you change matching files", section: "matching" },
  ];
  const lines = new Map(
    sections.map((s) => [s.section, out.filter((f) => f.section === s.section).map(describe)]),
  );
  const notListed = out.filter((f) => f.section === "not_listed").length;
  let omitted = 0;
  const render = () => {
    const parts = [...header];
    for (const s of sections) {
      const list = lines.get(s.section)!;
      if (list.length > 0) parts.push("", s.title, ...list);
    }
    const tail: string[] = [];
    for (const w of warnings) if (w.code === "front_matter") tail.push(`- ${w.message}`);
    if (omitted > 0) {
      tail.push(`- ${omitted} more files are not listed (text limit). Run \`aw kb list\`.`);
    }
    if (tail.length > 0) parts.push("", "## Warnings", ...tail);
    if (notListed > 0) {
      parts.push("", `${notListed} manual files are not listed. Run \`aw kb list\` to see them.`);
    }
    return parts.join("\n");
  };
  // The list must fit the text limit: remove lines from the end of the least important section.
  let text = render();
  const order: ContextFile["section"][] = ["relevant", "matching", "dropped", "read_now"];
  while (text.length > textLimit) {
    const section = order.find((s) => lines.get(s)!.length > 0);
    if (!section) break;
    lines.get(section)!.pop();
    omitted += 1;
    text = render();
  }
  if (text.length > textLimit) text = `${text.slice(0, textLimit - 1)}…`;
  if (omitted > 0) {
    warnings.push({
      code: "text_limit",
      path: null,
      message: `${omitted} files are not in the context text: it is limited to ${number(textLimit)} characters.`,
    });
  }
  return {
    text,
    files: out,
    warnings,
    budget: {
      load_limit: loadLimit,
      load_used: used,
      text_limit: textLimit,
      text_length: text.length,
    },
  };
}
