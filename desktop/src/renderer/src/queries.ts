// TanStack Query keys and hooks: the only store of awd data in the renderer (docs/tech-stack.md
// 2.4). Each queryFn calls the bridge. Events invalidate the keys (events.ts).
import { gateContext, PROPOSAL_TEXT } from "@aw/client/gates";
import { sourceInputOf, type SourceInput } from "@aw/client/inbox-api";
import { deviceNames, withPresencePause } from "@aw/client/pause";
import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type {
  AnswerInput,
  AppSettings,
  CreateTaskInput,
  EventRow,
  GateListQuery,
  SessionOptionsInput,
  Task,
  TaskListQuery,
  TerminalAction,
} from "../../shared/channels.ts";
import { call } from "./bridge.ts";
import { WORK_TYPES } from "./model.ts";
import { queueIndex } from "./queue-model.ts";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
        retry: 0,
      },
      mutations: { networkMode: "always", retry: 0 },
    },
  });
}

export const keys = {
  all: ["aw"] as const,
  status: () => ["aw", "status"] as const,
  workspaces: () => ["aw", "workspaces"] as const,
  sessions: () => ["aw", "sessions"] as const,
  ws: (ws: string) => ["aw", "ws", ws] as const,
  projects: (ws: string) => ["aw", "ws", ws, "projects"] as const,
  taskLists: (ws: string) => ["aw", "ws", ws, "tasks"] as const,
  tasks: (ws: string, query: TaskListQuery = {}) => ["aw", "ws", ws, "tasks", query] as const,
  task: (ws: string, task: string) => ["aw", "ws", ws, "task", task] as const,
  thread: (ws: string, task: string) => ["aw", "ws", ws, "thread", task] as const,
  gateLists: (ws: string) => ["aw", "ws", ws, "gates"] as const,
  gates: (ws: string, query: GateListQuery = {}) => ["aw", "ws", ws, "gates", query] as const,
  // ---- add-desktop-devices-knowledge ----
  sync: () => ["aw", "sync"] as const,
  identity: () => ["aw", "identity"] as const,
  appSettings: () => ["aw", "app-settings"] as const,
  phraseConfirmed: (user: string) => ["aw", "phrase-confirmed", user] as const,
  devices: (ws: string) => ["aw", "ws", ws, "devices"] as const,
  presence: (ws: string) => ["aw", "ws", ws, "presence"] as const,
  sessionHosts: (ws: string) => ["aw", "ws", ws, "session-hosts"] as const,
  queues: (ws: string) => ["aw", "ws", ws, "queues"] as const,
  credentials: (ws: string) => ["aw", "ws", ws, "credentials"] as const,
  issues: (ws: string) => ["aw", "ws", ws, "issues"] as const,
  kb: (ws: string) => ["aw", "ws", ws, "kb"] as const,
  kbList: (ws: string, scope: string, project: string | null) =>
    ["aw", "ws", ws, "kb", "list", scope, project] as const,
  kbFile: (ws: string, path: string) => ["aw", "ws", ws, "kb", "file", path] as const,
  kbHistory: (ws: string, path: string) => ["aw", "ws", ws, "kb", "history", path] as const,
  kbSuggestions: (ws: string) => ["aw", "ws", ws, "kb", "suggestions"] as const,
  kbDigest: (ws: string) => ["aw", "ws", ws, "kb", "digest"] as const,
  taskFilesAll: (ws: string) => ["aw", "ws", ws, "files"] as const,
  taskFiles: (ws: string, task: string) => ["aw", "ws", ws, "files", task] as const,
  terminal: (ws: string, task: string) => ["aw", "ws", ws, "terminal", task] as const,
  gateNotice: (ws: string, task: string) => ["aw", "ws", ws, "gate-notice", task] as const,
  taskFile: (ws: string, task: string, path: string) =>
    ["aw", "ws", ws, "files", task, path] as const,
  // ---- openspec inbox-mattermost ----
  inbox: (ws: string) => ["aw", "ws", ws, "inbox"] as const,
  cards: (ws: string) => ["aw", "ws", ws, "inbox", "cards"] as const,
  sources: (ws: string) => ["aw", "ws", ws, "inbox", "sources"] as const,
  sourceStatus: (ws: string, source: string) =>
    ["aw", "ws", ws, "inbox", "status", source] as const,
  conversations: (ws: string, source: string) =>
    ["aw", "ws", ws, "inbox", "conversations", source] as const,
};

