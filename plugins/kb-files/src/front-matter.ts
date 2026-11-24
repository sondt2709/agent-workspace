// The YAML front matter of a knowledge file: the apply mode, the lock and the provenance
// (docs/phase-1.md 3.2.4, design decision 2). Unknown fields stay in the file.
import type { ApplyMode, FrontMatter } from "@aw/plugin-api";
import { parse, stringify } from "yaml";
import { z } from "zod";

/** The front matter between the first 2 `---` lines. The YAML part can be empty. */
const BLOCK = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

const text = z.string().nullable().optional();
const fields = z.looseObject({
  apply: z.enum(["always", "auto", "files", "manual"]).optional(),
  description: text,
  globs: z
    .union([z.string(), z.array(z.string())])
    .nullable()
    .optional(),
  locked: z.boolean().nullable().optional(),
  source: text,
  author: text,
  task: text,
  learned_at: text,
  validated_at: text,
});

export interface ParsedFile {
  front_matter: FrontMatter;
  /** The reason why the front matter was not used, else null. */
  error: string | null;
  /** The YAML map of the front matter (also the unknown fields), or `{}`. */
  data: Record<string, unknown>;
  /** The text after the front matter. */
  body: string;
  /** The first `# ` heading of the body. */
  title: string | null;
}

/** The default apply mode: `always` for a rule, `auto` for another Markdown file, else `manual`. */
export function defaultApply(rule: boolean, markdown: boolean): ApplyMode {
  if (rule) return "always";
  return markdown ? "auto" : "manual";
}

function defaults(apply: ApplyMode): FrontMatter {
  return {
    apply,
    description: null,
    globs: [],
    locked: false,
    source: null,
    author: null,
    task: null,
    learned_at: null,
    validated_at: null,
  };
}

function titleOf(body: string): string | null {
  const match = /^#[ \t]+(.+?)[ \t#]*$/m.exec(body);
  return match ? match[1]!.trim() : null;
}

/** Splits and reads the front matter of a knowledge file. It never throws. */
export function readFrontMatter(content: string, options: { rule: boolean; markdown: boolean }) {
  const fallback = defaultApply(options.rule, options.markdown);
  const match = BLOCK.exec(content);
  const body = match ? content.slice(match[0].length) : content;
  const result: ParsedFile = {
    front_matter: defaults(fallback),
    error: null,
    data: {},
    body,
    title: titleOf(body),
  };
  if (!match) return result;
  let raw: unknown;
  try {
    raw = parse(match[1] ?? "") ?? {};
  } catch (error) {
    result.error = `The front matter is not valid YAML: ${(error as Error).message.split("\n")[0]}`;
    return result;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    result.error = "The front matter is not a YAML map";
    return result;
  }
  result.data = raw as Record<string, unknown>;
  const parsed = fields.safeParse(raw);
  if (!parsed.success) {
    result.error = `The front matter has a wrong field: ${z.prettifyError(parsed.error).replace(/\n/g, " ")}`;
    return result;
  }
  const value = parsed.data;
  const globs = value.globs ?? [];
  result.front_matter = {
    apply: value.apply ?? fallback,
    description: value.description ?? null,
    globs: typeof globs === "string" ? [globs] : globs,
    locked: value.locked ?? false,
    source: value.source ?? null,
    author: value.author ?? null,
    task: value.task ?? null,
    learned_at: value.learned_at ?? null,
    validated_at: value.validated_at ?? null,
  };
  return result;
}

/** Writes a front matter block and the body. */
export function renderFile(data: Record<string, unknown>, body: string): string {
  const yaml = Object.keys(data).length === 0 ? "" : stringify(data, { lineWidth: 0 });
  return `---\n${yaml}---\n${body}`;
}
