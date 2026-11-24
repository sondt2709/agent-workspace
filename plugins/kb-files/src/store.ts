// FileKnowledgeStore: the KnowledgeStore on plain files (docs/phase-1.md 5, docs/architecture.md
// 4.8). Each change goes through one path: copy before write, base check, redaction, write, the
// change event (design decision 4). All operations run one at a time.
import {
  createRedactor,
  hlcIso,
  NotRegularFileError,
  readRegularFile,
  refuseLinkedFolders,
  type Clock,
  type Redactor,
  type Secret,
  type WorkspaceFiles,
} from "@aw/core";
import type {
  ChangeKind,
  ChangeResult,
  Digest,
  HistoryEntry,
  KnowledgeChange,
  KnowledgeFile,
  KnowledgeScope,
  KnowledgeStore,
  KnowledgeVersion,
  SearchHit,
  SessionContext,
  Suggestion,
  WriteInput,
} from "@aw/plugin-api";
import { createTwoFilesPatch } from "diff";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { ChangeLog, type ChangedEvent, type ChangeView, type SuggestionState } from "./changes.ts";
import { buildContext, type ContextTask } from "./context.ts";
import { readFrontMatter, renderFile } from "./front-matter.ts";
import { HistoryStore, SeenState, sha256Of } from "./history.ts";
import {
  inScope,
  isLearned,
  isRule,
  parseKnowledgePath,
  slugOf,
  workspacePath,
  type PathParts,
} from "./paths.ts";
import { approvalReasons, isHumanOrAw } from "./rules.ts";
import { searchTexts } from "./search.ts";

/** The wait before an unexplained change on disk counts as a human edit (design decision 5). */
export const SETTLE_MS = 2_000;
/** The largest content of a suggestion: one log line is at most 64 KiB. */
export const MAX_SUGGESTION_BYTES = 48 * 1024;
/** The largest version that the history shows a diff for. */
const MAX_DIFF_BYTES = 256 * 1024;
const MAX_SEARCH_BYTES = 1024 * 1024;

export type KnowledgeErrorCode = "conflict" | "not_found" | "refused" | "invalid" | "ambiguous";

/** An error of the store with a stable code; awd maps it to the local API error envelope. */
export class KnowledgeError extends Error {
  readonly code: KnowledgeErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: KnowledgeErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "KnowledgeError";
    this.code = code;
    this.details = details;
  }
}

export interface FileKnowledgeStoreOptions {
  /** The files layer of the workspace: the only writer of workspace files. */
  files: WorkspaceFiles;
  /** The history folder of this workspace: `<AW_HOME>/history/<workspace id>`. */
  historyDir: string;
  clock: Clock;
  /** The credential values that the store redacts. */
  secrets?: Secret[];
  /** The key of a task id (`AW-7`), for the labels. */
  taskKey?: (task: string) => string | null;
  settleMs?: number;
}

export interface LearnInput {
  project: string;
  task?: string | null;
  title: string;
  content: string;
  author: string;
  /** Write to `shared/learned/` instead of the project. */
  shared?: boolean;
  from_person?: string | null;
}

export interface ReconcileResult {
  /** The changes that this run logged: human edits and deletes. */
  changes: KnowledgeChange[];
  /** The paths with a change that is not explained yet. */
  waiting: string[];
  /** When to run reconcile again for the waiting paths (clock ms), else null. */
  next_check_at: number | null;
}

/** The decision of the sync conflict resolver for one knowledge file. */
export interface ReplaceInput {
  path: string;
  /** The version that the resolver keeps. */
  winner: Uint8Array;
  /** The version that lost; null when the original was gone. */
  loser: Uint8Array | null;
  /** The actor: `aw@<this device>`. */
  by: string;
}

interface DiskFile {
  parts: PathParts;
  abs: string;
  size: number;
  mtimeMs: number;
}

