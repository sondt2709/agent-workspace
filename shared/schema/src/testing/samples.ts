// The schema samples: valid and invalid values of each schema. The TypeScript schema tests
// (src/schemas.test.ts) run them, and `pnpm schema:generate` writes them to
// contracts/samples/schema-samples.json for the Kotlin tests (android/shared).
// Not in the package index: product code must not import it.
import type { EventType } from "../events.ts";
import { copy, FIXTURE_TASK_ID, fixtureDocuments } from "./fixtures.ts";

export function fixtureDocument(kind: string, slug?: string): Record<string, unknown> {
  const found = fixtureDocuments().find(
    (doc) => doc.value.kind === kind && (slug === undefined || doc.path.includes(`/${slug}/`)),
  );
  if (!found) throw new Error(`No fixture document ${kind}`);
  return copy(found.value);
}

export const ID = "01a2038e-7f00-7000-8000-000000000001";
export const ID2 = "01a2038e-7f00-7000-8000-000000000002";
export const HASH = "a".repeat(64);

/** Valid data for each event type. A test checks that each type in the registry has one. */
export const validData: Record<EventType, Record<string, unknown>> = {
  "task.created": {
    key: "AW-12",
    project: "billing-api",
    title: "Add a rate limit",
    first_message: "/my-team:implement Add a rate limit to the public API",
  },
  "task.assigned": { assignee: "claude@ubuntu-01" },
  "task.claimed": { epoch: 2, device: "ubuntu-01", session: ID, based_on: ID2 },
  "task.released": { epoch: 2 },
  "task.rekeyed": { from: "AW-7", to: "AW-9" },
  "task.edited": { field: "title", value: "Fix the invoice test" },
  "task.stage_changed": { from: "implement", to: "review" },
  "task.paused": {
    cause: "usage_limit",
    resumes_at: "2026-11-22T15:45:00.000Z",
    next_step: "Claude Code continues at the reset.",
    needs_human: false,
  },
  "task.resumed": {},
  "task.ready": { missing: ["test account for role X"] },
  "task.progress": { text: "Run the tests" },
  "task.done": {},
  "task.learned": { nothing_new: true },
  "task.archived": {},
  "task.unarchived": {},
  "message.human": { text: "Use 1000/min.", source: "phone", session: ID, delivery_id: "m-1" },
  "message.agent": { text: "Done. 50 runs passed.", session: ID, source: "tool" },
  "message.sent": { id: ID, text: "Also check the refunds.", to_session: ID2 },
  "comment.added": { text: "Looks good." },
  "gate.opened": {
    gate: ID,
    kind: "approve_command",
    version: 1,
    request_id: `p-${ID2}`,
    text: "npm publish",
  },
  "gate.answered": { gate: ID, version: 1, answer: "1000/min" },
  "gate.resolved": { gate: ID, version: 1, answer_event: ID2, answer: "1000/min" },
  "proposal.proposed": { version: 2, file: "proposal/v2.md" },
  "artifact.added": { path: "artifacts/ubuntu-01/report.html", size: 2048, sha256: HASH },
  "result.posted": { file: "artifacts/ubuntu-01/result.md", artifacts: [] },
  "handoff.written": { file: "artifacts/ubuntu-01/handoff.md" },
  "session.started": { session: ID, host: "orca", cwd: "~/code/billing-api" },
  "session.resumed": { session: ID, text: "Server restarted at 03:12." },
  "session.stop_requested": { session: ID },
  "session.ended": { session: ID, reason: "moved" },
  "slot.acquired": {
    resource: "k3d",
    slot: 0,
    fencing_token: 4,
    ttl_ms: 1800000,
    task: ID,
    session: ID2,
  },
  "slot.renewed": { resource: "k3d", slot: 0, fencing_token: 4, ttl_ms: 1800000 },
  "slot.released": { resource: "k3d", slot: 0, fencing_token: 4 },
  "slot.revoked": { resource: "k3d", slot: 0, fencing_token: 4, reason: "reboot" },
  "queue.reordered": { agent: "claude@ubuntu-01", tasks: [ID, ID2] },
  "credential.added": { name: "stripe-test" },
  "credential.imported": {
    name: "stripe-test",
    from: "pixel-9",
    sealed: "0193a7f0-1b2c-7d3e-8f40-5a6b7c8d9e0f",
  },
  "credential.removed": { name: "stripe-test" },
  "project.removed": {
    project: "billing-api",
    name: "Billing API",
    document: { kind: "project", schema: 1, slug: "billing-api", name: "Billing API" },
  },
  "knowledge.changed": {
    path: "shared/rules/testing.md",
    hash: HASH,
    base: null,
    author: "human@macbook-pro",
    kind: "edit",
  },
  "knowledge.undo_requested": { path: "shared/rules/testing.md", hash: HASH },
  "knowledge.suggested": {
    suggestion: ID2,
    path: "shared/rules/testing.md",
    content: "# Testing rules\n\n1. Use the fake clock.\n",
    hash: HASH,
    base: HASH,
    author: "claude@ubuntu-01",
    task: ID,
    kind: "edit",
    reasons: ["rule", "locked", "shared"],
  },
  "knowledge.suggestion_resolved": { suggestion: ID2, decision: "accepted", comment: null },
  "device.heartbeat": { boot_time: "2026-11-22T08:00:00.000Z" },
};

