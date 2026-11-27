// The bridge contract, part 2: the zod schema of each call that main accepts on the `call` channel.
// Main parses each payload with `callRequest` before it calls awd (docs/engineering-rules.md 5.2,
// 5.18). awd checks the bodies again with its own schemas, so these schemas check the shape and
// the size, not each awd rule.
import { PROPOSAL_TEXT } from "@aw/client/gates";
import { z } from "zod";
import type { CallMethod } from "./channels.ts";
import { setupCalls } from "./setup-contract.ts";

export * from "./channels.ts";

const id = z.string().min(1).max(200);
const text = z.string().max(60_000);
const none = z.object({}).strict();
const boolText = z.enum(["true", "false"]);

const taskListQuery = z
  .object({
    project: id.optional(),
    stage: id.optional(),
    needs_you: boolText.optional(),
    archived: boolText.optional(),
  })
  .strict();

const threadQuery = z
  .object({
    after: z.string().min(1).max(400).optional(),
    limit: z.int().min(1).max(1000).optional(),
    from: z.int().min(0).optional(),
    ancestors: boolText.optional(),
    before: z.string().min(1).max(400).optional(),
    newest: boolText.optional(),
    types: z
      .string()
      .regex(/^[a-z_.]+(,[a-z_.]+)*$/)
      .max(400)
      .optional(),
  })
  .strict();

const gateListQuery = z
  .object({ task: id.optional(), state: z.enum(["open", "resolved", "all"]).optional() })
  .strict();

/** The session options of a person (openspec session-options); awd checks them again. */
const sessionOptions = z
  .object({
    permission_mode: z.enum(["default", "accept_edits", "skip"]).nullable().optional(),
    agent_teams: z.boolean().optional(),
    work_in: z.enum(["worktree", "checkout", "folder"]).optional(),
    folder: z
      .string()
      .min(1)
      .max(4096)
      .refine((p) => p.startsWith("/"), "an absolute path")
      .nullable()
      .optional(),
    switch_branch: z.boolean().optional(),
  })
  .strict();

const createTaskBody = z
  .object({
    project: id,
    title: z.string().min(1).max(500),
    first_message: text,
    assignee: id.nullable().optional(),
    parent: id.nullable().optional(),
    depends_on: z.array(id).max(100).optional(),
    test_server: id.nullable().optional(),
    credentials: z.array(id).max(100).optional(),
    links: z.array(z.string().min(1).max(2000)).max(100).optional(),
    session_options: sessionOptions.optional(),
  })
  .strict();

const editTaskBody = z
  .object({
    title: z.string().min(1).max(500).optional(),
    first_message: text.optional(),
    priority: id.optional(),
  })
  .strict();

const answerBody = z
  .object({
    answer: z.string().min(1).max(60_000),
    comment: text.nullable().optional(),
    version: z.int().min(1).optional(),
  })
  .strict();

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);
const pairingId = z.string().regex(/^[0-9a-f]{32}$/);
const credentialName = z
  .string()
  .regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/)
  .max(128);
/** A knowledge path: shared/… or projects/<project>/… */
const kbPath = z.string().min(1).max(1024);
/** A path from the workspace root. */
const wsPath = z.string().min(1).max(1024);
const ws = { ws: id };

function call<M extends CallMethod, A extends z.ZodType>(method: M, args: A) {
  return z.object({ method: z.literal(method), args }).strict();
}