export const useStatus = () =>
  useQuery({ queryKey: keys.status(), queryFn: () => call("status", {}) });

export const useWorkspaces = () =>
  useQuery({ queryKey: keys.workspaces(), queryFn: () => call("workspaces", {}) });

export const useSessions = () =>
  useQuery({ queryKey: keys.sessions(), queryFn: () => call("sessions", {}) });

export const useProjects = (ws: string | undefined) =>
  useQuery({
    queryKey: keys.projects(ws ?? ""),
    queryFn: () => call("projects", { ws: ws! }),
    enabled: !!ws,
  });

/**
 * The pause from the presence (openspec move-paused-task): a task of an offline device shows
 * "Paused · MacBook Pro offline". The presence changes with no file change, so its query reads it
 * again every 10 s, and the task queries apply it in `select`.
 */
function usePresencePause(ws: string | undefined) {
  const presence = usePresence(ws).data;
  const devices = useDevices(ws).data;
  return useCallback(
    (tasks: Task[]) =>
      withPresencePause(
        tasks,
        presence,
        deviceNames(devices?.filter((d) => d.state !== "bad_signature")),
      ),
    [presence, devices],
  );
}

export const useTasks = (ws: string | undefined, query: TaskListQuery = {}) => {
  const pause = usePresencePause(ws);
  return useQuery({
    queryKey: keys.tasks(ws ?? "", query),
    queryFn: () => call("tasks", { ws: ws!, query }),
    enabled: !!ws,
    select: pause,
  });
};

export const useTask = (ws: string | undefined, task: string | undefined) => {
  const pause = usePresencePause(ws);
  const select = useCallback((one: Task) => pause([one])[0]!, [pause]);
  return useQuery({
    queryKey: keys.task(ws ?? "", task ?? ""),
    queryFn: () => call("task", { ws: ws!, task: task! }),
    enabled: !!ws && !!task,
    select,
  });
};

/** The events of one page of the thread window (fix list 0-7). */
export const THREAD_PAGE = 500;

/**
 * The thread window of a task (fix list 0-7, prd TSK-24): the newest `pages` × 500 events, oldest
 * first, with the threads of its parents. One query reads the newest page and then each older page
 * with `before`, so a refresh gives one list with no gap. `prev` is null when no older event exists.
 */
export const useThread = (ws: string | undefined, task: string | undefined, pages = 1) =>
  useQuery({
    queryKey: [...keys.thread(ws ?? "", task ?? ""), "window", pages],
    queryFn: async () => {
      const reply = await call("thread", {
        ws: ws!,
        task: task!,
        query: { limit: THREAD_PAGE, newest: "true", ancestors: "true" },
      });
      let events = reply.events;
      let prev = reply.prev;
      for (let page = 1; page < pages && prev; page++) {
        const older = await call("thread", {
          ws: ws!,
          task: task!,
          query: { limit: THREAD_PAGE, before: prev },
        });
        events = [...older.events, ...events];
        prev = older.prev;
      }
      return { ...reply, events, prev };
    },
    enabled: !!ws && !!task,
    placeholderData: (previous) => previous,
  });

/**
 * The work events of a task (gate-full-context decision 3): each `gate.opened`, `proposal.proposed`,
 * `result.posted` and `artifact.added`, the newest 1000. The gate cards and the fields read them,
 * so a long thread never hides the text of a gate.
 */
export const useWorkEvents = (ws: string | undefined, task: string | undefined) =>
  useQuery({
    queryKey: [...keys.thread(ws ?? "", task ?? ""), "work"],
    queryFn: () =>
      call("thread", {
        ws: ws!,
        task: task!,
        query: { limit: 1000, newest: "true", types: WORK_TYPES },
      }),
    enabled: !!ws && !!task,
  });

