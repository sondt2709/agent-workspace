// The queues of a workspace for the person route, the CLI and the desktop (openspec
// queue-and-assign): the queue rule over the merged view, the presence and the health files, and
// the tasks with no assignee with their creator.
import type { QueuesReply } from "@aw/client/queues";
import type { EventRow } from "@aw/core";
import { agentQueues, queueTask, type QueueDevice } from "../continuity/queue-view.ts";
import type { WorkspaceService } from "./workspace.ts";

/** True for the `by` of an agent: set, and not a person (`human@<device>`). The push loop calls it too. */
export function isAgentAuthor(by: string | null | undefined): boolean {
  return typeof by === "string" && by !== "" && !by.startsWith("human@");
}

export function queuesView(ws: WorkspaceService, now: number): QueuesReply {
  const view = ws.view;
  const me = ws.device.slug;
  const online = new Map((ws.presence?.devices ?? []).map((d) => [d.device, d.online]));
  const slugs = new Set([...view.devices.map((d) => d.slug), me]);
  const devices: QueueDevice[] = [...slugs].map((slug) => ({
    slug,
    revoked: view.devices.find((d) => d.slug === slug)?.revoked === true,
    // This device runs: it is never offline for itself.
    online: slug === me ? true : (online.get(slug) ?? null),
    health: ws.lastValidDocument(`tasks/devices/${slug}/health.yaml`)?.value ?? null,
  }));
  const agents = agentQueues({
    tasks: view.tasks.map(queueTask),
    orders: view.queues,
    devices,
    now,
  });
  const unassigned = view.tasks
    .filter((t) => t.created !== null && !t.archived && t.stage !== "done" && t.assignee === null)
    .map((t) => {
      const row = ws.index.find<EventRow>("events", { id: t.created!.event })[0];
      const by = (row?.event as { by?: string } | undefined)?.by ?? null;
      return {
        task: t.id,
        key: t.key,
        title: t.title,
        created_by: by,
        by_agent: isAgentAuthor(by),
      };
    });
  return { device: me, agents, unassigned };
}