export function event(type: string, data: unknown, extra: Record<string, unknown> = {}) {
  return {
    v: 1,
    id: ID,
    hlc: "2026-11-22T14:20:01.123Z#0000",
    dev: "ubuntu-01",
    type,
    by: "claude@ubuntu-01",
    data,
    ...extra,
  };
}

/** Valid and invalid document samples. `invalidPath` is the zod issue path of an invalid sample. */
export const documentSamples: {
  name: string;
  schema: string;
  value: () => unknown;
  invalidPath?: string;
}[] = [
  { name: "fixture task", schema: "task.v1", value: () => fixtureDocument("task") },
  {
    name: "task with an unknown field of a newer minor version",
    schema: "task.v1",
    value: () => ({ ...fixtureDocument("task"), priority_hint: "high" }),
  },
  {
    name: "task stage testing",
    schema: "task.v1",
    value: () => ({ ...fixtureDocument("task"), stage: "testing" }),
    invalidPath: "stage",
  },
  {
    name: "task key aw-7",
    schema: "task.v1",
    value: () => ({ ...fixtureDocument("task"), key: "aw-7" }),
    invalidPath: "key",
  },
  {
    name: "task id is a UUIDv4",
    schema: "task.v1",
    value: () => ({ ...fixtureDocument("task"), id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8" }),
    invalidPath: "id",
  },
  {
    name: "task with no first message",
    schema: "task.v1",
    value: () => {
      const doc = fixtureDocument("task");
      delete doc.first_message;
      return doc;
    },
    invalidPath: "first_message",
  },
  {
    name: "task assignee with no device",
    schema: "task.v1",
    value: () => ({ ...fixtureDocument("task"), assignee: "claude" }),
    invalidPath: "assignee",
  },
  {
    name: "task claim epoch 0",
    schema: "task.v1",
    value: () => {
      const doc = fixtureDocument("task");
      (doc.claim as Record<string, unknown>).epoch = 0;
      return doc;
    },
    invalidPath: "claim.epoch",
  },
  {
    name: "task credential name with a space",
    schema: "task.v1",
    value: () => ({ ...fixtureDocument("task"), credentials: ["stripe test"] }),
    invalidPath: "credentials.0",
  },
  {
    name: "task pause with an unknown cause",
    schema: "task.v1",
    value: () => ({
      ...fixtureDocument("task"),
      paused: {
        cause: "coffee",
        since: "2026-11-22T14:00:00.000Z",
        next_step: "x",
        needs_human: false,
      },
    }),
    invalidPath: "paused.cause",
  },
  {
    name: "minimal task: fields with a default are optional",
    schema: "task.v1",
    value: () => ({
      kind: "task",
      schema: 1,
      id: FIXTURE_TASK_ID,
      key: "AW-1",
      project: "billing-api",
      title: "A task",
      first_message: "Hello",
      stage: "backlog",
    }),
  },
  {
    name: "task of the wrong kind",
    schema: "task.v1",
    value: () => ({ ...fixtureDocument("task"), kind: "project" }),
    invalidPath: "kind",
  },
  {
    name: "fixture workspace",
    schema: "workspace.v1",
    value: () => fixtureDocument("workspace"),
  },
  {
    name: "workspace key prefix aw",
    schema: "workspace.v1",
    value: () => ({ ...fixtureDocument("workspace"), key_prefix: "aw" }),
    invalidPath: "key_prefix",
  },
  {
    name: "workspace new projects skip permissions",
    schema: "workspace.v1",
    value: () => ({ ...fixtureDocument("workspace"), new_project_permission_mode: "skip" }),
  },
  {
    name: "workspace new projects bypass",
    schema: "workspace.v1",
    value: () => ({
      ...fixtureDocument("workspace"),
      new_project_permission_mode: "bypassPermissions",
    }),
    invalidPath: "new_project_permission_mode",
  },
  { name: "fixture project", schema: "project.v1", value: () => fixtureDocument("project") },
  {
    name: "project added again after a remove",
    schema: "project.v1",
    value: () => ({ ...fixtureDocument("project"), added_at: "2026-11-24T10:00:00.000Z#0001" }),
  },
  {
    name: "project added_at not an HLC",
    schema: "project.v1",
    value: () => ({ ...fixtureDocument("project"), added_at: "2026-11-24" }),
    invalidPath: "added_at",
  },
  {
    name: "project device Ubuntu_01",
    schema: "project.v1",
    value: () => ({ ...fixtureDocument("project"), devices: ["Ubuntu_01"] }),
    invalidPath: "devices.0",
  },
  {
    name: "project permission mode skip",
    schema: "project.v1",
    value: () => ({ ...fixtureDocument("project"), permission_mode: "skip" }),
  },
  {
    name: "project permission mode bypass",
    schema: "project.v1",
    value: () => ({ ...fixtureDocument("project"), permission_mode: "bypassPermissions" }),
    invalidPath: "permission_mode",
  },
  { name: "fixture device", schema: "device.v1", value: () => fixtureDocument("device") },
  {
    name: "device role server",
    schema: "device.v1",
    value: () => ({ ...fixtureDocument("device"), role: "server" }),
    invalidPath: "role",
  },
  {
    name: "device sync id too short",
    schema: "device.v1",
    value: () => ({ ...fixtureDocument("device"), sync_device_id: "ABCDEFG-HIJKLMN" }),
    invalidPath: "sync_device_id",
  },
  {
    name: "device revoked_at yesterday",
    schema: "device.v1",
    value: () => ({ ...fixtureDocument("device"), revoked: true, revoked_at: "yesterday" }),
    invalidPath: "revoked_at",
  },
  {
    name: "device seq 0",
    schema: "device.v1",
    value: () => ({ ...fixtureDocument("device"), seq: 0 }),
    invalidPath: "seq",
  },
  {
    name: "fixture health",
    schema: "health.v1",
    value: () => fixtureDocument("health", "ubuntu-01"),
  },
  {
    name: "health disk 120 %",
    schema: "health.v1",
    value: () => ({ ...fixtureDocument("health"), disk: { used_percentage: 120 } }),
    invalidPath: "disk.used_percentage",
  },
  {
    name: "health route wifi",
    schema: "health.v1",
    value: () => {
      const doc = fixtureDocument("health");
      ((doc.sync as unknown[])[0] as Record<string, unknown>).route = "wifi";
      return doc;
    },
    invalidPath: "sync.0.route",
  },
  {
    name: "health queue limits",
    schema: "health.v1",
    value: () => ({
      ...fixtureDocument("health"),
      queue: { max_working: 2, disk_full_percent: 95, login_valid: null },
    }),
  },
  {
    name: "health queue max_working 0",
    schema: "health.v1",
    value: () => ({
      ...fixtureDocument("health"),
      queue: { max_working: 0, disk_full_percent: 95, login_valid: true },
    }),
    invalidPath: "queue.max_working",
  },
  {
    name: "fixture bindings",
    schema: "bindings.v1",
    value: () => fixtureDocument("bindings", "ubuntu-01"),
  },
  {
    name: "bindings resource capacity 0",
    schema: "bindings.v1",
    value: () => ({ ...fixtureDocument("bindings"), resources: { k3d: 0 } }),
    invalidPath: "resources.k3d",
  },
  {
    name: "bindings with Orca on and a checkout host",
    schema: "bindings.v1",
    value: () => ({
      ...fixtureDocument("bindings"),
      use_orca: true,
      checkouts: [{ project: "billing-api", path: "/work/billing-api", session_host: "orca" }],
    }),
  },
  {
    name: "bindings checkout with bound_at",
    schema: "bindings.v1",
    value: () => ({
      ...fixtureDocument("bindings"),
      checkouts: [
        {
          project: "billing-api",
          path: "/work/billing-api",
          bound_at: "2026-11-24T10:00:00.000Z#0000",
        },
      ],
    }),
  },
  {
    name: "bindings checkout bound_at not an HLC",
    schema: "bindings.v1",
    value: () => ({
      ...fixtureDocument("bindings"),
      checkouts: [{ project: "billing-api", path: "/work/billing-api", bound_at: "yesterday" }],
    }),
    invalidPath: "checkouts.0.bound_at",
  },
  {
    name: "bindings checkout host pty",
    schema: "bindings.v1",
    value: () => ({
      ...fixtureDocument("bindings"),
      checkouts: [{ project: "billing-api", path: "/work/billing-api", session_host: "pty" }],
    }),
    invalidPath: "checkouts.0.session_host",
  },
  {
    name: "fixture test servers",
    schema: "test-servers.v1",
    value: () => fixtureDocument("test-servers"),
  },
  {
    name: "test server name with spaces",
    schema: "test-servers.v1",
    value: () => ({ kind: "test-servers", schema: 1, servers: [{ name: "Billing K3D" }] }),
    invalidPath: "servers.0.name",
  },
  {
    name: "push file of a phone",
    schema: "push.v1",
    value: () => ({
      kind: "push",
      schema: 1,
      device: "pixel-9",
      subscriptions: [
        {
          computer: "ubuntu-01",
          endpoint: "https://push.example.test/up/abc",
          p256dh: PUSH_KEY,
          auth: "BTBZMqHH6r4Tts7J_aSIgg",
          vapid_public_key: PUSH_KEY,
          distributor: null,
          updated: "2026-11-23T10:00:00.000Z",
        },
      ],
    }),
  },
  {
    name: "push subscription with no endpoint",
    schema: "push.v1",
    value: () => ({
      kind: "push",
      schema: 1,
      device: "pixel-9",
      subscriptions: [
        {
          computer: "ubuntu-01",
          p256dh: PUSH_KEY,
          auth: "BTBZMqHH6r4Tts7J_aSIgg",
          vapid_public_key: PUSH_KEY,
        },
      ],
    }),
    invalidPath: "subscriptions.0.endpoint",
  },
];

/** A valid uncompressed P-256 key in base64url (the RFC 8291 appendix A key of the user agent). */
const PUSH_KEY =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";

/** The gate.answered line of docs/workflow.md 9. */
export const docLine = {
  v: 1,
  id: "01a2038e-7f00-7000-8000-0000000000d4",
  task: FIXTURE_TASK_ID,
  dev: "pixel-9",
  hlc: "2026-11-22T10:15:03.120Z#0001",
  type: "gate.answered",
  data: { gate: "01a2038e-7f00-7000-8000-0000000000d0", version: 1, answer: "1000/min" },
};

/** Valid and invalid samples of `event.v1`. */
export const eventSamples: { name: string; value: unknown; invalidPath?: string }[] = [
  { name: "gate.answered line of docs/workflow.md 9", value: docLine },
  {
    name: "message.agent with no source (an older event)",
    value: event("message.agent", { text: "Done.", session: null }),
  },
  {
    name: "message.agent with the source turn",
    value: event("message.agent", { text: "Done.", session: ID, source: "turn" }),
  },
  {
    name: "message.agent with an unknown source",
    value: event("message.agent", { text: "Done.", session: ID, source: "other" }),
    invalidPath: "data.source",
  },
  {
    name: "message.sent nudge notice",
    value: event("message.sent", {
      id: ID,
      text: "Send the update.",
      to_session: ID2,
      kind: "nudge",
    }),
  },
  {
    name: "session.started with the name and the terminal",
    value: event("session.started", {
      session: ID,
      host: "tmux",
      cwd: "/work/billing-api",
      name: "AW-7",
      terminal: { window: "aw-AW-7", pane: "%12" },
    }),
  },
  {
    name: "task.assigned with the session host orca",
    value: event("task.assigned", { assignee: "claude@ubuntu-01", session_host: "orca" }),
  },
  {
    name: "task.assigned with the session host screen",
    value: event("task.assigned", { assignee: "claude@ubuntu-01", session_host: "screen" }),
    invalidPath: "data.session_host",
  },
  {
    name: "task.assigned with session options",
    value: event("task.assigned", {
      assignee: "claude@ubuntu-01",
      session_options: {
        permission_mode: "skip",
        agent_teams: true,
        work_in: "folder",
        folder: "/work/billing-api/services/api",
      },
    }),
  },
  {
    name: "task.created session options with a relative folder",
    value: event("task.created", {
      key: "AW-7",
      project: "billing-api",
      title: "Export",
      first_message: "Export",
      session_options: { work_in: "folder", folder: "work/api" },
    }),
    invalidPath: "data.session_options.folder",
  },
  {
    name: "task.assigned with the permission mode plan",
    value: event("task.assigned", {
      assignee: "claude@ubuntu-01",
      session_options: { permission_mode: "plan" },
    }),
    invalidPath: "data.session_options.permission_mode",
  },
  {
    name: "gate.opened with no gate id",
    value: event("gate.opened", { kind: "question", version: 1 }),
    invalidPath: "data.gate",
  },
  {
    // The gate of the automatic move is removed (docs/decisions/2026-11-23-manual-move.md).
    name: "gate.opened of kind continue_on_device",
    value: event("gate.opened", {
      gate: ID,
      kind: "continue_on_device",
      version: 1,
      title: "Continue on another device?",
    }),
    invalidPath: "data.kind",
  },
  {
    name: "HLC without ms",
    value: event("task.done", {}, { hlc: "2026-11-22T14:20:01Z#0000" }),
    invalidPath: "hlc",
  },
  {
    name: "device Pixel 9",
    value: event("task.done", {}, { dev: "Pixel 9" }),
    invalidPath: "dev",
  },
  {
    name: "message.human source email",
    value: event("message.human", { text: "x", source: "email", session: ID }),
    invalidPath: "data.source",
  },
  {
    name: "task.claimed epoch 0",
    value: event("task.claimed", { epoch: 0, device: "ubuntu-01", session: ID }),
    invalidPath: "data.epoch",
  },
  {
    name: "knowledge.changed with a short hash",
    value: event("knowledge.changed", { ...validData["knowledge.changed"], hash: "abc" }),
    invalidPath: "data.hash",
  },
  {
    name: "knowledge.suggested with an unknown reason",
    value: event("knowledge.suggested", {
      ...validData["knowledge.suggested"],
      reasons: ["maybe"],
    }),
    invalidPath: "data.reasons.0",
  },
  {
    name: "knowledge.suggestion_resolved with the decision maybe",
    value: event("knowledge.suggestion_resolved", { suggestion: ID2, decision: "maybe" }),
    invalidPath: "data.decision",
  },
  { name: "event v2 of a v1 type", value: event("task.done", {}, { v: 2 }), invalidPath: "v" },
  {
    name: "by with no device",
    value: event("task.done", {}, { by: "human" }),
    invalidPath: "by",
  },
  {
    name: "slot.acquired with a TTL over 24 h",
    value: event("slot.acquired", { ...validData["slot.acquired"], ttl_ms: 86_400_001 }),
    invalidPath: "data.ttl_ms",
  },
  {
    // task and by are optional, not nullable: the key may be absent, but null breaks the type.
    name: "task null",
    value: event("comment.added", validData["comment.added"], { task: null }),
    invalidPath: "task",
  },
  {
    name: "by null",
    value: event("comment.added", validData["comment.added"], { by: null }),
    invalidPath: "by",
  },
];