/** The events that the context of a gate reads: the 200 before its `gate.opened` (gate-context). */
export const CONTEXT_EVENTS = 200;

/**
 * The context of a gate with no body (openspec gate-context, design decision 3): the agent messages
 * after the last person event before the `gate.opened` row, oldest first. One thread read of the
 * events just before the gate; it runs only when `enabled`.
 */
export const useGateContext = (
  ws: string,
  task: string,
  opened: EventRow | null,
  enabled: boolean,
) =>
  useQuery({
    queryKey: [...keys.thread(ws, task), "gate-context", opened],
    queryFn: async () => {
      const gate = opened!;
      const reply = await call("thread", {
        ws,
        task,
        query: { limit: CONTEXT_EVENTS, before: `${gate.hlc}~${gate.dev}~${gate.id}` },
      });
      const rows = [...reply.events, gate];
      const found = gateContext(
        rows.map((r) => ({
          id: r.id,
          type: r.type,
          by: r.event.by ?? null,
          text: typeof r.event.data.text === "string" ? r.event.data.text : null,
        })),
        gate.id,
      );
      return found.map((c) => rows.find((r) => r.id === c.id)!);
    },
    enabled: enabled && opened !== null,
  });

/** The gate notice of a task (gate-full-context decision 8): it stays after the card closes. */
export function useGateNotice(ws: string, task: string) {
  const client = useQueryClient();
  const queryKey = useMemo(() => keys.gateNotice(ws, task), [ws, task]);
  const query = useQuery({
    queryKey,
    queryFn: ({ queryKey: key }) => client.getQueryData<string | null>(key) ?? null,
  });
  const set = useCallback(
    (text: string | null) => client.setQueryData(queryKey, text),
    [client, queryKey],
  );
  return [query.data ?? null, set] as const;
}

/**
 * The ids of the tasks of `ws` that have a gate notice. The Inbox keeps the card of such a task
 * after its gate closes, so the person sees why AW did not use the answer.
 */
export function useGateNoticeTasks(ws: string): ReadonlySet<string> {
  const cache = useQueryClient().getQueryCache();
  const read = useCallback(
    () =>
      cache
        .findAll({ queryKey: ["aw", "ws", ws, "gate-notice"] })
        .filter((q) => typeof q.state.data === "string" && q.state.data.length > 0)
        .map((q) => String(q.queryKey[4]))
        .sort()
        .join("\n"),
    [cache, ws],
  );
  const ids = useSyncExternalStore(
    useCallback((done) => cache.subscribe(done), [cache]),
    read,
  );
  return useMemo(() => new Set(ids ? ids.split("\n") : []), [ids]);
}

/** Invalidates what a write of one task changes. */
function useTaskWrite<A, R>(
  ws: string,
  fn: (args: A) => Promise<R>,
  taskOf: (args: A) => string | null,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: async (_data, _error, args) => {
      const task = taskOf(args);
      const targets: QueryKey[] = [keys.taskLists(ws), keys.gateLists(ws), keys.workspaces()];
      if (task) targets.push(keys.task(ws, task), keys.thread(ws, task));
      await Promise.all(targets.map((queryKey) => client.invalidateQueries({ queryKey })));
    },
  });
}

export const useAnswerGate = (ws: string, task: string) =>
  useTaskWrite(
    ws,
    (args: { gate: string; body: AnswerInput }) => call("answerGate", { ws, ...args }),
    () => task,
  );

export const useAssignTask = (ws: string) =>
  useTaskWrite(
    ws,
    (args: {
      task: string;
      assignee: string;
      session_host?: "tmux" | "orca";
      session_options?: SessionOptionsInput;
    }) => call("assignTask", { ws, ...args }),
    (args) => args.task,
  );

export const useSendMessage = (ws: string, task: string) =>
  useTaskWrite(
    ws,
    (text: string) => call("sendMessage", { ws, task, text }),
    () => task,
  );

