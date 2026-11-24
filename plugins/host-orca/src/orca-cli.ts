// The adapter of the Orca CLI (AGENTS.md: one adapter module per external client). Each call is
// exec-form (`execa`, no shell) with `--json`, and the reply is the JSON envelope
// `{id, ok, result | error, _meta}` of `orca-ide` 1.4.257 (fixtures/orca-1.4.257/). Each reply goes
// through a declared zod schema (engineering-rules 5.2): a changed Orca reply gives one clear
// `bad_reply` error at the parse, not an error at a random place later.
import { execa } from "execa";
import { z } from "zod";

/** The error of an Orca CLI call, with the code of the reply. */
export class OrcaError extends Error {
  /** The `error.code` of the reply, for example `runtime_unavailable`, or `cli_failed`. */
  readonly code: string;
  /** `error.data.orchestrationRequestId`: the id to send the same request again. */
  readonly requestId: string | null;

  constructor(code: string, message: string, requestId: string | null = null) {
    super(message);
    this.name = "OrcaError";
    this.code = code;
    this.requestId = requestId;
  }
}

const envelope = z.looseObject({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z
    .looseObject({
      code: z.string(),
      message: z.string().optional(),
      data: z.looseObject({ orchestrationRequestId: z.string().optional() }).nullish(),
    })
    .optional(),
});

const repo = z.looseObject({ id: z.string(), path: z.string() });

const worktreeRow = z.looseObject({
  id: z.string(),
  path: z.string(),
  branch: z.string().optional(),
  displayName: z.string().optional(),
  isMainWorktree: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});

const terminalRow = z.looseObject({
  handle: z.string(),
  title: z.string().optional(),
  worktreeId: z.string().optional(),
  incarnationId: z.string().optional(),
  connected: z.boolean(),
  exitCause: z
    .looseObject({
      kind: z.string(),
      exitCode: z.number().optional(),
      signal: z.number().optional(),
    })
    .nullish(),
});

/** The `result` shapes of the Orca commands that AW uses (only the fields that AW reads). */
export const orcaReplies = {
  status: z.looseObject({
    runtime: z.looseObject({ state: z.string(), reachable: z.boolean() }),
  }),
  repoList: z.looseObject({ repos: z.array(repo) }),
  repoAdd: z.looseObject({ repo }),
  worktreeList: z.looseObject({ worktrees: z.array(worktreeRow) }),
  worktreeCreate: z.looseObject({
    worktree: worktreeRow.extend({ branch: z.string() }),
  }),
  terminalCreate: z.looseObject({
    terminal: z.looseObject({
      processId: z.int().min(2),
      handle: z.string(),
      worktreeId: z.string(),
      incarnationId: z.string(),
    }),
  }),
  terminalList: z.looseObject({ terminals: z.array(terminalRow) }),
  terminalShow: z.looseObject({ terminal: terminalRow }),
  terminalSend: z.looseObject({
    send: z.looseObject({
      prompt: z.looseObject({ provider: z.string().optional() }).optional(),
    }),
  }),
  /** A reply whose fields AW does not read (close, rm, setup-delete). */
  any: z.looseObject({}),
} as const;

export type TerminalRow = z.infer<typeof terminalRow>;

/**
 * Parses the JSON envelope of a reply and its `result` with the schema. A reply with `ok: false`
 * throws `OrcaError` with its code; a reply that does not parse throws `bad_reply`.
 */
export function parseReply<T>(stdout: string, command: string, schema: z.ZodType<T>): T {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new OrcaError(
      "bad_reply",
      `orca ${command} gave no JSON reply: ${stdout.trim().slice(0, 300) || "(empty)"}`,
    );
  }
  const reply = envelope.safeParse(json);
  if (!reply.success) {
    throw new OrcaError("bad_reply", `orca ${command} gave a reply that AW does not know`);
  }
  if (!reply.data.ok) {
    const error = reply.data.error;
    const code = error?.code ?? "cli_failed";
    throw new OrcaError(
      code,
      `orca ${command} failed: ${error?.message ?? code}`,
      error?.data?.orchestrationRequestId ?? null,
    );
  }
  const result = schema.safeParse(reply.data.result);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.join(".") || "result";
    throw new OrcaError(
      "bad_reply",
      `orca ${command} gave a reply that AW does not know (${where}: ${issue?.message ?? "invalid"})`,
    );
  }
  return result.data;
}

export interface OrcaCliOptions {
  /** The full path of the Orca CLI. */
  binary: string;
  /** The environment of each call. Default: the environment of awd. */
  env?: Record<string, string | undefined>;
  /** The time limit of one call. Default 30 s. */
  timeoutMs?: number;
}

export class OrcaCli {
  readonly binary: string;
  readonly #env: Record<string, string | undefined> | undefined;
  readonly #timeoutMs: number;

  constructor(options: OrcaCliOptions) {
    this.binary = options.binary;
    this.#env = options.env;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** Runs `orca <args> --json` and gives `result`, parsed with the schema. */
  async json<T>(args: string[], schema: z.ZodType<T>, options: { timeoutMs?: number } = {}) {
    const command = args.slice(0, 2).join(" ");
    const result = await execa(this.binary, [...args, "--json"], {
      reject: false,
      timeout: options.timeoutMs ?? this.#timeoutMs,
      ...(this.#env ? { env: this.#env, extendEnv: false } : {}),
    });
    const stdout = String(result.stdout ?? "");
    if (stdout.trim() === "" && result.exitCode !== 0) {
      throw new OrcaError(
        result.timedOut ? "timeout" : "cli_failed",
        `orca ${command} failed: ${result.timedOut ? "no answer in time" : String(result.stderr ?? "").trim() || `exit ${result.exitCode}`}`,
      );
    }
    return parseReply(stdout, command, schema);
  }

  /**
   * `orca --version`: the version `x.y.z` at the start of the first line (design decision 11), or
   * null. A prerelease suffix or more lines after it do not change the version.
   */
  async version(): Promise<string | null> {
    const result = await execa(this.binary, ["--version"], {
      reject: false,
      timeout: 10_000,
      ...(this.#env ? { env: this.#env, extendEnv: false } : {}),
    });
    if (result.exitCode !== 0) return null;
    const first =
      String(result.stdout ?? "")
        .trim()
        .split("\n")[0] ?? "";
    return /^(\d+\.\d+\.\d+)/.exec(first.trim())?.[1] ?? null;
  }
}