/** One allowed call: the method and its arguments. */
export const callRequest = z.discriminatedUnion("method", [
  call("connection", none),
  call("status", none),
  call("workspaces", none),
  call("projects", z.object({ ws: id }).strict()),
  call("tasks", z.object({ ws: id, query: taskListQuery.optional() }).strict()),
  call("task", z.object({ ws: id, task: id }).strict()),
  call("thread", z.object({ ws: id, task: id, query: threadQuery.optional() }).strict()),
  call("gates", z.object({ ws: id, query: gateListQuery.optional() }).strict()),
  call("sessions", none),
  call("createTask", z.object({ ws: id, body: createTaskBody }).strict()),
  call("editTask", z.object({ ws: id, task: id, body: editTaskBody }).strict()),
  call(
    "assignTask",
    z
      .object({
        ws: id,
        task: id,
        assignee: id,
        session_host: z.enum(["tmux", "orca"]).optional(),
        session_options: sessionOptions.optional(),
      })
      .strict(),
  ),
  call("archiveTask", z.object({ ws: id, task: id, stop: z.boolean().optional() }).strict()),
  call("unarchiveTask", z.object({ ws: id, task: id }).strict()),
  call("stopTaskSession", z.object({ ws: id, task: id }).strict()),
  call("answerGate", z.object({ ws: id, gate: id, body: answerBody }).strict()),
  call(
    "sendMessage",
    z
      .object({
        ws: id,
        task: id,
        text: z
          .string()
          .min(1)
          .max(60_000)
          .refine((t) => t.trim().length > 0, "The message is empty"),
      })
      .strict(),
  ),
  call("stopSession", z.object({ session: id }).strict()),
  call("openExternal", z.object({ url: z.url({ protocol: /^https$/ }).max(4000) }).strict()),
  // ---- Devices, sync, pairing, credentials (add-desktop-devices-knowledge) ----
  call("syncStatus", none),
  call("syncNow", z.object({ timeout_ms: z.int().min(100).max(600_000).optional() }).strict()),
  call("identity", none),
  call("phrase", none),
  call("devices", z.object(ws).strict()),
  call("presence", z.object(ws).strict()),
  call("sessionHosts", z.object(ws).strict()),
  call("queues", z.object(ws).strict()),
  call("revokeDevice", z.object({ ...ws, device: slug }).strict()),
  call("startPairing", z.object(ws).strict()),
  call("pairing", z.object({ id: pairingId }).strict()),
  call(
    "approvePairing",
    z.object({ id: pairingId, check_code: z.string().regex(/^\s*\d{3}\s*\d{3}\s*$/) }).strict(),
  ),
  call("cancelPairing", z.object({ id: pairingId }).strict()),
  call(
    "joinPairing",
    z
      .object({
        code: z.string().min(8).max(4096),
        // The location that holds the workspace folder (openspec workspace-folder).
        parent: z.string().min(1).max(4096).startsWith("/").optional(),
      })
      .strict(),
  ),
  call("credentials", z.object(ws).strict()),
  call(
    "addCredential",
    z
      .object({
        ...ws,
        name: credentialName,
        value: z
          .string()
          .min(1)
          .max(64 * 1024),
      })
      .strict(),
  ),
  call("removeCredential", z.object({ ...ws, name: credentialName }).strict()),
  // ---- Knowledge ----
  call(
    "kbList",
    z
      .object({
        ...ws,
        scope: z.enum(["all", "shared", "project"]).optional(),
        project: id.optional(),
      })
      .strict(),
  ),
  call("kbRead", z.object({ ...ws, path: kbPath, version: id.optional() }).strict()),
  call("kbHistory", z.object({ ...ws, path: kbPath }).strict()),
  call("kbUndo", z.object({ ...ws, change: id }).strict()),
  call("kbSuggestions", z.object({ ...ws, state: z.enum(["pending", "all"]).optional() }).strict()),
  call(
    "kbAccept",
    z
      .object({
        ...ws,
        suggestion: id,
        force: z.boolean().optional(),
        comment: z.string().max(10_000).optional(),
      })
      .strict(),
  ),
  call(
    "kbReject",
    z.object({ ...ws, suggestion: id, comment: z.string().max(10_000).optional() }).strict(),
  ),
  call(
    "kbDigest",
    z
      .object({
        ...ws,
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .strict(),
  ),
  // ---- Files and issues ----
  call("issues", z.object(ws).strict()),
  call("restoreDocument", z.object({ ...ws, path: wsPath }).strict()),
  call("openWorkspaceFile", z.object({ ...ws, path: wsPath }).strict()),
  call("taskFiles", z.object({ ...ws, task: id }).strict()),
  call("taskFile", z.object({ ...ws, task: id, path: wsPath }).strict()),
  call("openTaskArtifact", z.object({ ...ws, task: id, path: wsPath }).strict()),
  // The folder of the newest session of the task on this device: main reads the path (no path in).
  call("openSessionFolder", z.object({ ...ws, task: id }).strict()),
  call("terminal", z.object({ ...ws, task: id }).strict()),
  call(
    "openTerminal",
    z.object({ ...ws, task: id, action: z.enum(["attach", "sign_in"]) }).strict(),
  ),
  // ---- App ----
  call("phraseConfirmed", z.object({ user: id }).strict()),
  call("confirmPhrase", z.object({ user: id }).strict()),
  call("phraseShown", z.object({ user: id }).strict()),
  // No arguments: the renderer never sends the phrase (openspec keys-backup).
  call("copyPhrase", none),
  call("savePhrase", none),
  call("appSettings", none),
  call("setOpenAtLogin", z.object({ open: z.boolean() }).strict()),
  call("setAppearance", z.object({ appearance: z.enum(["system", "light", "dark"]) }).strict()),
  call(
    "setProposalTextSize",
    z
      .object({
        px: z
          .int()
          .min(PROPOSAL_TEXT.min)
          .max(PROPOSAL_TEXT.max)
          .refine((px) => (px - PROPOSAL_TEXT.min) % PROPOSAL_TEXT.step === 0, "a size step"),
      })
      .strict(),
  ),
  // The start folder only: main returns the folder that the person picks (openspec create-flows).
  call(
    "chooseFolder",
    z
      .object({
        purpose: z.enum(["checkout", "workspace", "session"]),
        default_path: z
          .string()
          .min(1)
          .max(4096)
          .refine((p) => p.startsWith("/"), "an absolute path")
          .optional(),
      })
      .strict(),
  ),
  // ---- Setup (gap-setup) ----
  ...setupCalls,
  // ---- Setup check (gap-install) ----
  call("doctor", none),
]);

export type CallRequest = z.infer<typeof callRequest>;