/** Archives a task; `stop` stops a running session first (openspec task-actions). */
export const useArchiveTask = (ws: string) =>
  useTaskWrite(
    ws,
    (args: { task: string; stop: boolean }) => call("archiveTask", { ws, ...args }),
    (args) => args.task,
  );

export const useUnarchiveTask = (ws: string) =>
  useTaskWrite(
    ws,
    (task: string) => call("unarchiveTask", { ws, task }),
    (task) => task,
  );

export const useCreateTask = (ws: string) =>
  useTaskWrite(
    ws,
    (body: CreateTaskInput) => call("createTask", { ws, body }),
    () => null,
  );

/** Stop session on any device: awd writes `session.stop_requested` (openspec task-actions). */
export const useStopTaskSession = (ws: string, task: string) =>
  useTaskWrite(
    ws,
    () => call("stopTaskSession", { ws, task }),
    () => task,
  );

// ---- Devices, sync, pairing, credentials (add-desktop-devices-knowledge) ----

export const useSyncStatus = (refetchMs: number | false = false) =>
  useQuery({
    queryKey: keys.sync(),
    queryFn: () => call("syncStatus", {}),
    refetchInterval: refetchMs,
  });

export const useIdentity = () =>
  useQuery({ queryKey: keys.identity(), queryFn: () => call("identity", {}) });

export const useAppSettings = () =>
  useQuery({ queryKey: keys.appSettings(), queryFn: () => call("appSettings", {}) });

/**
 * The text size of a proposal on this device (openspec proposal-and-discussion, design decision 7)
 * and the function that saves a new size. The card and the full screen view use the new size at
 * once; main saves it as `proposal_text_px` in `aw-desktop.json`.
 */
export function useProposalTextSize(): [number, (px: number) => void] {
  const client = useQueryClient();
  const settings = useAppSettings();
  const save = useMutation({
    mutationFn: (px: number) => call("setProposalTextSize", { px }),
    onMutate: (px) => {
      const before = client.getQueryData<AppSettings>(keys.appSettings());
      if (before) client.setQueryData(keys.appSettings(), { ...before, proposal_text_px: px });
      return { before };
    },
    onSuccess: (data) => client.setQueryData(keys.appSettings(), data),
    onError: (_error, _px, context) => {
      if (context?.before) client.setQueryData(keys.appSettings(), context.before);
    },
  });
  const px = settings.data?.proposal_text_px ?? PROPOSAL_TEXT.default;
  return [px, save.mutate];
}

export const usePhraseConfirmed = (user: string | null | undefined) =>
  useQuery({
    queryKey: keys.phraseConfirmed(user ?? ""),
    queryFn: () => call("phraseConfirmed", { user: user! }),
    enabled: !!user,
  });

export const useDevices = (ws: string | undefined) =>
  useQuery({
    queryKey: keys.devices(ws ?? ""),
    queryFn: () => call("devices", { ws: ws! }),
    enabled: !!ws,
  });

/** Presence moves with the heartbeats (every 30 s), so the page reads it again every 10 s. */
export const usePresence = (ws: string | undefined) =>
  useQuery({
    queryKey: keys.presence(ws ?? ""),
    queryFn: () => call("presence", { ws: ws! }),
    enabled: !!ws,
    refetchInterval: 10_000,
  });

/**
 * The session hosts of each computer (integrate-ui): `use_orca` and the checkout hosts change with
 * the bindings, so a `changed` event of the workspace reads them again.
 */
export const useSessionHosts = (ws: string | undefined) =>
  useQuery({
    queryKey: keys.sessionHosts(ws ?? ""),
    queryFn: () => call("sessionHosts", { ws: ws! }),
    enabled: !!ws,
  });

export const useCredentials = (ws: string | undefined) =>
  useQuery({
    queryKey: keys.credentials(ws ?? ""),
    queryFn: () => call("credentials", { ws: ws! }),
    enabled: !!ws,
  });

