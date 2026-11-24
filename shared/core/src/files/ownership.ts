// The write guard: the files layer refuses a write to a file that this device does not own
// (docs/architecture.md 4.3.1, docs/phase-1.md 3.1 and 4.1).
import type { DeviceRole, DocumentKind } from "@aw/schema";
import { WriteRefusedError } from "./errors.ts";

/** Who may write a file. */
export type Writer =
  /** Only this device. */
  | { type: "device"; device: string }
  /** Any device: a shared file. The priority rule resolves conflicts (docs/architecture.md 4.3.2). */
  | { type: "shared" }
  /** A device with the master key: the device records. */
  | { type: "master-key" }
  /** The owner device of the task: the highest `task.claimed` epoch, else the creating device. */
  | { type: "task-owner"; task: string };

/** The kind of a JSON Lines log: which event types it holds (docs/phase-1.md 3.1). */
export type LogKind = "task" | "workspace" | "knowledge" | "heartbeat";

/** A field of a document that must be the same as a part of its path. */
export interface DocumentIdentity {
  /** The field name, for example `id` in `task.yaml` or `device` in `health.yaml`. */
  field: "id" | "slug" | "device";
  /** The value from the path: the task id, the project slug or the device slug of the folder. */
  value: string;
}

export interface PathInfo {
  /** The normalized path relative to the workspace root, with `/` separators. */
  path: string;
  /** The Syncthing folder: `tasks`, `knowledge` or `secure`. */
  folder: "tasks" | "knowledge" | "secure";
  /** The name of the rule in the layout, for example `task-log`. */
  rule: string;
  writer: Writer;
  /** A YAML document of this kind, a JSON Lines log, or another file. */
  format:
    | { type: "document"; kind: DocumentKind }
    | { type: "log"; device: string; log: LogKind }
    | { type: "file" };
  /** The field of the document that names its folder. Readers and writers compare it. */
  identity?: DocumentIdentity;
  /** The task id of a path in a task folder. */
  task?: string;
  /** The file is written once and never changed (`approach/v<n>.md`). */
  writeOnce?: boolean;
  /** Only computers have the `secure` folder (docs/decisions/2026-11-22-device-sync.md, sync 1). */
  computersOnly?: boolean;
}

const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const UUID7 = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const NAME = "[a-z0-9]+(?:[-_.][a-z0-9]+)*";
const ANY = "[^/]+(?:/[^/]+)*";

interface Rule {
  name: string;
  pattern: RegExp;
  info: (m: Record<string, string>) => Omit<PathInfo, "path" | "folder" | "rule">;
}

const device = (d: string): Writer => ({ type: "device", device: d });
const shared: Writer = { type: "shared" };
const file = { type: "file" } as const;
const doc = (kind: DocumentKind) => ({ type: "document", kind }) as const;
const log = (d: string, kind: LogKind) => ({ type: "log", device: d, log: kind }) as const;

// The table of docs/phase-1.md 3.1. A path that no rule matches is not in the AW folder layout.
const rules: Rule[] = [
  {
    name: "workspace",
    pattern: /^tasks\/workspace\.yaml$/,
    info: () => ({ writer: shared, format: doc("workspace") }),
  },
  {
    name: "workspace-log",
    pattern: new RegExp(`^tasks/log/(?<d>${SLUG})\\.jsonl$`),
    info: (m) => ({ writer: device(m.d!), format: log(m.d!, "workspace") }),
  },
  {
    name: "schema-file",
    pattern: new RegExp(`^tasks/schemas/${NAME}\\.v[1-9][0-9]*\\.schema\\.json$`),
    info: () => ({ writer: shared, format: file }),
  },
  {
    name: "device-record",
    pattern: new RegExp(`^tasks/devices/(?<d>${SLUG})/device\\.yaml$`),
    info: (m) => ({
      writer: { type: "master-key" },
      format: doc("device"),
      identity: { field: "slug", value: m.d! },
    }),
  },
  {
    name: "device-health",
    pattern: new RegExp(`^tasks/devices/(?<d>${SLUG})/health\\.yaml$`),
    info: (m) => ({
      writer: device(m.d!),
      format: doc("health"),
      identity: { field: "device", value: m.d! },
    }),
  },
  {
    name: "device-bindings",
    pattern: new RegExp(`^tasks/devices/(?<d>${SLUG})/bindings\\.yaml$`),
    info: (m) => ({
      writer: device(m.d!),
      format: doc("bindings"),
      identity: { field: "device", value: m.d! },
    }),
  },
  {
    name: "device-push",
    pattern: new RegExp(`^tasks/devices/(?<d>${SLUG})/push\\.yaml$`),
    info: (m) => ({ writer: device(m.d!), format: file }),
  },
  {
    name: "device-heartbeat",
    pattern: new RegExp(`^tasks/devices/(?<d>${SLUG})/heartbeat/\\d{4}-\\d{2}-\\d{2}\\.jsonl$`),
    info: (m) => ({ writer: device(m.d!), format: log(m.d!, "heartbeat") }),
  },
  {
    name: "device-sealed",
    pattern: new RegExp(`^tasks/devices/(?<d>${SLUG})/sealed/${NAME}\\.age$`),
    info: (m) => ({ writer: device(m.d!), format: file }),
  },
  {
    name: "project",
    pattern: new RegExp(`^tasks/projects/(?<p>${SLUG})/project\\.yaml$`),
    info: (m) => ({
      writer: shared,
      format: doc("project"),
      identity: { field: "slug", value: m.p! },
    }),
  },
  {
    name: "task-snapshot",
    pattern: new RegExp(`^tasks/(?<t>${UUID7})/task\\.yaml$`),
    info: (m) => ({
      writer: { type: "task-owner", task: m.t! },
      format: doc("task"),
      task: m.t!,
      identity: { field: "id", value: m.t! },
    }),
  },
  {
    name: "task-log",
    pattern: new RegExp(`^tasks/(?<t>${UUID7})/log/(?<d>${SLUG})\\.jsonl$`),
    info: (m) => ({ writer: device(m.d!), format: log(m.d!, "task"), task: m.t! }),
  },
  {
    name: "task-approach",
    pattern: new RegExp(`^tasks/(?<t>${UUID7})/approach/v[1-9][0-9]*\\.md$`),
    info: (m) => ({
      writer: { type: "task-owner", task: m.t! },
      format: file,
      task: m.t!,
      writeOnce: true,
    }),
  },
  {
    name: "task-artifact",
    pattern: new RegExp(`^tasks/(?<t>${UUID7})/artifacts/(?<d>${SLUG})/${ANY}$`),
    info: (m) => ({ writer: device(m.d!), format: file, task: m.t! }),
  },
  {
    name: "task-terminal",
    pattern: new RegExp(`^tasks/(?<t>${UUID7})/terminal/(?<d>${SLUG})\\.txt$`),
    info: (m) => ({ writer: device(m.d!), format: file, task: m.t! }),
  },
  {
    name: "knowledge-log",
    pattern: new RegExp(`^knowledge/log/(?<d>${SLUG})\\.jsonl$`),
    info: (m) => ({ writer: device(m.d!), format: log(m.d!, "knowledge") }),
  },
  {
    name: "knowledge-file",
    pattern: new RegExp(`^knowledge/(?:shared|projects/${SLUG})/${ANY}$`),
    info: () => ({ writer: shared, format: file }),
  },
  {
    name: "test-servers",
    pattern: /^secure\/test-servers\.yaml$/,
    info: () => ({ writer: shared, format: doc("test-servers"), computersOnly: true }),
  },
  {
    name: "credential",
    pattern: new RegExp(`^secure/credentials/${NAME}\\.age$`),
    info: () => ({ writer: shared, format: file, computersOnly: true }),
  },
  {
    // The workspace credential key sealed to the device key of one computer (task-model §4).
    name: "credential-key",
    pattern: new RegExp(`^secure/keys/(?<d>${SLUG})\\.age$`),
    info: () => ({ writer: shared, format: file, computersOnly: true }),
  },
];