interface ApplyInput {
  parts: PathParts;
  content: string | Uint8Array | null;
  base?: string | null | undefined;
  author: string;
  task: string | null;
  kind: ChangeKind;
  by: string;
  from_person?: string | null | undefined;
  /** Accepted by a human: skip the approval rules. */
  suggestion?: string;
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/** UTF-8 text, or null for bytes that are not valid UTF-8. */
function textOf(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export class FileKnowledgeStore implements KnowledgeStore {
  readonly files: WorkspaceFiles;
  readonly historyStore: HistoryStore;
  readonly #seen: SeenState;
  readonly #log: ChangeLog;
  readonly #clock: Clock;
  readonly #taskKey: (task: string) => string | null;
  readonly #settleMs: number;
  #redactor: Redactor;
  #pending = new Map<string, number>();
  #chain: Promise<unknown> = Promise.resolve();
  #opened = false;

  constructor(options: FileKnowledgeStoreOptions) {
    this.files = options.files;
    this.#clock = options.clock;
    this.historyStore = new HistoryStore(options.historyDir);
    this.#seen = new SeenState(join(options.historyDir, "seen.json"));
    this.#log = new ChangeLog(options.files, options.clock);
    this.#taskKey = options.taskKey ?? (() => null);
    this.#settleMs = options.settleMs ?? SETTLE_MS;
    this.#redactor = createRedactor(options.secrets ?? []);
  }

  get device(): string {
    return this.files.device;
  }

  /** The absolute path of the `knowledge/` folder. */
  get folder(): string {
    return join(this.files.root, "knowledge");
  }

  setSecrets(secrets: Secret[]): void {
    this.#redactor = createRedactor(secrets);
  }

  /** Runs one operation after the last one (design decision 4). */
  #serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(async () => {
      if (!this.#opened) {
        await this.historyStore.init();
        await this.#seen.load();
        this.#opened = true;
      }
      return task();
    });
    this.#chain = run.catch(() => undefined);
    return run;
  }

  // ---- Paths and disk -----------------------------------------------------------------------

  #parts(path: string): PathParts {
    const parts = parseKnowledgePath(path);
    if (!parts) {
      throw new KnowledgeError(
        "refused",
        `${path} is not a knowledge path: use shared/<file> or projects/<project>/<file>`,
        { path },
      );
    }
    return parts;
  }

  #abs(path: string): string {
    return join(this.folder, ...path.split("/"));
  }

  /**
   * The bytes of a knowledge file, or null. A link, or a path through a linked folder, is no
   * knowledge file: the store never reads a file outside the folder (final check fc1-3).
   */
  async #readBytes(path: string): Promise<Buffer | null> {
    try {
      await refuseLinkedFolders(this.folder, path);
      return await readRegularFile(this.#abs(path));
    } catch (error) {
      if (error instanceof NotRegularFileError) return null;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR") return null;
      throw error;
    }
  }

  /** Each knowledge file on disk, by path. */
  async #walk(): Promise<Map<string, DiskFile>> {
    const found = new Map<string, DiskFile>();
    for (const top of ["shared", "projects"]) {
      let entries;
      try {
        entries = await readdir(join(this.folder, top), { withFileTypes: true, recursive: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const abs = join(entry.parentPath, entry.name);
        const path = abs
          .slice(this.folder.length + 1)
          .split(/[\\/]/)
          .join("/");
        const parts = parseKnowledgePath(path);
        if (!parts) continue;
        const info = await stat(abs).catch(() => null);
        if (!info?.isFile()) continue;
        found.set(path, { parts, abs, size: info.size, mtimeMs: info.mtimeMs });
      }
    }
    return new Map([...found].sort(([a], [b]) => (a < b ? -1 : 1)));
  }

  async #remember(path: string, hash: string | null): Promise<void> {
    if (hash === null) {
      this.#seen.delete(path);
      return;
    }
    const info = await stat(this.#abs(path));
    this.#seen.set(path, { hash, size: info.size, mtime_ms: info.mtimeMs });
  }

  // ---- Views of events --------------------------------------------------------------------

  #change(event: ChangedEvent): KnowledgeChange {
    const d = event.data;
    const key = d.task ? this.#taskKey(d.task) : null;
    const on = key ? ` on ${key}` : "";
    const labels: Record<ChangeKind, string> = {
      learned: `Learned by ${d.author}${on}`,
      edit: `Edited by ${d.author}${on}`,
      undo: `Undone by ${d.author}`,
      replaced: `Replaced by the ${d.author.includes("@") ? d.author.slice(d.author.indexOf("@") + 1) : event.dev} version`,
      delete: `Deleted by ${d.author}${on}`,
    };
    const approved =
      d.suggestion && event.by && event.by !== d.author ? ` (approved by ${event.by})` : "";
    return {
      id: event.id,
      hlc: event.hlc,
      at: hlcIso(event.hlc),
      dev: event.dev,
      path: d.path,
      hash: d.hash,
      base: d.base,
      author: d.author,
      by: event.by ?? null,
      task: d.task,
      task_key: key,
      kind: d.kind,
      suggestion: d.suggestion,
      label: `${labels[d.kind]}${approved}`,
    };
  }

  #suggestion(state: SuggestionState): Suggestion {
    const e = state.event;
    const d = e.data;
    return {
      id: d.suggestion,
      hlc: e.hlc,
      at: hlcIso(e.hlc),
      dev: e.dev,
      path: d.path,
      content: d.content,
      hash: d.hash,
      base: d.base,
      author: d.author,
      task: d.task,
      task_key: d.task ? this.#taskKey(d.task) : null,
      kind: d.kind,
      reasons: state.reasons,
      state: state.state,
      resolved_by: state.resolution?.by ?? state.change?.by ?? null,
      comment: state.resolution?.data.comment ?? null,
      change: state.change?.id ?? null,
      late_resolutions: state.late,
    };
  }

  // ---- The change path ----------------------------------------------------------------------

  async #apply(input: ApplyInput): Promise<ChangeResult> {
    const path = input.parts.path;
    const current = await this.#readBytes(path);
    const currentHash = current ? await this.historyStore.put(current) : null;
    if (input.base !== undefined && input.base !== currentHash) {
      throw new KnowledgeError(
        "conflict",
        `${path} changed: its hash is ${currentHash ?? "none (no file)"}, not the base ${input.base ?? "none (no file)"}`,
        { path, current: currentHash, base: input.base },
      );
    }
    const content =
      typeof input.content === "string" ? this.#redactor.redactText(input.content) : input.content;
    const bytes =
      content === null ? null : typeof content === "string" ? Buffer.from(content) : content;
    const hash = bytes === null ? null : sha256Of(bytes);
    if (hash === currentHash) return { change: null, suggestion: null, unchanged: true };

    if (input.suggestion === undefined) {
      const options = { rule: isRule(input.parts), markdown: isMarkdown(path) };
      const text = current ? textOf(current) : null;
      const now = text !== null ? readFrontMatter(text, options).front_matter : null;
      const nextText = typeof content === "string" ? content : content ? textOf(content) : null;
      const next = nextText !== null ? readFrontMatter(nextText, options).front_matter : null;
      const reasons = approvalReasons({
        parts: input.parts,
        author: input.author,
        locked: now?.locked === true,
        always: now?.apply === "always" || next?.apply === "always",
        from_person: input.from_person,
      });
      if (reasons.length > 0) {
        return this.#suggest(input, content, hash, currentHash, reasons);
      }
    }

    if (bytes === null) {
      await this.files.removeKnowledgeFile(workspacePath(path));
    } else {
      await this.historyStore.put(bytes);
      await this.files.writeFile(workspacePath(path), bytes);
    }
    await this.#remember(path, hash);
    const event = await this.files.writeEvent(
      `knowledge/log/${this.device}.jsonl`,
      "knowledge.changed",
      {
        path,
        hash,
        base: currentHash,
        author: input.author,
        task: input.task,
        kind: input.kind,
        suggestion: input.suggestion ?? null,
      },
      { by: input.by },
    );
    await this.#seen.save();
    return { change: this.#change(event as ChangedEvent), suggestion: null, unchanged: false };
  }

  async #suggest(
    input: ApplyInput,
    content: string | Uint8Array | null,
    hash: string | null,
    base: string | null,
    reasons: Suggestion["reasons"],
  ): Promise<ChangeResult> {
    if (input.kind === "replaced") {
      throw new KnowledgeError(
        "invalid",
        "A replaced change comes from the resolver, not an agent",
      );
    }
    let text: string | null = null;
    if (content !== null) {
      text = typeof content === "string" ? content : textOf(content);
      if (text === null) {
        throw new KnowledgeError("invalid", "A suggestion must be UTF-8 text", {
          path: input.parts.path,
        });
      }
      const size = Buffer.byteLength(text);
      if (size > MAX_SUGGESTION_BYTES) {
        throw new KnowledgeError(
          "invalid",
          `The change waits for approval, but a suggestion is at most ${MAX_SUGGESTION_BYTES} bytes, not ${size}`,
          { path: input.parts.path, size },
        );
      }
    }
    const id = this.files.newId();
    await this.files.writeEvent(
      `knowledge/log/${this.device}.jsonl`,
      "knowledge.suggested",
      {
        suggestion: id,
        path: input.parts.path,
        content: text,
        hash,
        base,
        author: input.author,
        task: input.task,
        kind: input.kind,
        reasons,
      },
      { by: input.by },
    );
    const view = await this.#log.read();
    const state = view.suggestion(id);
    if (!state || state === "ambiguous") throw new Error(`The suggestion ${id} was not read back`);
    return { change: null, suggestion: this.#suggestion(state), unchanged: false };
  }

  // ---- KnowledgeStore -----------------------------------------------------------------------

  list(scope: KnowledgeScope = { kind: "all" }): Promise<KnowledgeFile[]> {
    return this.#serial(() => this.#list(scope));
  }

  async #list(scope: KnowledgeScope): Promise<KnowledgeFile[]> {
    const view = await this.#log.read();
    const result: KnowledgeFile[] = [];
    for (const [path, file] of await this.#walk()) {
      if (!inScope(file.parts, scope)) continue;
      const bytes = await this.#readBytes(path);
      if (!bytes) continue;
      const text = textOf(bytes);
      const rule = isRule(file.parts);
      const parsed = readFrontMatter(text ?? "", { rule, markdown: isMarkdown(path) });
      const last = view.latest(path);
      result.push({
        path,
        scope: file.parts.scope,
        project: file.parts.project,
        size: bytes.length,
        hash: sha256Of(bytes),
        rule,
        learned: isLearned(file.parts),
        title: parsed.title,
        front_matter: parsed.front_matter,
        front_matter_error: parsed.error,
        last_change: last
          ? {
              id: last.id,
              hlc: last.hlc,
              dev: last.dev,
              kind: last.data.kind,
              author: last.data.author,
            }
          : null,
      });
    }
    return result;
  }

  read(path: string, version?: string): Promise<KnowledgeVersion> {
    return this.#serial(async () => {
      const parts = this.#parts(path);
      let bytes: Buffer | null;
      if (version === undefined) {
        bytes = await this.#readBytes(path);
        if (!bytes) throw new KnowledgeError("not_found", `${path} does not exist`, { path });
      } else {
        bytes = await this.historyStore.get(version);
        if (!bytes) {
          throw new KnowledgeError(
            "not_found",
            `The version ${version} is not in the history store of this device`,
            { path, version },
          );
        }
      }
      const content = textOf(bytes) ?? bytes.toString("base64");
      const parsed = readFrontMatter(content, { rule: isRule(parts), markdown: isMarkdown(path) });
      return {
        path,
        hash: sha256Of(bytes),
        content,
        front_matter: parsed.front_matter,
        front_matter_error: parsed.error,
        current: version === undefined,
      };
    });
  }

  write(input: WriteInput): Promise<ChangeResult> {
    return this.#serial(() =>
      this.#apply({
        parts: this.#parts(input.path),
        content: input.content,
        base: input.base,
        author: input.author,
        task: input.task ?? null,
        kind: input.kind,
        by: input.by ?? input.author,
        from_person: input.from_person,
      }),
    );
  }

  history(path: string): Promise<HistoryEntry[]> {
    return this.#serial(async () => {
      this.#parts(path);
      const view = await this.#log.read();
      const entries: HistoryEntry[] = [];
      for (const event of view.changes.filter((e) => e.data.path === path)) {
        const change = this.#change(event);
        const after = change.hash ? await this.historyStore.get(change.hash) : null;
        const before = change.base ? await this.historyStore.get(change.base) : null;
        const available = change.hash === null || after !== null;
        const baseAvailable = change.base === null || before !== null;
        entries.push({
          ...change,
          available,
          base_available: baseAvailable,
          diff: available && baseAvailable ? this.#diff(path, change, before, after) : null,
        });
      }
      return entries;
    });
  }

  #diff(
    path: string,
    change: KnowledgeChange,
    before: Buffer | null,
    after: Buffer | null,
  ): string | null {
    if ((before?.length ?? 0) > MAX_DIFF_BYTES || (after?.length ?? 0) > MAX_DIFF_BYTES)
      return null;
    const oldText = before ? textOf(before) : "";
    const newText = after ? textOf(after) : "";
    if (oldText === null || newText === null) return null;
    return createTwoFilesPatch(
      path,
      path,
      oldText,
      newText,
      change.base?.slice(0, 12) ?? "none",
      change.hash?.slice(0, 12) ?? "none",
    );
  }

  undo(change: string, by: string): Promise<ChangeResult> {
    return this.#serial(async () => {
      const view = await this.#log.read();
      const found = view.find(change);
      if (found === "ambiguous") {
        throw new KnowledgeError("ambiguous", `More than one event id starts with ${change}`);
      }
      if (!found || found.type !== "knowledge.changed") {
        throw new KnowledgeError("not_found", `No knowledge change ${change}`, { change });
      }
      const target = found.data.base;
      let content: Buffer | null = null;
      if (target !== null) {
        content = await this.historyStore.get(target);
        if (!content) {
          throw new KnowledgeError(
            "not_found",
            `The version ${target} is not in the history store of this device`,
            { change: found.id, version: target },
          );
        }
      }
      return this.#apply({
        parts: this.#parts(found.data.path),
        content,
        author: by,
        task: null,
        kind: "undo",
        by,
      });
    });
  }

  search(
    q: string,
    options: { scope?: KnowledgeScope; limit?: number } = {},
  ): Promise<SearchHit[]> {
    return this.#serial(async () => {
      const texts: { path: string; text: string }[] = [];
      for (const [path, file] of await this.#walk()) {
        if (!inScope(file.parts, options.scope ?? { kind: "all" })) continue;
        if (file.size > MAX_SEARCH_BYTES) continue;
        const bytes = await this.#readBytes(path);
        const text = bytes ? textOf(bytes) : null;
        if (text !== null) texts.push({ path, text });
      }
      return searchTexts(texts, q, options.limit ?? 20);
    });
  }

  // ---- Learned entries, suggestions, digest, context ----------------------------------------

  learn(input: LearnInput): Promise<ChangeResult> {
    return this.#serial(async () => {
      if (input.title.trim() === "") throw new KnowledgeError("invalid", "Give a title");
      const day = new Date(this.#clock.now()).toISOString().slice(0, 10);
      const folder = input.shared ? "shared/learned" : `projects/${input.project}/learned`;
      const stem = `${folder}/${day}-${slugOf(input.title)}`;
      let path = `${stem}.md`;
      for (let n = 2; (await this.#readBytes(path)) !== null; n += 1) path = `${stem}-${n}.md`;
      const parts = this.#parts(path);
      const parsed = readFrontMatter(input.content, { rule: false, markdown: true });
      const key = input.task ? this.#taskKey(input.task) : null;
      const data: Record<string, unknown> = {
        apply: parsed.data.apply ?? "auto",
        description: parsed.data.description ?? input.title.trim(),
        ...parsed.data,
        locked: parsed.data.locked ?? false,
        source: key ? `${input.author} on ${key}` : input.author,
        author: input.author,
        task: input.task ?? null,
        learned_at: new Date(this.#clock.now()).toISOString(),
      };
      const body = /^#[ \t]+\S/m.test(parsed.body)
        ? parsed.body
        : `# ${input.title.trim()}\n\n${parsed.body}`;
      return this.#apply({
        parts,
        content: renderFile(data, body.endsWith("\n") ? body : `${body}\n`),
        base: null,
        author: input.author,
        task: input.task ?? null,
        kind: "learned",
        by: input.author,
        from_person: input.from_person,
      });
    });
  }

  suggestions(state: "pending" | "all" = "pending"): Promise<Suggestion[]> {
    return this.#serial(async () => {
      const view = await this.#log.read();
      return view.suggestions
        .filter((s) => state === "all" || s.state === "pending")
        .map((s) => this.#suggestion(s));
    });
  }

  #pendingSuggestion(view: ChangeView, ref: string): SuggestionState {
    const state = view.suggestion(ref);
    if (state === "ambiguous") {
      throw new KnowledgeError("ambiguous", `More than one suggestion id starts with ${ref}`);
    }
    if (!state) throw new KnowledgeError("not_found", `No suggestion ${ref}`, { suggestion: ref });
    if (state.state !== "pending") {
      throw new KnowledgeError(
        "conflict",
        `The suggestion ${state.event.data.suggestion} is ${state.state}`,
        { suggestion: state.event.data.suggestion, state: state.state },
      );
    }
    return state;
  }

  accept(
    ref: string,
    options: { by: string; force?: boolean; comment?: string | null },
  ): Promise<ChangeResult> {
    return this.#serial(async () => {
      if (!options.by.startsWith("human@")) {
        throw new KnowledgeError("refused", "Only a human accepts a knowledge change");
      }
      const state = this.#pendingSuggestion(await this.#log.read(), ref);
      const d = state.event.data;
      const current = await this.#readBytes(d.path);
      const currentHash = current ? sha256Of(current) : null;
      if (currentHash !== d.base && !options.force) {
        throw new KnowledgeError(
          "conflict",
          `${d.path} changed after the suggestion: accept it with force to replace the new version`,
          { path: d.path, current: currentHash, base: d.base, suggestion: d.suggestion },
        );
      }
      const result = await this.#apply({
        parts: this.#parts(d.path),
        content: d.content,
        author: d.author,
        task: d.task,
        kind: d.kind,
        by: options.by,
        suggestion: d.suggestion,
      });
      await this.files.writeEvent(
        `knowledge/log/${this.device}.jsonl`,
        "knowledge.suggestion_resolved",
        { suggestion: d.suggestion, decision: "accepted", comment: options.comment ?? null },
        { by: options.by },
      );
      const view = await this.#log.read();
      const after = view.suggestion(d.suggestion) as SuggestionState;
      return { ...result, suggestion: this.#suggestion(after) };
    });
  }

  reject(ref: string, options: { by: string; comment?: string | null }): Promise<Suggestion> {
    return this.#serial(async () => {
      if (!options.by.startsWith("human@")) {
        throw new KnowledgeError("refused", "Only a human rejects a knowledge change");
      }
      const state = this.#pendingSuggestion(await this.#log.read(), ref);
      const id = state.event.data.suggestion;
      await this.files.writeEvent(
        `knowledge/log/${this.device}.jsonl`,
        "knowledge.suggestion_resolved",
        { suggestion: id, decision: "rejected", comment: options.comment ?? null },
        { by: options.by },
      );
      const view = await this.#log.read();
      return this.#suggestion(view.suggestion(id) as SuggestionState);
    });
  }

  digest(date?: string): Promise<Digest> {
    return this.#serial(async () => {
      const day = date ?? new Date(this.#clock.now()).toISOString().slice(0, 10);
      const view = await this.#log.read();
      const agent = view.changes
        .filter((e) => !isHumanOrAw(e.data.author) && hlcIso(e.hlc).slice(0, 10) === day)
        .map((e) => this.#change(e));
      const learned = agent.filter((c) => c.kind === "learned");
      const changes = agent.filter((c) => c.kind !== "learned");
      const pending = view.suggestions
        .filter((s) => s.state === "pending")
        .map((s) => this.#suggestion(s));
      const parts: string[] = [];
      if (learned.length > 0)
        parts.push(`Agents learned ${plural(learned.length, "thing", "things")}.`);
      if (changes.length > 0)
        parts.push(`Agents changed ${plural(changes.length, "file", "files")}.`);
      if (pending.length > 0) {
        parts.push(
          pending.length === 1
            ? "1 change waits for approval."
            : `${pending.length} changes wait for approval.`,
        );
      }
      const text = parts.length > 0 ? parts.join(" ") : "Agents learned nothing new.";
      return { date: day, learned, changes, pending, text };
    });
  }

  context(
    task: ContextTask,
    options: { load_limit?: number; text_limit?: number } = {},
  ): Promise<SessionContext> {
    return this.#serial(async () => {
      const files = (await this.#list({ kind: "all" })).filter(
        (f) => f.scope === "shared" || f.project === task.project,
      );
      return buildContext({ files, task, folder: this.folder, ...options });
    });
  }

  // ---- Direct edits and sync changes --------------------------------------------------------

  /**
   * Records the decision of the sync conflict resolver (docs/architecture.md 4.3.2): the file
   * gets the winning version, and the log gets a `replaced` change from the losing version to
   * it. Both versions go to the history store, so Undo gives the losing version back. The author
   * is the author of the newest change to the winning version, else `by`.
   */
  replace(input: ReplaceInput): Promise<ChangeResult> {
    return this.#serial(async () => {
      const parts = this.#parts(input.path);
      const path = parts.path;
      const hash = await this.historyStore.put(input.winner);
      const base = input.loser === null ? null : await this.historyStore.put(input.loser);
      if (hash === base) return { change: null, suggestion: null, unchanged: true };
      const current = await this.#readBytes(path);
      if (current === null || sha256Of(current) !== hash) {
        await this.files.writeFile(workspacePath(path), input.winner);
      }
      const view = await this.#log.read();
      const source = [...view.changes]
        .reverse()
        .find((e) => e.data.path === path && e.data.hash === hash);
      await this.#remember(path, hash);
      const event = await this.files.writeEvent(
        `knowledge/log/${this.device}.jsonl`,
        "knowledge.changed",
        {
          path,
          hash,
          base,
          author: source?.data.author ?? input.by,
          task: source?.data.task ?? null,
          kind: "replaced",
          suggestion: null,
        },
        { by: input.by },
      );
      this.#pending.delete(path);
      await this.#seen.save();
      return { change: this.#change(event as ChangedEvent), suggestion: null, unchanged: false };
    });
  }

  /** Finds the direct edits and deletes on disk, and stores the versions from sync (decision 5). */
  reconcile(): Promise<ReconcileResult> {
    return this.#serial(() => this.#reconcile());
  }

  #waitOver(path: string, now: number): boolean {
    const first = this.#pending.get(path);
    if (first === undefined) {
      this.#pending.set(path, now);
      return this.#settleMs <= 0;
    }
    return now - first >= this.#settleMs;
  }

  async #reconcile(): Promise<ReconcileResult> {
    const now = this.#clock.now();
    const view = await this.#log.read();
    const disk = await this.#walk();
    const logged: KnowledgeChange[] = [];
    const waiting: string[] = [];
    let dirty = false;
    const human = `human@${this.device}`;

    for (const [path, file] of disk) {
      const seen = this.#seen.get(path);
      if (seen && seen.size === file.size && seen.mtime_ms === file.mtimeMs) {
        this.#pending.delete(path);
        continue;
      }
      const bytes = await this.#readBytes(path);
      if (!bytes) continue;
      const hash = sha256Of(bytes);
      const explained =
        seen?.hash === hash ||
        view.latest(path)?.data.hash === hash ||
        view.hasTransition(path, seen?.hash ?? null, hash, this.device);
      if (explained) {
        await this.historyStore.put(bytes);
        this.#seen.set(path, { hash, size: file.size, mtime_ms: file.mtimeMs });
        this.#pending.delete(path);
        dirty = true;
        continue;
      }
      if (!this.#waitOver(path, now)) {
        waiting.push(path);
        continue;
      }
      this.#pending.delete(path);
      // A credential value in a direct edit: write the redacted text back, and keep and log only
      // the redacted version (design decision 12).
      let final: Uint8Array = bytes;
      const text = textOf(bytes);
      if (text !== null) {
        const redacted = this.#redactor.redactText(text);
        if (redacted !== text) {
          final = Buffer.from(redacted);
          await this.files.writeFile(workspacePath(path), final);
        }
      }
      const finalHash = await this.historyStore.put(final);
      await this.#remember(path, finalHash);
      const event = await this.files.writeEvent(
        `knowledge/log/${this.device}.jsonl`,
        "knowledge.changed",
        {
          path,
          hash: finalHash,
          base: seen?.hash ?? null,
          author: human,
          task: null,
          kind: "edit",
          suggestion: null,
        },
        { by: human },
      );
      logged.push(this.#change(event as ChangedEvent));
      dirty = true;
    }

    for (const path of this.#seen.paths()) {
      if (disk.has(path)) continue;
      const seen = this.#seen.get(path)!;
      const latest = view.latest(path);
      if (latest && latest.data.hash === null) {
        this.#seen.delete(path);
        this.#pending.delete(path);
        dirty = true;
        continue;
      }
      if (!this.#waitOver(path, now)) {
        waiting.push(path);
        continue;
      }
      this.#pending.delete(path);
      this.#seen.delete(path);
      const event = await this.files.writeEvent(
        `knowledge/log/${this.device}.jsonl`,
        "knowledge.changed",
        {
          path,
          hash: null,
          base: seen.hash,
          author: human,
          task: null,
          kind: "delete",
          suggestion: null,
        },
        { by: human },
      );
      logged.push(this.#change(event as ChangedEvent));
      dirty = true;
    }

    // A path that is gone from disk and from seen does not wait any more.
    for (const path of [...this.#pending.keys()]) {
      if (!disk.has(path) && this.#seen.get(path) === undefined) this.#pending.delete(path);
    }
    if (dirty) await this.#seen.save();
    const firsts = waiting.map((p) => this.#pending.get(p)!);
    return {
      changes: logged,
      waiting,
      next_check_at: firsts.length > 0 ? Math.min(...firsts) + this.#settleMs : null,
    };
  }
}