export const useIssues = (ws: string | undefined) =>
  useQuery({
    queryKey: keys.issues(ws ?? ""),
    queryFn: () => call("issues", { ws: ws! }),
    enabled: !!ws,
  });

/** A mutation that invalidates `targets` when it ends. */
export function useWrite<A, R>(fn: (args: A) => Promise<R>, targets: () => QueryKey[]) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: async () => {
      await Promise.all(targets().map((queryKey) => client.invalidateQueries({ queryKey })));
    },
  });
}

export const useSyncNow = () =>
  useWrite(
    (timeout_ms?: number) => call("syncNow", timeout_ms === undefined ? {} : { timeout_ms }),
    () => [keys.sync()],
  );

export const useRevokeDevice = (ws: string) =>
  useWrite(
    (device: string) => call("revokeDevice", { ws, device }),
    () => [keys.devices(ws), keys.sync(), keys.credentials(ws), keys.taskLists(ws)],
  );

export const useAddCredential = (ws: string) =>
  useWrite(
    (args: { name: string; value: string }) => call("addCredential", { ws, ...args }),
    () => [keys.credentials(ws)],
  );

export const useRemoveCredential = (ws: string) =>
  useWrite(
    (name: string) => call("removeCredential", { ws, name }),
    () => [keys.credentials(ws)],
  );

// ---- Knowledge ----

export const useKbList = (
  ws: string,
  scope: "shared" | "project" | "all",
  project: string | null,
  enabled = true,
) =>
  useQuery({
    enabled,
    queryKey: keys.kbList(ws, scope, project),
    queryFn: () =>
      call("kbList", { ws, scope, ...(project && scope !== "shared" ? { project } : {}) }),
  });

export const useKbFile = (ws: string, path: string | null) =>
  useQuery({
    queryKey: keys.kbFile(ws, path ?? ""),
    queryFn: () => call("kbRead", { ws, path: path! }),
    enabled: !!path,
  });

export const useKbHistory = (ws: string, path: string | null) =>
  useQuery({
    queryKey: keys.kbHistory(ws, path ?? ""),
    queryFn: () => call("kbHistory", { ws, path: path! }),
    enabled: !!path,
  });

export const useKbSuggestions = (ws: string | undefined) =>
  useQuery({
    queryKey: keys.kbSuggestions(ws ?? ""),
    queryFn: () => call("kbSuggestions", { ws: ws!, state: "pending" }),
    enabled: !!ws,
  });

export const useKbDigest = (ws: string | undefined) =>
  useQuery({
    queryKey: keys.kbDigest(ws ?? ""),
    queryFn: () => call("kbDigest", { ws: ws! }),
    enabled: !!ws,
  });

export const useKbUndo = (ws: string) =>
  useWrite(
    (change: string) => call("kbUndo", { ws, change }),
    () => [keys.kb(ws)],
  );

export const useKbAccept = (ws: string) =>
  useWrite(
    (args: { suggestion: string; force?: boolean; comment?: string }) =>
      call("kbAccept", { ws, ...args }),
    () => [keys.kb(ws)],
  );

export const useKbReject = (ws: string) =>
  useWrite(
    (args: { suggestion: string; comment?: string }) => call("kbReject", { ws, ...args }),
    () => [keys.kb(ws)],
  );

// ---- Files and issues ----

export const useTaskFiles = (ws: string, task: string | null) =>
  useQuery({
    queryKey: keys.taskFiles(ws, task ?? ""),
    queryFn: () => call("taskFiles", { ws, task: task! }),
    enabled: !!task,
  });

export const useTaskFile = (ws: string, task: string | null, path: string | null) =>
  useQuery({
    queryKey: keys.taskFile(ws, task ?? "", path ?? ""),
    queryFn: () => call("taskFile", { ws, task: task!, path: path! }),
    enabled: !!task && !!path,
  });

export const useRestoreDocument = (ws: string) =>
  useWrite(
    (path: string) => call("restoreDocument", { ws, path }),
    () => [keys.issues(ws), keys.workspaces(), keys.taskLists(ws), keys.projects(ws)],
  );