/** Normalizes a path relative to the workspace root, or returns the reason why it is not valid. */
function normalize(path: string): { path: string } | { reason: string } {
  const unified = path.split("\\").join("/");
  if (unified.startsWith("/") || /^[A-Za-z]:/.test(unified)) {
    return { reason: "use a path relative to the workspace root" };
  }
  const parts = unified.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.includes("..")) return { reason: "a path with '..' is not allowed" };
  return { path: parts.join("/") };
}

/** Maps a path to its rule in the AW folder layout, or returns the reason why it has none. */
export function classifyPath(path: string): PathInfo | { reason: string; path: string } {
  const normal = normalize(path);
  if ("reason" in normal) return { reason: normal.reason, path };
  // The sync engine ignores these names, so a file in a folder with such a name never syncs.
  const parts = normal.path.split("/");
  if (parts.some((part) => part.endsWith(".aw-tmp")))
    return { reason: "a temp file name (*.aw-tmp) is not allowed", path: normal.path };
  if (parts.some((part) => part.includes(".sync-conflict-"))) {
    return { reason: "a conflict copy name (*.sync-conflict-*) is not allowed", path: normal.path };
  }
  for (const rule of rules) {
    const match = rule.pattern.exec(normal.path);
    if (match) {
      const folder = normal.path.split("/")[0] as PathInfo["folder"];
      return { path: normal.path, folder, rule: rule.name, ...rule.info(match.groups ?? {}) };
    }
  }
  return {
    reason: "the path is not in the AW folder layout (docs/phase-1.md 3.1)",
    path: normal.path,
  };
}

export interface WriterContext {
  /** The slug of this device. */
  device: string;
  role: DeviceRole;
  /** True when this device holds the master key (the local device or the phone). */
  hasMasterKey: boolean;
  /** The owner device of a task, from the merged logs. Undefined when this device does not know it. */
  taskOwner?: (task: string) => string | undefined;
}

export interface WriteCheck {
  /** True when the file exists. A write-once file refuses a second write. */
  exists: boolean;
}

/** Returns the path info when this device may write the file, else throws WriteRefusedError. */
export function checkWrite(path: string, context: WriterContext, check: WriteCheck): PathInfo {
  const info = classifyPath(path);
  if ("reason" in info) throw new WriteRefusedError({ path: info.path }, info.reason);
  const refuse = (rule: string) => new WriteRefusedError({ path: info.path }, rule);

  if (info.computersOnly && context.role === "mobile") {
    throw refuse("the secure folder is on computers only, never on a mobile device");
  }
  const writer = info.writer;
  switch (writer.type) {
    case "shared":
      break;
    case "device":
      if (writer.device !== context.device) {
        throw refuse(
          `only ${writer.device} writes this file (${info.rule}), not ${context.device}`,
        );
      }
      break;
    case "master-key":
      if (!context.hasMasterKey)
        throw refuse("only a device with the master key writes a device record");
      break;
    case "task-owner": {
      const owner = context.taskOwner?.(writer.task);
      if (owner === undefined) throw refuse(`the owner device of task ${writer.task} is not known`);
      if (owner !== context.device) {
        throw refuse(
          `only the owner device ${owner} of task ${writer.task} writes this file, not ${context.device}`,
        );
      }
      break;
    }
  }
  if (info.writeOnce && check.exists)
    throw refuse("an approach version is written once and never changed");
  return info;
}
