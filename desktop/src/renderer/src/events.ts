// awd events in the renderer: each `changed` message invalidates the queries that it touches, and
// `resync` invalidates all queries (docs/tech-stack.md 2.4).
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import type { ConnectionState, StreamMessage } from "../../shared/channels.ts";
import { bridge, call } from "./bridge.ts";
import { keys } from "./queries.ts";

/** Invalidates the queries that one event stream message touches. */
export async function applyStreamMessage(
  client: QueryClient,
  message: StreamMessage,
): Promise<void> {
  if (message.type === "hello") return;
  const targets: QueryKey[] = [keys.workspaces()];
  if (message.type === "notice") {
    await client.invalidateQueries({ queryKey: keys.workspaces() });
    return;
  }
  const ws = message.workspace;
  if (message.full || message.workspace_changed) {
    targets.push(keys.ws(ws), keys.sessions(), keys.status());
  } else {
    targets.push(keys.taskLists(ws), keys.gateLists(ws), keys.sessions(), keys.issues(ws));
    // A task change can move the agent queues (openspec queue-and-assign).
    targets.push(keys.queues(ws));
    // Knowledge, the files of a task and the sync state change with the same writes.
    targets.push(keys.kb(ws), keys.taskFilesAll(ws), keys.sync());
    if (message.documents_changed) {
      targets.push(keys.projects(ws), keys.devices(ws), keys.sessionHosts(ws));
    }
    for (const task of message.tasks) targets.push(keys.task(ws, task), keys.thread(ws, task));
  }
  const work = targets.map((queryKey) => client.invalidateQueries({ queryKey }));
  if (!message.full && !message.workspace_changed && message.tasks.length > 0) {
    // A subtask thread shows the threads of its parents ("original conversation"): a change of a
    // parent refreshes it too (desktop-shell review, workflow 2).
    const changedTasks = new Set(message.tasks);
    work.push(
      client.invalidateQueries({
        queryKey: keys.ws(ws),
        predicate: (query) => {
          const data = query.state.data as { ancestors?: { task?: { id?: string } }[] } | undefined;
          return (
            query.queryKey[3] === "thread" &&
            (data?.ancestors ?? []).some((a) => changedTasks.has(a.task?.id ?? ""))
          );
        },
      }),
    );
  }
  await Promise.all(work);
}

/** Connects the bridge events to the query client. Mount it once at the root. */
export function useBridgeEvents(): void {
  const client = useQueryClient();
  useEffect(() => {
    const offEvent = bridge().onEvent((message) => void applyStreamMessage(client, message));
    const offResync = bridge().onResync(() => void client.invalidateQueries());
    return () => {
      offEvent();
      offResync();
    };
  }, [client]);
}

// ---- Connection state: one store for the app, fed by the bridge ----

let connection: ConnectionState = { state: "connecting" };
const listeners = new Set<() => void>();
let started = false;

function setConnection(state: ConnectionState): void {
  connection = state;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!started) {
    started = true;
    bridge().onConnection(setConnection);
    call("connection", {}).then(setConnection, () => undefined);
  }
  return () => listeners.delete(listener);
}

/** The state of the awd connection of main. */
export function useConnection(): ConnectionState {
  return useSyncExternalStore(subscribe, () => connection);
}
