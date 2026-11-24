// The registry of the schema names `<type>.v<major>` (docs/phase-1.md 3.4).
// A reader accepts the current and the previous major version of each type.
import type { z } from "zod";
import {
  bindingsV1,
  deviceV1,
  healthV1,
  projectV1,
  pushV1,
  taskV1,
  testServersV1,
  workspaceV1,
} from "./documents.ts";
import { eventDataV1, eventSchemasV1, eventV1, heartbeatV1, type EventType } from "./events.ts";

/** The document schema of each kind and major version. */
export const documentSchemas = {
  workspace: { 1: workspaceV1 },
  project: { 1: projectV1 },
  task: { 1: taskV1 },
  device: { 1: deviceV1 },
  health: { 1: healthV1 },
  bindings: { 1: bindingsV1 },
  "test-servers": { 1: testServersV1 },
  push: { 1: pushV1 },
} as const;

export type DocumentKind = keyof typeof documentSchemas;
export const documentKinds = Object.keys(documentSchemas) as DocumentKind[];

/** The current major version of each document kind. */
export const currentDocumentMajor: Record<DocumentKind, number> = {
  workspace: 1,
  project: 1,
  task: 1,
  device: 1,
  health: 1,
  bindings: 1,
  "test-servers": 1,
  push: 1,
};

/** The typed value of each document kind, current major version. */
export interface DocumentOf {
  workspace: z.infer<typeof workspaceV1>;
  project: z.infer<typeof projectV1>;
  task: z.infer<typeof taskV1>;
  device: z.infer<typeof deviceV1>;
  health: z.infer<typeof healthV1>;
  bindings: z.infer<typeof bindingsV1>;
  "test-servers": z.infer<typeof testServersV1>;
  push: z.infer<typeof pushV1>;
}

/** The input value of each document kind: fields with a default are optional. */
export interface DocumentInputOf {
  workspace: z.input<typeof workspaceV1>;
  project: z.input<typeof projectV1>;
  task: z.input<typeof taskV1>;
  device: z.input<typeof deviceV1>;
  health: z.input<typeof healthV1>;
  bindings: z.input<typeof bindingsV1>;
  "test-servers": z.input<typeof testServersV1>;
  push: z.input<typeof pushV1>;
}

/** The current major version of each event type. */
export const currentEventMajor = Object.fromEntries(
  Object.keys(eventDataV1).map((type) => [type, 1]),
) as Record<EventType, number>;

/**
 * The full event schema of each major version, by type. A reader uses the schema of the major of
 * each line, so it reads the current and the previous major. Add a new major version here.
 */
export const eventSchemas: Record<number, Partial<Record<string, z.ZodType>>> = {
  1: eventSchemasV1,
};

/** The schema of an event type and major version, or undefined when AW has none. */
export function eventSchema(type: EventType, major: number): z.ZodType | undefined {
  return eventSchemas[major]?.[type];
}

export function isDocumentKind(kind: unknown): kind is DocumentKind {
  return typeof kind === "string" && Object.hasOwn(documentSchemas, kind);
}

export function isEventType(type: unknown): type is EventType {
  return typeof type === "string" && Object.hasOwn(eventDataV1, type);
}

/** How a reader treats a file of a major version: read it, or report it. */
export type VersionStatus = "current" | "previous" | "newer" | "unsupported";

export function versionStatus(current: number, found: number): VersionStatus {
  if (found === current) return "current";
  if (found === current - 1) return "previous";
  if (found > current) return "newer";
  return "unsupported";
}

/** The schema of a document kind and major version, or undefined when AW has none. */
export function documentSchema(kind: DocumentKind, major: number): z.ZodType | undefined {
  const versions: Partial<Record<number, z.ZodType>> = documentSchemas[kind];
  return versions[major];
}

/** One generated schema file: `<name>.schema.json`. */
export interface SchemaEntry {
  /** `<type>.v<major>`, for example `task.v1`. */
  name: string;
  title: string;
  schema: z.ZodType;
}

/** Each schema that `pnpm schema:generate` writes. Add a new major version here. */
export const schemaEntries: SchemaEntry[] = [
  { name: "workspace.v1", title: "AW workspace.yaml", schema: workspaceV1 },
  { name: "project.v1", title: "AW project.yaml", schema: projectV1 },
  { name: "task.v1", title: "AW task.yaml", schema: taskV1 },
  { name: "device.v1", title: "AW device.yaml", schema: deviceV1 },
  { name: "health.v1", title: "AW health.yaml", schema: healthV1 },
  { name: "bindings.v1", title: "AW bindings.yaml", schema: bindingsV1 },
  { name: "test-servers.v1", title: "AW test-servers.yaml", schema: testServersV1 },
  { name: "push.v1", title: "AW push.yaml", schema: pushV1 },
  { name: "event.v1", title: "AW event (one JSON Lines line)", schema: eventV1 },
  { name: "heartbeat.v1", title: "AW heartbeat line", schema: heartbeatV1 },
];
