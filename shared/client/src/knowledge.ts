// The knowledge routes of the local API: their zod schemas (awd checks each request with them and
// generates contracts/openapi.yaml from them) and KnowledgeClient on AwClient.request. Reply
// objects are loose, like the other replies of schemas.ts.
import type {
  ChangeResult,
  Digest,
  HistoryEntry,
  KnowledgeFile,
  KnowledgeVersion,
  SearchHit,
  SessionContext,
  Suggestion,
} from "@aw/plugin-api";
import { agentRef } from "@aw/schema";
import { z } from "zod";
import type { AwClient } from "./index.ts";

const selector = z.string().min(1).max(128);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const knowledgePath = z
  .string()
  .min(1)
  .max(1024)
  .describe("A path relative to the knowledge folder: shared/… or projects/<project>/…");

// ---- Inputs -------------------------------------------------------------------------------

export const kbWsParams = z.object({
  ws: selector.describe("The workspace id or name. `-` selects the only workspace."),
});
export const kbChangeParams = kbWsParams.extend({
  change: selector.describe("The change event id or an id prefix of 8+ characters"),
});
export const kbSuggestionParams = kbWsParams.extend({
  suggestion: selector.describe("The suggestion id or an id prefix of 8+ characters"),
});
/**
 * The caller header of the knowledge writes. With the token of a running session, awd acts as the
 * agent of that session: it refuses accept, reject and a write to shared knowledge or a rule (403).
 */
