// The session files in `~/.aw/sessions/<session>/` (design decision 11): the record, the launch
// file of aw-launch, the first input, the context and the spool. The folder has mode 0700 and each
// file mode 0600. These files are never synced.
import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const SESSION_SCHEMA = 1;

const paneRef = z.object({
  host: z.string(),
  window: z.string(),
  pane: z.string(),
  pid: z.int(),
  pgid: z.int(),
  /** The wall time in ms when the pane opened (the stop of a dead pane needs it). */
  opened: z.number().optional(),
  /** The id of this run of the pane process (the Orca `incarnationId`). */
  instance: z.string().optional(),
});

export const sessionRecord = z.looseObject({
  kind: z.literal("aw-session"),
  schema: z.literal(SESSION_SCHEMA),
  id: z.string(),
  workspace: z.string(),
  task: z.string(),
  key: z.string().nullable(),
  agent: z.string(),
  epoch: z.int(),
  claim_event: z.string(),
  cwd: z.string(),
  branch: z.string().nullable(),
  /**
   * `running` until a stop; `moved` after an assignment to another device; `replaced` after an
   * assignment on this device (another agent, or the same agent again); `ended` when the human
   * ended the agent; `failed` after 2 resumes with no progress or 5 resumes in one hour, or after
   * 3 new starts of an agent that stopped before its first prompt.
   */
  state: z.enum(["running", "stopped", "moved", "replaced", "ended", "failed"]),
  /** The session host (`tmux` or `orca`). A running session keeps it (add-orca-session-host). */
  host: z.string().default("tmux"),
  launch: z.object({
    name: z.string(),
    plugin_dir: z.string(),
    settings_file: z.string(),
    /** The AW permission mode (`default`, `accept_edits`, `skip`; openspec session-options). */
    permission_mode: z.string(),
    model: z.string().nullable(),
    /** Agent teams on (openspec session-options). */
    agent_teams: z.boolean().optional(),
  }),
  /** Where the session works: an AW worktree, the project checkout or another folder. */
  work_in: z.enum(["worktree", "checkout", "folder"]).optional(),
  pane: paneRef.nullable(),
  /** The time of the clock module in ms when awd opened the current window (the trust screen). */
  opened_at: z.number().optional(),
  /** Resumes since the last progress (a Stop or PostToolUse hook, or 10 min alive). */
  resumes: z.int().default(0),
  /** The clock times of the resumes: at most 5 in one hour (add-continuity). */
  resume_times: z.array(z.number()).default([]),
  /** Window openings in a row after aw-launch exit 3 (awd not ready): they do not count. */
  launch_waits: z.int().default(0),
  /** The boot time (ms) of a resume after a reboot, until its SessionStart: the restart comment. */
  restart_boot: z.number().nullable().default(null),
  /** The continues of AW after a usage limit in this session (at most 3, then a gate). */
  continues: z.int().default(0),
  /**
   * The usage pause of the session: the cause, the reset time (ms) and when AW continues by
   * itself (null: Claude Code continues by itself).
   */
  usage_pause: z
    .object({
      cause: z.enum(["usage_limit", "usage_limit_weekly", "continue_cap"]),
      resets_at: z.number().nullable(),
      continue_at: z.number().nullable(),
    })
    .nullable()
    .default(null),
  /** True after the Notification `quota_auto_resume_disabled`: AW continues after each reset. */
  auto_resume_disabled: z.boolean().default(false),
  /** StopFailure hooks in a row that are not usage limits, and the time of the next retry. */
  agent_errors: z.int().default(0),
  agent_retry: z.object({ at: z.number(), error: z.string() }).nullable().default(null),
  /** New starts after the agent stopped with no conversation yet (never reset). */
  restarts: z.int().default(0),
  /**
   * The commit of the checkpoint branch on `origin` that this session last based on or pushed
   * (openspec move-paused-task): the lease of the next push. Null: none seen.
   */
  checkpoint: z.string().nullable().default(null),
  /** The last PreToolUse with no PostToolUse: the interrupted step of a resume. */
  pending_tool: z
    .object({ tool: z.string(), summary: z.string(), id: z.string().nullable() })
    .nullable()
    .default(null),
  /** The last Notification type while no later hook event came, or null. */
  notification: z.string().nullable().default(null),
  /** True after the first prompt of the session: the first input has the source `first`. */
  first_seen: z.boolean().default(false),
  /** True after the SessionStart of the first start (session.started is written). */
  started: z.boolean().default(false),
  /**
   * The pane (the Orca handle) that sent its SessionStart. A host that does not read the screen
   * gets a text only after the SessionStart of its current pane (docs/phase-1.md 9.9.3).
   */
  ready_pane: z.string().optional(),
  /** True from a UserPromptSubmit to the next Stop: Claude Code queues a text that arrives then. */
  busy: z.boolean().default(false),
  /**
   * The delivery ids whose UserPromptSubmit came while a turn ran, until the next Stop: Claude Code
   * put the text into that turn, so its Stop is no proof that the agent acted on it (fix list 0-27).
   */
  busy_deliveries: z.array(z.string()).default([]),
  /** The delivery ids that AW gave up after 3 attempts ("Answer not delivered"). */
  failed_deliveries: z.array(z.string()).default([]),
  /**
   * The id of a notice that is the first input of this session (a parent session that AW started
   * again for "Subtask AW-13 done", add-task-loop): the delivery loop does not paste it again.
   */
  first_delivery: z.string().nullable().default(null),
  /**
   * "Allow for this task" rules: a tool and the key of `ruleKey` (the command of Bash, the file of a
   * file tool, else the sha256 of the input). A rule with no key (an older record) allows nothing.
   */
  rules: z.array(z.object({ tool: z.string(), command: z.string().nullable() })).default([]),
  /** One-time approvals of a late "Allow", by gate. `input` is the sha256 of the tool input. */
  approvals: z
    .array(z.object({ gate: z.string(), tool: z.string(), input: z.string(), used: z.boolean() }))
    .default([]),
});
export type SessionRecord = z.infer<typeof sessionRecord>;

