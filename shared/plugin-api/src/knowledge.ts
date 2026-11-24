// The KnowledgeStore interface (docs/architecture.md 4.8 and 6.2). Files is the phase 1 store
// (`@aw/kb-files`); vector and graph stores (P3) index the same files. All names are snake_case,
// like the files and the local API.

/** A knowledge path relative to the `knowledge/` folder: `shared/…` or `projects/<project>/…`. */
export type KnowledgePath = string;

/** The files that an operation reads: all, the shared knowledge, or one project. */
export type KnowledgeScope =
  { kind: "all" } | { kind: "shared" } | { kind: "project"; project: string };

/** The apply mode of a knowledge file (prd KB-03). */
export type ApplyMode = "always" | "auto" | "files" | "manual";

/** The kind of a change (`knowledge.changed`). */
export type ChangeKind = "learned" | "edit" | "undo" | "replaced" | "delete";

/** Why an agent change waits for "Approve knowledge change" (docs/architecture.md 4.8.3). */
export type ApprovalReason = "rule" | "locked" | "shared" | "other_person";

/** The front matter fields that AW reads. Unknown fields stay in the file. */
export interface FrontMatter {
  apply: ApplyMode;
  description: string | null;
  globs: string[];
  locked: boolean;
  source: string | null;
  author: string | null;
  task: string | null;
  learned_at: string | null;
  validated_at: string | null;
}

/** A reference to a change event. */
export interface ChangeRef {
  id: string;
  hlc: string;
  dev: string;
  kind: ChangeKind;
  author: string;
}

export interface KnowledgeFile {
  path: KnowledgePath;
  scope: "shared" | "project";
  project: string | null;
  size: number;
  hash: string;
  /** True for a file in `rules/` of its scope. */
  rule: boolean;
  /** True for a file in `learned/` of its scope. */
  learned: boolean;
  /** The first `# ` heading of the body, else null. */
  title: string | null;
  front_matter: FrontMatter;
  /** The reason why the front matter was not used, else null. */
  front_matter_error: string | null;
  last_change: ChangeRef | null;
}

export interface KnowledgeVersion {
  path: KnowledgePath;
  hash: string;
  content: string;
  front_matter: FrontMatter;
  front_matter_error: string | null;
  /** True when the content is the file on disk, false for a version from the history store. */
  current: boolean;
}

/** A `knowledge.changed` event, as the store shows it. */
export interface KnowledgeChange {
  id: string;
  hlc: string;
  /** The ISO time of the HLC. */
  at: string;
  dev: string;
  path: KnowledgePath;
  hash: string | null;
  base: string | null;
  author: string;
  /** The actor that wrote the event (for an accepted suggestion: the human). */
  by: string | null;
  task: string | null;
  task_key: string | null;
  kind: ChangeKind;
  suggestion: string | null;
  /** For example "Learned by claude@ubuntu-01 on AW-7". */
  label: string;
}

export interface HistoryEntry extends KnowledgeChange {
  /** True when the version of `hash` is in the history store of this device. */
  available: boolean;
  /** True when the version of `base` is in the history store (Undo is possible). */
  base_available: boolean;
  /** A unified diff from the base to this version, when both are text and in the store. */
  diff: string | null;
}

export interface WriteInput {
  path: KnowledgePath;
  /** The new content. `null` removes the file. */
  content: string | null;
  /** The hash that the file must have now: `null` = the file must not exist. Omit to skip the check. */
  base?: string | null;
  author: string;
  task?: string | null;
  kind: ChangeKind;
  /** The actor of the event. Default: the author. */
  by?: string;
  /** The person whose message brought this knowledge (P2 signals). */
  from_person?: string | null;
}

export interface Suggestion {
  id: string;
  hlc: string;
  at: string;
  dev: string;
  path: KnowledgePath;
  content: string | null;
  hash: string | null;
  base: string | null;
  author: string;
  task: string | null;
  task_key: string | null;
  kind: Exclude<ChangeKind, "replaced">;
  reasons: ApprovalReason[];
  state: "pending" | "accepted" | "rejected";
  resolved_by: string | null;
  comment: string | null;
  /** The change that applied it, when it is accepted. */
  change: string | null;
  /** Resolutions that came after the first one in merge order: they do not count. */
  late_resolutions: number;
}

/** The result of a write, a learn, an undo or an accept. */
export interface ChangeResult {
  change: KnowledgeChange | null;
  suggestion: Suggestion | null;
  /** True when the content was already the same: nothing was written. */
  unchanged: boolean;
}

export interface SearchHit {
  path: KnowledgePath;
  score: number;
  line: number;
  snippet: string;
}

export interface Digest {
  date: string;
  learned: KnowledgeChange[];
  changes: KnowledgeChange[];
  pending: Suggestion[];
  text: string;
}

export type ContextSection = "read_now" | "relevant" | "matching" | "dropped" | "not_listed";

export interface ContextFile {
  path: KnowledgePath;
  mode: ApplyMode;
  size: number;
  section: ContextSection;
  /** Why the file is in its section, for example "rule", "always", "named in the task". */
  reason: string;
}

export interface ContextWarning {
  code: "over_budget" | "text_limit" | "front_matter";
  path: KnowledgePath | null;
  message: string;
}

export interface SessionContext {
  text: string;
  files: ContextFile[];
  warnings: ContextWarning[];
  budget: { load_limit: number; load_used: number; text_limit: number; text_length: number };
}

export interface KnowledgeStore {
  list(scope?: KnowledgeScope): Promise<KnowledgeFile[]>;
  read(path: KnowledgePath, version?: string): Promise<KnowledgeVersion>;
  write(input: WriteInput): Promise<ChangeResult>;
  history(path: KnowledgePath): Promise<HistoryEntry[]>;
  undo(change: string, by: string): Promise<ChangeResult>;
  search(q: string, options?: { scope?: KnowledgeScope; limit?: number }): Promise<SearchHit[]>;
}