/**
 * The agent queues (openspec queue-and-assign): the position and the cause of each waiting task,
 * by task id. The cause follows the presence and the health files, so the page reads it again
 * every 10 s, as the presence.
 */
export const useQueues = (ws: string | undefined) =>
  useQuery({
    queryKey: keys.queues(ws ?? ""),
    queryFn: () => call("queues", { ws: ws! }),
    enabled: !!ws,
    refetchInterval: 10_000,
    select: queueIndex,
  });

/** The same queues reply as `useQueues`, as sent: the agents of each device (Devices & sync). */
export const useQueueAgents = (ws: string | undefined) =>
  useQuery({
    queryKey: keys.queues(ws ?? ""),
    queryFn: () => call("queues", { ws: ws! }),
    enabled: !!ws,
    refetchInterval: 10_000,
  });

/**
 * The newest terminal snapshot of a task (openspec task-terminal-view). A snapshot changes with no
 * event, so the tab reads it again every 10 s.
 */
export const useTerminal = (ws: string, task: string, active = true) =>
  useQuery({
    queryKey: keys.terminal(ws, task),
    queryFn: () => call("terminal", { ws, task }),
    enabled: active,
    refetchInterval: 10_000,
  });

/** "Open the terminal" and "Sign in": the main process starts the program or gives the command. */
export const useOpenTerminal = (ws: string, task: string) =>
  useMutation({
    mutationFn: (action: TerminalAction) => call("openTerminal", { ws, task, action }),
  });

// ---- The Inbox and the sources (openspec inbox-mattermost) ----

/** Each card of the workspace (open and done): the filters run in the renderer. */
export const useInboxCards = (ws: string | undefined) =>
  useQuery({
    queryKey: keys.cards(ws ?? ""),
    queryFn: () => call("inboxCards", { ws: ws!, state: "all" }),
    enabled: !!ws,
  });

export const useSources = (ws: string | undefined) =>
  useQuery({
    queryKey: keys.sources(ws ?? ""),
    queryFn: () => call("sources", { ws: ws! }),
    enabled: !!ws,
  });

/** The collector state and a connection test; read again every 30 s. */
export const useSourceStatus = (ws: string | undefined, source: string | undefined) =>
  useQuery({
    queryKey: keys.sourceStatus(ws ?? "", source ?? ""),
    queryFn: () => call("sourceStatus", { ws: ws!, source: source! }),
    enabled: !!ws && !!source,
    refetchInterval: 30_000,
  });

export const useSourceConversations = (ws: string | undefined, source: string | undefined) =>
  useQuery({
    queryKey: keys.conversations(ws ?? "", source ?? ""),
    queryFn: () => call("sourceConversations", { ws: ws!, source: source! }),
    enabled: !!ws && !!source,
  });

/**
 * A change of the configuration of one source. Each save reads the newest configuration when it
 * runs and applies only its own change, and the saves of one source run one after another: two
 * quick changes on the Sources page never overwrite each other.
 */
export function useSourceSave(ws: string, source: string) {
  const client = useQueryClient();
  return useMutation({
    scope: { id: `source-save:${ws}:${source}` },
    mutationFn: async (change: (input: SourceInput | null) => SourceInput) => {
      const sources = await client.fetchQuery({
        queryKey: keys.sources(ws),
        queryFn: () => call("sources", { ws }),
        staleTime: 0,
      });
      const current = sources.find((s) => s.source === source && !s.removed);
      const body = change(current ? sourceInputOf(current) : null);
      return call("setSource", { ws, source, body });
    },
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: keys.sources(ws) });
    },
  });
}

/**
 * A write of the Inbox: it refreshes the cards and the sources, not the source status and the
 * conversations, which call Mattermost.
 */
export function useInboxWrite<A, R>(ws: string, fn: (args: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: keys.cards(ws) });
      await client.invalidateQueries({ queryKey: keys.sources(ws) });
      await client.invalidateQueries({ queryKey: keys.taskLists(ws) });
    },
  });
}
