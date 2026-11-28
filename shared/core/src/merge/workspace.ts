// The fold of the workspace logs (`tasks/log/<device>.jsonl`): the queue order of each agent, the
// test slot leases and the credential names (docs/architecture.md 4.6.8 and 4.7).
import type { AwEvent } from "@aw/schema";
import { INBOX_EVENT_TYPES, InboxAccumulator } from "./inbox.ts";
import { compareText, hlcMs } from "./order.ts";
import type { LogLine } from "./source.ts";
import { isAfterRevoke, isHuman, type Decision } from "./task.ts";
import type {
  CardView,
  CredentialView,
  QueueView,
  RemovedProjectView,
  SlotView,
  SourceView,
} from "./view.ts";

export interface WorkspaceContext {
  /** The slot resources of a device from its `bindings.yaml`, for example `{k3d: 1}`. */
  resources(device: string): Record<string, number> | undefined;
  /** The `revoked_at` HLC of a revoked device, else undefined. */
  revokedAt?: (device: string) => string | undefined;
}

export interface WorkspaceFold {
  queues: QueueView[];
  slots: SlotView[];
  credentials: CredentialView[];
  /** Each `project.removed` of a person, in merge order. */
  removals: RemovedProjectView[];
  sources: SourceView[];
  cards: CardView[];
  decisions: Map<string, Decision>;
}

/** Folds the workspace events. The caller gives them in merge order. */
export function foldWorkspace(lines: readonly LogLine[], context: WorkspaceContext): WorkspaceFold {
  const queues = new Map<string, QueueView>();
  const leases = new Map<string, SlotView>();
  /** The highest fencing token of each slot: a token never goes back (docs/architecture.md 4.7). */
  const tokens = new Map<string, number>();
  const credentials = new Map<string, CredentialView>();
  const removals: RemovedProjectView[] = [];
  const decisions = new Map<string, Decision>();
  const ok: Decision = { applied: true, reason: null };
  const inbox = new InboxAccumulator();

  for (const line of lines) {
    if (isAfterRevoke(line.event, context.revokedAt)) {
      decisions.set(line.event.id, { applied: false, reason: "device_revoked" });
      continue;
    }
    if (!line.known) {
      decisions.set(line.event.id, { applied: false, reason: "unknown_type" });
      continue;
    }
    const e = line.event as AwEvent;
    const decide = (): Decision => {
      const ref = { event: e.id, dev: e.dev, hlc: e.hlc };
      if (INBOX_EVENT_TYPES.has(e.type)) return inbox.apply(e, ref);
      switch (e.type) {
        case "queue.reordered":
          // The newest order wins (docs/architecture.md 4.6.8).
          queues.set(e.data.agent, { ...ref, agent: e.data.agent, tasks: [...e.data.tasks] });
          return ok;
        case "credential.added":
          credentials.set(e.data.name, {
            name: e.data.name,
            added: ref,
            imported_on: credentials.get(e.data.name)?.imported_on ?? [],
          });
          return ok;
        case "credential.imported": {
          const entry = credentials.get(e.data.name) ?? {
            name: e.data.name,
            added: null,
            imported_on: [],
          };
          if (!entry.imported_on.includes(e.dev)) {
            entry.imported_on = [...entry.imported_on, e.dev].sort(compareText);
          }
          credentials.set(e.data.name, entry);
          return ok;
        }
        case "credential.removed":
          credentials.delete(e.data.name);
          return ok;
        case "project.removed":
          // Only a person removes a project (principle 4, openspec project-remove).
          if (!isHuman(e.by)) return { applied: false, reason: "not_human" };
          removals.push({
            slug: e.data.project,
            name: e.data.name,
            removed: { ...ref, by: e.by! },
            document: structuredClone(e.data.document),
          });
          return ok;
        case "slot.acquired":
        case "slot.renewed":
        case "slot.released":
        case "slot.revoked": {
          // Only the device that has the resource gives out a lease.
          // Own keys only: `constructor` is no resource (the phone uses a map, final check fc1-15).
          const resources = context.resources(e.dev);
          const capacity =
            resources && Object.hasOwn(resources, e.data.resource)
              ? resources[e.data.resource]
              : undefined;
          if (capacity === undefined) return { applied: false, reason: "not_resource_device" };
          if (e.data.slot >= capacity) return { applied: false, reason: "no_such_slot" };
          const id = `${e.dev}/${e.data.resource}/${e.data.slot}`;
          const current = leases.get(id);
          if (e.type === "slot.acquired") {
            if (e.data.fencing_token <= (tokens.get(id) ?? 0)) {
              return { applied: false, reason: "stale_fencing_token" };
            }
            tokens.set(id, e.data.fencing_token);
            leases.set(id, {
              device: e.dev,
              resource: e.data.resource,
              slot: e.data.slot,
              fencing_token: e.data.fencing_token,
              ttl_ms: e.data.ttl_ms,
              task: e.data.task,
              session: e.data.session,
              acquired: ref,
              renewed_hlc: e.hlc,
              expires_at: new Date(hlcMs(e.hlc) + e.data.ttl_ms).toISOString(),
            });
            return ok;
          }
          if (!current || current.fencing_token !== e.data.fencing_token) {
            return { applied: false, reason: "no_such_lease" };
          }
          if (e.type === "slot.renewed") {
            leases.set(id, {
              ...current,
              ttl_ms: e.data.ttl_ms,
              renewed_hlc: e.hlc,
              expires_at: new Date(hlcMs(e.hlc) + e.data.ttl_ms).toISOString(),
            });
          } else {
            leases.delete(id);
          }
          return ok;
        }
        default:
          return { applied: false, reason: "wrong_log" };
      }
    };
    decisions.set(e.id, decide());
  }

  return {
    queues: [...queues.values()].sort((a, b) => compareText(a.agent, b.agent)),
    slots: [...leases.values()].sort(
      (a, b) =>
        compareText(a.device, b.device) || compareText(a.resource, b.resource) || a.slot - b.slot,
    ),
    credentials: [...credentials.values()].sort((a, b) => compareText(a.name, b.name)),
    removals,
    ...inbox.result(),
    decisions,
  };
}
