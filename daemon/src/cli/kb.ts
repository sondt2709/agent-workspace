// The knowledge commands of the aw CLI: `aw kb …` and `aw learn` (add-knowledge-store). They call
// the knowledge routes of the local API through KnowledgeClient and print the reply.
import type { AwClient } from "@aw/client";
import { KnowledgeClient, type LearnResult } from "@aw/client/knowledge";
import type {
  ChangeResult,
  HistoryEntry,
  KnowledgeFile,
  SearchHit,
  Suggestion,
} from "@aw/plugin-api";
import type { Command } from "@commander-js/extra-typings";

export interface KbCommandContext {
  client: AwClient;
  /** The workspace selector of the global option. */
  wsName: () => string;
  print: (value: unknown, text: () => string) => void;
  /** Reads a file, or stdin for `-`. */
  readText: (path: string) => Promise<string>;
  /** Makes the input error of the CLI (exit code 2). */
  inputError: (message: string) => Error;
  /** Writes the message to stderr and sets exit code 1: a write that the merge did not apply. */
  notApplied: (message: string) => void;
}

const short = (id: string | null) => (id ? id.slice(0, 13) : "-");

/** The text of a learning step: "Nothing new" or the change result of the learned item. */
export function formatLearnResult(task: string, result: LearnResult): string {
  // A step that the merge did not apply is not recorded (review agent-learning low 2).
  if (result.task_event && !result.task_event.applied) {
    return `Not recorded: the learning step of ${task} does not count`;
  }
  if (!result.change && !result.suggestion && result.task_event) {
    return `Recorded: nothing new learned on ${task}`;
  }
  return formatChangeResult(result);
}

export function formatChangeResult(result: ChangeResult): string {
  if (result.suggestion && result.suggestion.state === "pending") {
    const s = result.suggestion;
    return `Waits for approval: ${s.path} (reasons: ${s.reasons.join(", ")}). Suggestion ${s.id}`;
  }
  if (result.unchanged) return "No change: the file has this content already";
  const c = result.change!;
  return `${c.label}: ${c.path} (change ${c.id})`;
}

function formatFiles(files: KnowledgeFile[]): string {
  if (files.length === 0) return "No knowledge files";
  return files
    .map((f) => {
      const flags = [f.front_matter.apply, f.front_matter.locked ? "locked" : null]
        .filter(Boolean)
        .join(", ");
      const last = f.last_change
        ? `  ${f.last_change.kind} by ${f.last_change.author}`
        : "  no change event";
      const error = f.front_matter_error ? `  [front matter: ${f.front_matter_error}]` : "";
      return `${f.path}  (${flags}; ${f.size} bytes)${last}${error}`;
    })
    .join("\n");
}

function formatHistory(entries: HistoryEntry[]): string {
  if (entries.length === 0) return "No changes";
  return entries
    .map((e) => {
      const head = `${e.at}  ${e.label}  [${e.kind}, ${e.dev}]  change ${e.id}`;
      const versions = `  ${short(e.base)} -> ${short(e.hash)}${e.base_available ? "" : "  (base not on this device: no Undo)"}`;
      return e.diff ? `${head}\n${versions}\n${e.diff.trimEnd()}` : `${head}\n${versions}`;
    })
    .join("\n\n");
}

function formatSuggestions(list: Suggestion[]): string {
  if (list.length === 0) return "No suggestions";
  return list
    .map(
      (s) =>
        `${s.id}  ${s.state}  ${s.kind} ${s.path} by ${s.author}${s.task_key ? ` on ${s.task_key}` : ""}  (reasons: ${s.reasons.join(", ")})`,
    )
    .join("\n");
}

function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "No match";
  return hits.map((h) => `${h.path}:${h.line}  ${h.snippet}`).join("\n");
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function scopeQuery(options: { shared?: true; project?: string }) {
  if (options.shared) return { scope: "shared" as const };
  if (options.project) return { scope: "project" as const, project: options.project };
  return {};
}