export const kbCallerHeaders = z.looseObject({
  authorization: z
    .string()
    // The same form as bearerToken() of awd: any case, any white space.
    .regex(/^Bearer\s+\S+\s*$/i)
    .optional()
    .describe(
      "Bearer <session token> (AW_MCP_TOKEN). Without it, the caller is the person, unless awd finds that the calling process belongs to a running session.",
    ),
});
export const kbListQuery = z.object({
  scope: z.enum(["all", "shared", "project"]).optional(),
  project: z.string().min(1).max(63).optional().describe("The project of the scope `project`"),
});
export const kbFileQuery = z.object({
  path: knowledgePath,
  version: hash.optional().describe("The sha256 of a version in the history store"),
});
export const kbWriteBody = z.object({
  path: knowledgePath,
  content: z.string().max(4 * 1024 * 1024),
  base: hash
    .nullable()
    .optional()
    .describe("The hash that the file must have now; null: the file must not exist"),
});
export const kbHistoryQuery = z.object({ path: knowledgePath });
export const kbSearchQuery = kbListQuery.extend({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export const kbLearnBody = z.object({
  task: selector.describe("The task (key or id): its project gets the file"),
  title: z.string().min(1).max(200).optional().describe("Required with no nothing_new"),
  content: z
    .string()
    .max(4 * 1024 * 1024)
    .optional()
    .describe("Required with no nothing_new"),
  nothing_new: z
    .boolean()
    .optional()
    .describe('true: record "Nothing new" (decision D3) with no title, content or shared'),
  shared: z.boolean().optional().describe("Write to shared/learned/ (waits for approval)"),
  author: agentRef
    .optional()
    .describe("The agent, `<agent>@<this device>`. Default: human@<this device>"),
  from_person: z.string().min(1).max(127).optional(),
});
export const kbSuggestionQuery = z.object({ state: z.enum(["pending", "all"]).optional() });
export const kbAcceptBody = z.object({
  force: z.boolean().optional().describe("Accept also when the file changed after the suggestion"),
  comment: z.string().max(10_000).optional(),
});
export const kbRejectBody = z.object({ comment: z.string().max(10_000).optional() });
export const kbDigestQuery = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export const kbContextBody = z.object({
  task: selector,
  paths: z.array(z.string().min(1).max(1024)).max(1000).optional(),
  load_limit: z.int().min(1000).max(1_000_000).optional(),
});

// ---- Replies ------------------------------------------------------------------------------

const frontMatterView = z.looseObject({
  apply: z.enum(["always", "auto", "files", "manual"]),
  description: z.string().nullable(),
  globs: z.array(z.string()),
  locked: z.boolean(),
  source: z.string().nullable(),
  author: z.string().nullable(),
  task: z.string().nullable(),
  learned_at: z.string().nullable(),
  validated_at: z.string().nullable(),
});

const changeKind = z.enum(["learned", "edit", "undo", "replaced", "delete"]);

export const knowledgeFileView = z
  .looseObject({
    path: z.string(),
    scope: z.enum(["shared", "project"]),
    project: z.string().nullable(),
    size: z.int(),
    hash,
    rule: z.boolean(),
    learned: z.boolean(),
    title: z.string().nullable(),
    front_matter: frontMatterView,
    front_matter_error: z.string().nullable(),
    last_change: z
      .looseObject({
        id: z.string(),
        hlc: z.string(),
        dev: z.string(),
        kind: changeKind,
        author: z.string(),
      })
      .nullable(),
  })
  .meta({ id: "KnowledgeFile" });

export const knowledgeVersionView = z
  .looseObject({
    path: z.string(),
    hash,
    content: z.string(),
    front_matter: frontMatterView,
    front_matter_error: z.string().nullable(),
    current: z.boolean(),
  })
  .meta({ id: "KnowledgeVersion" });

export const knowledgeChangeView = z
  .looseObject({
    id: z.string(),
    hlc: z.string(),
    at: z.string(),
    dev: z.string(),
    path: z.string(),
    hash: hash.nullable(),
    base: hash.nullable(),
    author: z.string(),
    by: z.string().nullable(),
    task: z.string().nullable(),
    task_key: z.string().nullable(),
    kind: changeKind,
    suggestion: z.string().nullable(),
    label: z.string(),
  })
  .meta({ id: "KnowledgeChange" });

export const historyEntryView = knowledgeChangeView
  .extend({
    available: z.boolean(),
    base_available: z.boolean(),
    diff: z.string().nullable(),
  })
  .meta({ id: "KnowledgeHistoryEntry" });

export const suggestionView = z
  .looseObject({
    id: z.string(),
    hlc: z.string(),
    at: z.string(),
    dev: z.string(),
    path: z.string(),
    content: z.string().nullable(),
    hash: hash.nullable(),
    base: hash.nullable(),
    author: z.string(),
    task: z.string().nullable(),
    task_key: z.string().nullable(),
    kind: z.enum(["learned", "edit", "undo", "delete"]),
    reasons: z.array(z.enum(["rule", "locked", "shared", "other_person"])),
    state: z.enum(["pending", "accepted", "rejected"]),
    resolved_by: z.string().nullable(),
    comment: z.string().nullable(),
    change: z.string().nullable(),
    late_resolutions: z.int(),
  })
  .meta({ id: "KnowledgeSuggestion" });

export const changeResultView = z
  .looseObject({
    change: knowledgeChangeView.nullable(),
    suggestion: suggestionView.nullable(),
    unchanged: z.boolean(),
  })
  .meta({ id: "KnowledgeChangeResult" });

/** The reply of a learning step: the knowledge result and the `task.learned` event (agent-learning). */
export const learnResultView = changeResultView
  .extend({
    task_event: z
      .looseObject({ id: z.string(), applied: z.boolean(), reason: z.string().nullable() })
      .nullable(),
  })
  .meta({ id: "KnowledgeLearnResult" });

export interface LearnResult extends ChangeResult {
  /** The `task.learned` event of the step, or null when nothing was written to the task log. */
  task_event: { id: string; applied: boolean; reason: string | null } | null;
}

export const searchHitView = z
  .looseObject({ path: z.string(), score: z.int(), line: z.int(), snippet: z.string() })
  .meta({ id: "KnowledgeSearchHit" });

export const digestView = z
  .looseObject({
    date: z.string(),
    learned: z.array(knowledgeChangeView),
    changes: z.array(knowledgeChangeView),
    pending: z.array(suggestionView),
    text: z.string(),
  })
  .meta({ id: "KnowledgeDigest" });

export const contextView = z
  .looseObject({
    text: z.string(),
    files: z.array(
      z.looseObject({
        path: z.string(),
        mode: z.enum(["always", "auto", "files", "manual"]),
        size: z.int(),
        section: z.enum(["read_now", "relevant", "matching", "dropped", "not_listed"]),
        reason: z.string(),
      }),
    ),
    warnings: z.array(
      z.looseObject({
        code: z.enum(["over_budget", "text_limit", "front_matter"]),
        path: z.string().nullable(),
        message: z.string(),
      }),
    ),
    budget: z.looseObject({
      load_limit: z.int(),
      load_used: z.int(),
      text_limit: z.int(),
      text_length: z.int(),
    }),
  })
  .meta({ id: "KnowledgeContext" });

// ---- Client -------------------------------------------------------------------------------

export type KbListQuery = z.input<typeof kbListQuery>;
export type KbSearchQuery = Omit<z.input<typeof kbSearchQuery>, "limit"> & { limit?: number };
export type KbLearnInput = z.input<typeof kbLearnBody>;
export type KbWriteInput = z.input<typeof kbWriteBody>;
export type KbContextInput = z.input<typeof kbContextBody>;

const encode = encodeURIComponent;

/** The knowledge routes, on the request method of an AwClient. */
export class KnowledgeClient {
  readonly #client: AwClient;

  constructor(client: AwClient) {
    this.#client = client;
  }

  #base(ws: string): string {
    return `/v1/workspaces/${encode(ws)}/knowledge`;
  }

  list = (ws: string, query: KbListQuery = {}) =>
    this.#client.request<KnowledgeFile[]>("GET", this.#base(ws), z.array(knowledgeFileView), {
      query,
    });
  read = (ws: string, path: string, version?: string) =>
    this.#client.request<KnowledgeVersion>("GET", `${this.#base(ws)}/file`, knowledgeVersionView, {
      query: { path, version },
    });
  write = (ws: string, body: KbWriteInput) =>
    this.#client.request<ChangeResult>("PUT", `${this.#base(ws)}/file`, changeResultView, { body });
  history = (ws: string, path: string) =>
    this.#client.request<HistoryEntry[]>(
      "GET",
      `${this.#base(ws)}/history`,
      z.array(historyEntryView),
      { query: { path } },
    );
  undo = (ws: string, change: string) =>
    this.#client.request<ChangeResult>(
      "POST",
      `${this.#base(ws)}/changes/${encode(change)}/undo`,
      changeResultView,
    );
  search = (ws: string, query: KbSearchQuery) =>
    this.#client.request<SearchHit[]>("GET", `${this.#base(ws)}/search`, z.array(searchHitView), {
      query,
    });
  learn = (ws: string, body: KbLearnInput) =>
    this.#client.request<LearnResult>("POST", `${this.#base(ws)}/learn`, learnResultView, {
      body,
    });
  suggestions = (ws: string, state?: "pending" | "all") =>
    this.#client.request<Suggestion[]>(
      "GET",
      `${this.#base(ws)}/suggestions`,
      z.array(suggestionView),
      { query: { state } },
    );
  accept = (ws: string, suggestion: string, body: z.input<typeof kbAcceptBody> = {}) =>
    this.#client.request<ChangeResult>(
      "POST",
      `${this.#base(ws)}/suggestions/${encode(suggestion)}/accept`,
      changeResultView,
      { body },
    );
  reject = (ws: string, suggestion: string, body: z.input<typeof kbRejectBody> = {}) =>
    this.#client.request<Suggestion>(
      "POST",
      `${this.#base(ws)}/suggestions/${encode(suggestion)}/reject`,
      suggestionView,
      { body },
    );
  digest = (ws: string, date?: string) =>
    this.#client.request<Digest>("GET", `${this.#base(ws)}/digest`, digestView, {
      query: { date },
    });
  context = (ws: string, body: KbContextInput) =>
    this.#client.request<SessionContext>("POST", `${this.#base(ws)}/context`, contextView, {
      body,
    });
}
