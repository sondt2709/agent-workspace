// Field schemas that the documents and the events share (docs/phase-1.md 3.2, 3.3 and 3.6).
import { z } from "zod";

/** A UUIDv7 (RFC 9562): the id of a task, an event, a session or a gate. */
export const uuidv7 = z.uuid({ version: "v7" });

/** A device slug, for example `ubuntu-01`. It is fixed at pairing and unique in the device list. */
export const deviceSlug = z
  .string()
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower-case letters, digits and single hyphens");

/** A project slug, for example `billing-api`. */
export const projectSlug = deviceSlug;

/** The pattern of an HLC text: `<UTC time, ISO 8601 with ms>#<4-digit counter>`. */
export const HLC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#\d{4}$/;

/** The time in ms of an HLC text, or undefined when the text is not an HLC or its date is not real. */
export function hlcTimeOf(text: string): number | undefined {
  if (!HLC_PATTERN.test(text)) return undefined;
  const iso = text.slice(0, text.indexOf("#"));
  const time = Date.parse(iso);
  // Date.parse accepts some invalid dates (for example 2026-02-30). The round trip rejects them.
  if (Number.isNaN(time) || new Date(time).toISOString() !== iso) return undefined;
  return time;
}

/**
 * The annotation of a check that a JSON Schema pattern cannot express. `z.toJSONSchema()` drops a
 * refine, so the generated JSON Schema names the check, and the Kotlin classes run it.
 */
export const AW_CHECK = "x-aw-check";

/**
 * A hybrid logical clock value. It sorts as text. The refine rejects a date that does not exist
 * (`2026-13-45T25:00:00.000Z`). The generated JSON Schema has the pattern and `"x-aw-check": "hlc"`.
 */
export const hlcText = z
  .string()
  .regex(HLC_PATTERN, "Use <UTC time with ms>#<4-digit counter>")
  .refine((text) => hlcTimeOf(text) !== undefined, "Use a real UTC date and time")
  .meta({ [AW_CHECK]: "hlc" });

/** An actor on a device: `human@pixel-9`, `claude@ubuntu-01`, `aw@macbook-pro`. */
export const actorRef = z
  .string()
  .max(127)
  .regex(/^[a-z][a-z0-9-]*@[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use <name>@<device>");

/** An assignee: an agent on a device, for example `claude@ubuntu-01`. */
export const agentRef = actorRef;

/** A task key, for example `AW-7`. A display alias only (docs/architecture.md 4.3.3). */
export const taskKey = z.string().regex(/^[A-Z][A-Z0-9]{0,9}-[1-9]\d*$/, "Use <PREFIX>-<number>");

/** The key prefix of a workspace, for example `AW`. */
export const keyPrefix = z.string().regex(/^[A-Z][A-Z0-9]{0,9}$/);

/** The name of a credential or a test server: a name only, never a value. */
export const entryName = z
  .string()
  .max(63)
  .regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/, "Use lower-case letters, digits, '-', '_' or '.'");

/** A UTC time in ISO 8601, for example `2026-11-22T14:20:01.123Z`. */
export const isoTime = z.iso.datetime();

/** A sha256 hash in lower-case hex. */
export const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * A path relative to a folder of the workspace, with `/` separators and no `..` part. The generated
 * JSON Schema has `"x-aw-check": "relative-path"` for the refine.
 */
export const relativePath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !p.includes("\\") &&
      p.split("/").every((s) => s !== ".." && s !== "" && s !== "."),
    "Use a relative path with no '..', '.' or empty part",
  )
  .meta({ [AW_CHECK]: "relative-path" });

/** A count that is 0 or more. */
export const count = z.int().min(0);

/** The 3 device roles (docs/decisions/2026-11-22-device-sync.md). */
export const deviceRole = z.enum(["local", "remote", "mobile"]);
export type DeviceRole = z.infer<typeof deviceRole>;

/** The board stages (docs/workflow.md 3). "Needs you" is a lane, not a stage. */
export const stage = z.enum(["backlog", "discuss", "ready", "implement", "review", "done"]);
export type Stage = z.infer<typeof stage>;

/** The session hosts that a person can pick for a new session (prd.md AGT-19). */
export const sessionHost = z.enum(["tmux", "orca"]);
export type SessionHostName = z.infer<typeof sessionHost>;

/**
 * The permission mode of a session (openspec session-options). AW names: the agent adapter maps them
 * to its own flags. `skip` runs each command with no gate; only a person sets it.
 */
export const permissionMode = z.enum(["default", "accept_edits", "skip"]);
export type PermissionMode = z.infer<typeof permissionMode>;

/** Where a session works: a git worktree of AW, the project checkout, or another folder. */
export const workIn = z.enum(["worktree", "checkout", "folder"]);
export type WorkIn = z.infer<typeof workIn>;

/** An absolute path on one device, for example `/work/billing-api`. */
export const absolutePath = z.string().max(4096).regex(/^\//, "Use an absolute path");

/**
 * The session options that a person sets on a task (`task.created`, `task.assigned`). Null mode:
 * the project default. `folder` is the absolute folder of `work_in: folder`, else null.
 */
export const sessionOptions = z.looseObject({
  permission_mode: permissionMode.nullable().default(null),
  agent_teams: z.boolean().default(false),
  work_in: workIn.default("worktree"),
  folder: absolutePath.nullable().default(null),
  /**
   * `work_in: checkout` only: true checks out `aw/<key>` in the checkout; false keeps the branch
   * of the checkout, as `folder` does (openspec project-checkout-no-worktree).
   */
  switch_branch: z.boolean().default(true),
});
export type SessionOptions = z.infer<typeof sessionOptions>;

/** The pause causes (docs/architecture.md 4.6.5). */
export const pauseCause = z.enum([
  "usage_limit",
  "usage_limit_weekly",
  "continue_cap",
  "device_offline",
  "device_restart",
  "device_revoked",
  "network_lost",
  "waiting_for_sync",
  "task_moving",
  "agent_error",
  "login_expired",
]);
export type PauseCause = z.infer<typeof pauseCause>;

/** The gate kinds (docs/workflow.md 3, the canonical gate table). */
export const gateKind = z.enum([
  "question",
  "reply",
  "approve_proposal",
  "assign",
  "approve_command",
  "approve_result",
  "approve_knowledge",
  "approve_device",
  "continue_after_limit",
  "take_over_terminal",
  "fix_file",
  "custom",
]);
export type GateKind = z.infer<typeof gateKind>;