/** The launch file that aw-launch reads (design decision 12). */
export const launchFile = z.object({
  mode: z.enum(["new", "resume"]),
  binary: z.string(),
  /** The arguments before `--`. aw-launch adds `--` and the message. */
  args: z.array(z.string()),
  message_file: z.string(),
  socket: z.string(),
  env: z.record(z.string(), z.string()),
  /** Write the trust entry of the working folder (a covered Claude Code version). */
  trust: z.boolean(),
  state_file: z.string(),
  backup_dir: z.string(),
  /** The wait for /readyz in ms. Default 10,000 (tests give a short one). */
  ready_wait_ms: z.int().positive().optional(),
  /** What the AW guard of the PreToolUse hook needs (openspec session-options). */
  guard: z
    .object({
      home: z.string(),
      user_home: z.string(),
      workspaces: z.array(z.string()),
      credentials_dir: z.string().nullable(),
      cwd: z.string(),
    })
    .optional(),
});
export type LaunchFile = z.infer<typeof launchFile>;

export interface SessionPaths {
  dir: string;
  record: string;
  launch: string;
  firstInput: string;
  continueInput: string;
  context: string;
  settings: string;
  spool: string;
  done: string;
  /** The full tool input of each permission gate (`<gate>.json`): the gate event has a hash only. */
  requests: string;
  /** The usage windows of the statusline (`aw-statusline`, add-continuity). */
  usage: string;
  /** The credential files of the session (`AW_CREDENTIALS_DIR`). */
  credentials: string;
}

export function sessionsRoot(home: string): string {
  return join(home, "sessions");
}

export function sessionPaths(home: string, id: string): SessionPaths {
  const dir = join(sessionsRoot(home), id);
  return {
    dir,
    record: join(dir, "session.json"),
    launch: join(dir, "launch.json"),
    firstInput: join(dir, "first-input.md"),
    continueInput: join(dir, "continue.md"),
    context: join(dir, "context.md"),
    settings: join(dir, "settings.json"),
    spool: join(dir, "spool"),
    done: join(dir, "spool", "done"),
    requests: join(dir, "requests"),
    usage: join(dir, "usage.json"),
    credentials: join(dir, "credentials"),
  };
}

export async function privateFolder(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

/**
 * Writes a file with mode 0600 through a temp file and a rename. Each write has its own temp file:
 * 2 saves of one record at the same time both succeed, and the last rename wins (fix list gfc-13).
 */
export async function writePrivate(path: string, content: string): Promise<void> {
  const temp = `${path}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
  try {
    // Synced to the disk before the rename: a power loss never leaves an empty key file such as
    // keys/vapid.json (final check fc1-11).
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export async function prepareSessionFolder(paths: SessionPaths): Promise<void> {
  await privateFolder(paths.dir);
  await privateFolder(paths.spool);
  await privateFolder(paths.done);
  await privateFolder(paths.requests);
}

export async function saveRecord(home: string, record: SessionRecord): Promise<void> {
  await writePrivate(sessionPaths(home, record.id).record, `${JSON.stringify(record, null, 2)}\n`);
}

export async function readRecord(home: string, id: string): Promise<SessionRecord | null> {
  try {
    const text = await readFile(sessionPaths(home, id).record, "utf8");
    const parsed = sessionRecord.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Each session record of this device. A folder with no valid record is skipped. */
export async function listRecords(home: string): Promise<SessionRecord[]> {
  let names: string[];
  try {
    names = await readdir(sessionsRoot(home));
  } catch {
    return [];
  }
  const records: SessionRecord[] = [];
  for (const name of names.sort()) {
    const record = await readRecord(home, name);
    if (record) records.push(record);
  }
  return records;
}