/** Adds `aw kb …` and `aw learn` to the program. */
export function addKnowledgeCommands(program: Command, ctx: KbCommandContext): void {
  const kb = new KnowledgeClient(ctx.client);
  const group = program.command("kb").description("Knowledge files, history, Undo and approval");

  group
    .command("list")
    .description("List the knowledge files")
    .option("--shared", "only the shared knowledge")
    .option("--project <slug>", "only the knowledge of this project")
    .action(async (options) => {
      const list = await kb.list(ctx.wsName(), scopeQuery(options));
      ctx.print(list, () => formatFiles(list));
    });

  group
    .command("show")
    .description("Print a knowledge file, or a version from the history store")
    .argument("<path>", "for example shared/rules/testing.md")
    .option("--version <hash>", "the sha256 of a version")
    .action(async (path, options) => {
      const file = await kb.read(ctx.wsName(), path, options.version);
      ctx.print(file, () => file.content.replace(/\n$/, ""));
    });

  group
    .command("write")
    .description("Write a knowledge file as the human of this device")
    .argument("<path>", "for example projects/billing-api/notes.md")
    .requiredOption("--file <path>", "the new content; - reads stdin")
    .option("--base <hash>", "the hash that the file must have now")
    .option("--new", "the file must not exist")
    .action(async (path, options) => {
      if (options.base !== undefined && options.new) {
        throw ctx.inputError("Give --base or --new, not both");
      }
      const content = await ctx.readText(options.file);
      const result = await kb.write(ctx.wsName(), {
        path,
        content,
        ...(options.new ? { base: null } : options.base ? { base: options.base } : {}),
      });
      ctx.print(result, () => formatChangeResult(result));
    });

  group
    .command("history")
    .description("Show the changes of a file from all devices, with diffs")
    .argument("<path>")
    .action(async (path) => {
      const entries = await kb.history(ctx.wsName(), path);
      ctx.print(entries, () => formatHistory(entries));
    });

  group
    .command("undo")
    .description("Undo a change: write its base content as a new change")
    .argument("<change>", "the change id, or its first 8 or more characters")
    .action(async (change) => {
      const result = await kb.undo(ctx.wsName(), change);
      ctx.print(result, () => formatChangeResult(result));
    });

  group
    .command("search")
    .description("Find the files that have each term")
    .argument("<terms...>")
    .option("--shared", "only the shared knowledge")
    .option("--project <slug>", "only the knowledge of this project")
    .option("--limit <n>", "at most n results (1 to 200)", (value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 200)
        throw ctx.inputError("--limit must be 1 to 200");
      return n;
    })
    .action(async (words, options) => {
      const hits = await kb.search(ctx.wsName(), {
        q: words.join(" "),
        ...scopeQuery(options),
        ...(options.limit ? { limit: options.limit } : {}),
      });
      ctx.print(hits, () => formatHits(hits));
    });

  group
    .command("suggestions")
    .description("List the agent changes that wait for approval")
    .option("--all", "also the accepted and rejected suggestions")
    .action(async (options) => {
      const list = await kb.suggestions(ctx.wsName(), options.all ? "all" : "pending");
      ctx.print(list, () => formatSuggestions(list));
    });

  group
    .command("accept")
    .description("Accept a suggestion: AW writes the change")
    .argument("<suggestion>", "the suggestion id, or its first 8 or more characters")
    .option("--force", "accept also when the file changed after the suggestion")
    .option("--comment <text>")
    .action(async (ref, options) => {
      const result = await kb.accept(ctx.wsName(), ref, {
        ...(options.force ? { force: true } : {}),
        ...(options.comment !== undefined ? { comment: options.comment } : {}),
      });
      ctx.print(result, () => `Accepted. ${formatChangeResult({ ...result, suggestion: null })}`);
    });

  group
    .command("reject")
    .description("Reject a suggestion")
    .argument("<suggestion>", "the suggestion id, or its first 8 or more characters")
    .option("--comment <text>")
    .action(async (ref, options) => {
      const result = await kb.reject(
        ctx.wsName(),
        ref,
        options.comment !== undefined ? { comment: options.comment } : {},
      );
      ctx.print(result, () => `Rejected the suggestion ${result.id} for ${result.path}`);
    });

  group
    .command("digest")
    .description("Show the daily digest: what the agents learned")
    .option("--date <YYYY-MM-DD>", "the UTC date (default: today)")
    .action(async (options) => {
      const digest = await kb.digest(ctx.wsName(), options.date);
      ctx.print(digest, () =>
        [
          digest.text,
          ...digest.learned.map((c) => `  ${c.label}: ${c.path} (Undo: aw kb undo ${c.id})`),
          ...digest.changes.map((c) => `  ${c.label}: ${c.path} (Undo: aw kb undo ${c.id})`),
          ...digest.pending.map((s) => `  Waits: ${s.path} by ${s.author} (aw kb accept ${s.id})`),
        ].join("\n"),
      );
    });

  group
    .command("context")
    .description("Show the knowledge context of a session of a task")
    .argument("<task>", "the key or the id")
    .option("--path <file>", "a file that the task changes, for the Files mode (repeat)", collect)
    .option("--load-limit <n>", "the budget of the Read now files, in characters", (value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1000)
        throw ctx.inputError("--load-limit must be 1000 or more");
      return n;
    })
    .action(async (task, options) => {
      const context = await kb.context(ctx.wsName(), {
        task,
        ...(options.path ? { paths: options.path } : {}),
        ...(options.loadLimit ? { load_limit: options.loadLimit } : {}),
      });
      ctx.print(context, () => context.text);
    });

  program
    .command("learn")
    .description(
      'Record the learning step of a task: a learned item in its own new knowledge file, or "Nothing new"',
    )
    .argument("<task>", "the key or the id")
    .option("--file <path>", "the item as Markdown; - reads stdin")
    .option("--title <title>", "a short title: it names the file")
    .option("--shared", "write to the shared knowledge (an agent change waits for approval)")
    .option("--nothing-new", 'record "Nothing new" for the task (decision D3), with no item')
    .option("--author <agent@device>", "the agent of this device that learned it")
    .action(async (task, options) => {
      if (options.nothingNew) {
        if (options.file !== undefined || options.title !== undefined || options.shared) {
          throw ctx.inputError("--nothing-new takes no --file, --title or --shared");
        }
      } else if (options.file === undefined || options.title === undefined) {
        throw ctx.inputError("Give --file and --title for a learned item, or --nothing-new");
      }
      const result = await kb.learn(ctx.wsName(), {
        task,
        ...(options.nothingNew
          ? { nothing_new: true }
          : {
              title: options.title!,
              content: await ctx.readText(options.file!),
              ...(options.shared ? { shared: true } : {}),
            }),
        ...(options.author ? { author: options.author } : {}),
      });
      ctx.print(result, () => formatLearnResult(task, result));
      if (result.task_event && !result.task_event.applied) {
        ctx.notApplied(
          `aw: awd wrote task.learned ${result.task_event.id}, but the merge did not apply it: ${result.task_event.reason ?? "unknown reason"}`,
        );
      }
    });
}
