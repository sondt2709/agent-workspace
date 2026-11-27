// The task page, as an issue (docs/design.md 8.6, openspec task-view-focus, task-review-layout): the
// header with the need-you navigation, "Show list" and the stage progress, then the tabs Activity
// (Assign and a pause, the description, the activity rows with the gates in their place in time:
// openspec proposal-and-discussion), Session (the session summary and each raw event:
// principle 8), Terminal and Files. The properties are a right panel when the task page is wide,
// else a Properties tab. The width is the width of the task page itself. The Android app has the
// same page (android/app TaskScreens.kt).
import ArrowBack from "@mui/icons-material/ArrowBackOutlined";
import ChevronLeft from "@mui/icons-material/ChevronLeftOutlined";
import ChevronRight from "@mui/icons-material/ChevronRightOutlined";
import Key from "@mui/icons-material/KeyOutlined";
import Terminal from "@mui/icons-material/TerminalOutlined";
import ViewSidebar from "@mui/icons-material/ViewSidebarOutlined";
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  Link,
  Stack,
  Switch,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
  type Theme,
} from "@mui/material";
import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router";
import type { Task } from "../../../shared/channels.ts";
import { errorText } from "../bridge.ts";
import {
  CONTENT_MAX_PX,
  details,
  GROUP_LABEL,
  needYouNav,
  pauseLabel,
  PROPERTIES_PANEL_PX,
  proposalVersions,
  sessionLink,
  stageLabel,
  STAGES,
  switchGroups,
  TASK_LIST_PX,
  taskLabel,
  taskPageLayout,
  type Stage,
} from "../model.ts";
import { useQueues, useTask, useTasks, useWorkEvents } from "../queries.ts";
import { queueLine } from "../queue-model.ts";
import { startFailureOf, startFailureText } from "../start-failure-model.ts";
import { Empty, LoadingRows, MarkdownText, RawText, TaskChips } from "./common.tsx";
import { useDialogs } from "./dialogs.tsx";
import { FileText, TaskTree } from "./Files.tsx";
import { AssignCard, GateCard } from "./GateCard.tsx";
import { GateNotice, ProposalVersions } from "./GateParts.tsx";
import { MessageBoxFocus } from "./ProposalCard.tsx";
import { SessionOptionChips, SessionOptionRows } from "./SessionOptions.tsx";
import { StartFailureNotice } from "./StartFailure.tsx";
import { TaskActionsMenu } from "./TaskActions.tsx";
import { OpenTerminalButton, TerminalView } from "./TerminalView.tsx";
import { Composer, Thread } from "./Thread.tsx";

/** From this width of the task detail, the properties show in a right panel. */
export const WIDE_DETAIL_PX = 1000;

type TabId = "activity" | "session" | "terminal" | "files" | "properties";

/**
 * The width of the element, from a ResizeObserver. With no ResizeObserver (the renderer tests), the
 * media query `lg` of the window decides: 1280 px from `lg`, else 800 px.
 */
function useOwnWidth(): [(node: HTMLElement | null) => (() => void) | undefined, number] {
  const windowWide = useMediaQuery((theme: Theme) => theme.breakpoints.up("lg"));
  const [width, setWidth] = useState<number | null>(null);
  const ref = useCallback((node: HTMLElement | null) => {
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width ?? (windowWide ? 1280 : 800)];
}

function Field({ label, children, note }: { label: string; children: ReactNode; note?: string }) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="subtitle2" color="text.secondary">
        {label}
      </Typography>
      {children}
      {note && (
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
      )}
    </Stack>
  );
}

function TaskLink({ ws, id, tasks }: { ws: string; id: string; tasks: Task[] }) {
  const task = tasks.find((t) => t.id === id);
  return (
    <Link
      component={RouterLink}
      to={`/w/${ws}/tasks/${id}`}
      sx={{ fontFamily: "var(--aw-font-mono)" }}
    >
      {task ? taskLabel(task) : id.slice(0, 8)}
    </Link>
  );
}

/** The stage progress: one segment per stage, filled up to the stage of the task. */
export function StageProgress({ stage }: { stage: string }) {
  const index = STAGES.indexOf(stage as Stage);
  const done = stage === "done";
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
      <Box
        role="img"
        aria-label={`Stage ${index + 1} of ${STAGES.length}: ${stageLabel(stage)}`}
        sx={{ display: "flex", gap: 0.5, width: 168 }}
      >
        {STAGES.map((s, i) => (
          <Box
            key={s}
            sx={{
              flex: 1,
              height: 4,
              borderRadius: 1,
              bgcolor: i <= index ? (done ? "success.main" : "info.main") : "aw.lineStrong",
            }}
          />
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {stageLabel(stage)} · stage {index + 1} of {STAGES.length}
      </Typography>
    </Stack>
  );
}

/** The properties: read-only values of the task (review ui-ux 5.2 decision 4). */
function Properties({ ws, task }: { ws: string; task: Task }) {
  const d = details(task);
  const work = useWorkEvents(ws, task.id);
  const all = useTasks(ws).data ?? [];
  const queue = useQueues(ws).data?.get(task.id);
  const versions = proposalVersions(work.data);
  const dialogs = useDialogs();
  return (
    <Stack spacing={3} component="section" aria-label="Properties">
      <Field label="Stage">
        <Typography variant="body2">{stageLabel(task.stage)}</Typography>
      </Field>
      <Field label="Assignee">
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="body2" sx={{ flex: 1 }}>
            {task.assignee ?? "None · Needs you: assign"}
          </Typography>
          <Button startIcon={<Terminal />} onClick={() => dialogs.newSession(task.id)}>
            New session
          </Button>
        </Stack>
      </Field>
      <SessionOptionRows ws={ws} task={task} />
      {task.project && (
        <Field label="Project">
          <Typography variant="body2">{task.project}</Typography>
        </Field>
      )}
      <Field label="Proposal">
        {versions.length === 0 && d.proposal.latest === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Not written yet
          </Typography>
        ) : (
          <ProposalVersions
            ws={ws}
            task={task.id}
            proposal={d.proposal}
            versions={
              versions.length > 0
                ? versions
                : Array.from({ length: d.proposal.latest }, (_, i) => ({
                    version: i + 1,
                    file: `proposal/v${i + 1}.md`,
                    text: "",
                  }))
            }
          />
        )}
      </Field>
      <Field label="Test server">
        <Typography
          variant="body2"
          sx={{ fontFamily: d.test_server ? "var(--aw-font-mono)" : undefined }}
        >
          {d.test_server ?? "None"}
        </Typography>
      </Field>
      <Field
        label="Credentials"
        note="Names only. The session gets the values as files with mode 0600."
      >
        {d.credentials.length === 0 ? (
          <Typography variant="body2">None</Typography>
        ) : (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            {d.credentials.map((c) => (
              <Chip key={c} icon={<Key />} label={c} />
            ))}
          </Stack>
        )}
      </Field>
      {startFailureOf(task) ? (
        <Field label="Start">
          <Typography variant="body2">{startFailureText(startFailureOf(task)!)}</Typography>
        </Field>
      ) : (
        queue && (
          <Field label="Queue">
            <Typography variant="body2">{queueLine(queue)}</Typography>
          </Field>
        )
      )}
      {(task.parent || task.subtasks.length > 0 || task.depends_on.length > 0) && (
        <Field label="Parent and subtasks">
          {task.parent && (
            <Typography variant="body2">
              Parent: <TaskLink ws={ws} id={task.parent} tasks={all} />
            </Typography>
          )}
          {task.subtasks.length > 0 && (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              <Typography variant="body2">Subtasks:</Typography>
              {task.subtasks.map((id) => (
                <TaskLink key={id} ws={ws} id={id} tasks={all} />
              ))}
            </Stack>
          )}
          {task.depends_on.length > 0 && (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              <Typography variant="body2">Depends on:</Typography>
              {task.depends_on.map((id) => (
                <TaskLink key={id} ws={ws} id={id} tasks={all} />
              ))}
            </Stack>
          )}
        </Field>
      )}
      {d.progress && (
        <Field label="Progress">
          <Typography variant="body2">{d.progress}</Typography>
        </Field>
      )}
    </Stack>
  );
}

/** The first message, once, as the description: Markdown, or the exact text with "Show raw". */
export function Description({ task }: { task: Task }) {
  const [raw, setRaw] = useState(false);
  const text = task.first_message ?? "";
  return (
    <Stack spacing={1} component="section" aria-label="Description">
      <Stack direction="row" sx={{ alignItems: "center" }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ flex: 1 }}>
          Description
        </Typography>
        {text && (
          <FormControlLabel
            control={
              <Switch size="small" checked={raw} onChange={(e) => setRaw(e.target.checked)} />
            }
            label="Show raw"
            slotProps={{ typography: { variant: "caption", color: "text.secondary" } }}
          />
        )}
      </Stack>
      {!text ? (
        <Typography variant="body2" color="text.secondary">
          No first message.
        </Typography>
      ) : raw ? (
        <Box data-testid="description-raw">
          <RawText text={text} />
        </Box>
      ) : (
        // A first message is often plain text: keep its single line breaks.
        <Box sx={{ "& p, & li": { whiteSpace: "pre-line" } }}>
          <MarkdownText text={text} />
        </Box>
      )}
      <Typography variant="caption" color="text.secondary">
        The first message of the task. AW passes it as is to the agent.
      </Typography>
    </Stack>
  );
}

/**
 * The session summary of the Session tab: state, device, host, claim, branch, id. "Stop session"
 * is in the "⋯" menu of the header, for a session on any device (openspec task-actions).
 */
function SessionSummary({ task }: { task: Task }) {
  const d = details(task);
  return (
    <Stack spacing={0.5} component="section" aria-label="Session summary">
      {d.session ? (
        <Typography variant="body2">
          {d.session.state !== "running"
            ? `Ended (${d.session.reason ?? "unknown"})`
            : d.paused
              ? `Paused (${pauseLabel(d.paused)})`
              : "Running"}{" "}
          on {d.session.device} · {d.session.host}
        </Typography>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No session.
        </Typography>
      )}
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontFamily: "var(--aw-font-mono)", overflowWrap: "anywhere" }}
      >
        {d.claim ? `Claim epoch ${d.claim.epoch} · ` : ""}
        {/* The session of the claim, else the last session (also after the claim ended). */}
        {d.claim || d.session
          ? `session ${(d.claim?.session ?? d.session?.session ?? "").slice(0, 8)} · `
          : ""}
        {d.branch ? `branch ${d.branch} · ` : ""}
        task {task.id}
      </Typography>
      {d.session ? (
        <Typography
          variant="caption"
          color="text.secondary"
          aria-label="Session link"
          sx={{ fontFamily: "var(--aw-font-mono)", overflowWrap: "anywhere" }}
        >
          {sessionLink(d.session).join(" · ")}
        </Typography>
      ) : null}
    </Stack>
  );
}

/** The read-only folder of the task and the selected file (the Files tab). */
function TaskFiles({ ws, task }: { ws: string; task: string }) {
  const [file, setFile] = useState<string | null>(null);
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "240px minmax(0, 1fr)" },
        gap: 2,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <TaskTree ws={ws} task={task} selected={file} onSelect={setFile} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        {file ? (
          <FileText key={file} ws={ws} task={task} path={file} />
        ) : (
          <Empty title="Select a file">The files of a task are read-only here.</Empty>
        )}
      </Box>
    </Box>
  );
}

/**
 * The cards of what needs the person. Activity (the default): Assign and a pause at the top; the
 * gates show at their place in time in the activity rows (openspec proposal-and-discussion).
 * `inbox` (the Inbox detail): the Activity row of each open gate too, a question with its reply
 * field. `away` (each tab except Activity): the items show as one line with "Show in Activity", so
 * a gate never hides behind a tab. The Terminal tab (`away.terminal`) keeps the cards that act on
 * the terminal (Take over terminal, Sign in).
 */
export function NeedsYouCards({
  ws,
  task,
  away,
  inbox = false,
}: {
  ws: string;
  task: Task;
  away?: { onShowActivity: () => void; terminal?: boolean };
  inbox?: boolean;
}) {
  const open = task.gates.filter((g) => g.state === "open");
  const assign =
    task.needs_you_reasons.some((r) => r.reason === "assign") &&
    !open.some((g) => g.kind === "assign");
  const paused = details(task).paused;
  const dialogs = useDialogs();
  const terminal = away?.terminal === true;
  // Activity keeps an Assign gate at the top; the other gates are in the activity rows.
  const gates = inbox
    ? open
    : terminal
      ? open.filter((g) => g.kind === "take_over_terminal")
      : away
        ? []
        : open.filter((g) => g.kind === "assign");
  const showPause = paused && (!away || (terminal && paused.cause === "login_expired"));
  const others =
    open.length -
    gates.length +
    (away && assign ? 1 : 0) +
    (paused?.needs_human && !showPause ? 1 : 0);
  if (away && others === 0 && gates.length === 0 && !showPause) return null;
  if (!away && !inbox && !assign && !showPause && gates.length === 0) {
    // Activity: only the notice; the gates are in the activity rows.
    return <GateNotice ws={ws} task={task.id} />;
  }
  return (
    <Stack spacing={2}>
      {!away && <GateNotice ws={ws} task={task.id} />}
      {away && others > 0 && (
        <Alert
          severity="warning"
          variant="outlined"
          action={
            <Button color="inherit" onClick={away.onShowActivity}>
              Show in Activity
            </Button>
          }
        >
          {others === 1 ? "1 item needs you" : `${others} items need you`}
        </Alert>
      )}
      {gates.map((gate) => (
        <GateCard key={gate.gate} ws={ws} task={task} gate={gate} reply={inbox} />
      ))}
      {assign && !away && <AssignCard ws={ws} task={task} />}
      {showPause && (
        <Alert
          {...(paused.needs_human ? { "data-needs-you": "true" } : {})}
          severity={paused.needs_human ? "warning" : "info"}
          variant="outlined"
          action={
            <Button color="inherit" onClick={() => dialogs.assignDevice(task)}>
              {paused.cause === "device_revoked" ? "Change assignee…" : "Assign to another device…"}
            </Button>
          }
        >
          <b>Paused · {pauseLabel(paused)}.</b> {paused.next_step}
          {paused.cause === "login_expired" && (
            <Box sx={{ mt: 1 }}>
              <OpenTerminalButton ws={ws} task={task.id} action="sign_in" variant="contained" />
            </Box>
          )}
        </Alert>
      )}
    </Stack>
  );
}

/** The task list of the task page: the tasks that need the person, then the working tasks. */
function TaskSwitchList({ ws, current }: { ws: string; current: string }) {
  const tasks = useTasks(ws).data ?? [];
  const queues = useQueues(ws).data;
  const [params] = useSearchParams();
  const groups = switchGroups(tasks, queues);
  return (
    <Box
      component="nav"
      aria-label="Task list"
      sx={{
        width: TASK_LIST_PX,
        flex: "none",
        overflowY: "auto",
        borderRight: 1,
        borderColor: "divider",
        p: 2,
      }}
    >
      {groups.map((g) => (
        <Stack key={g.id} spacing={0.5} sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ px: 1.5 }}>
            {GROUP_LABEL[g.id]} · {g.tasks.length}
          </Typography>
          {g.tasks.map((t) => (
            <Button
              key={t.id}
              component={RouterLink}
              to={`/w/${ws}/tasks/${t.id}?${params.toString()}`}
              aria-current={t.id === current ? "page" : undefined}
              color="inherit"
              sx={{
                display: "block",
                textAlign: "left",
                textTransform: "none",
                px: 1.5,
                py: 1,
                border: 1,
                borderColor: t.id === current ? "warning.main" : "transparent",
                bgcolor: t.id === current ? "action.selected" : undefined,
              }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", fontFamily: "var(--aw-font-mono)" }}
              >
                {taskLabel(t)}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {t.title ?? "(no title)"}
              </Typography>
            </Button>
          ))}
        </Stack>
      ))}
    </Box>
  );
}

/** "1 of 2 need you" with Previous and Next, in the Inbox order (design decision 3). */
function NeedYouNavigation({ ws, task }: { ws: string; task: string }) {
  const tasks = useTasks(ws).data ?? [];
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const nav = needYouNav(tasks, task);
  if (!nav.text) return null;
  const go = (id: string | null) => {
    if (id) void navigate(`/w/${ws}/tasks/${id}?${params.toString()}`, { replace: true });
  };
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
        {nav.text}
      </Typography>
      <IconButton
        size="small"
        aria-label="Previous task that needs you"
        disabled={!nav.prev}
        onClick={() => go(nav.prev)}
      >
        <ChevronLeft fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        aria-label="Next task that needs you"
        disabled={!nav.next}
        onClick={() => go(nav.next)}
      >
        <ChevronRight fontSize="small" />
      </IconButton>
    </Stack>
  );
}

/** The width of the content of the Activity and Session tabs and of the message box, centred. */
const READ_SX = { maxWidth: CONTENT_MAX_PX, mx: "auto", width: "100%" } as const;

export function TaskDetail({
  ws,
  taskId,
  onBack,
}: {
  ws: string;
  taskId: string;
  /** Back: the screen that opened the task page. */
  onBack?: () => void;
}) {
  const query = useTask(ws, taskId);
  const queues = useQueues(ws);
  const [params, setParams] = useSearchParams();
  const [ref, width] = useOwnWidth();
  const layout = taskPageLayout(width, params.get("list") === "1", WIDE_DETAIL_PX);
  const wide = layout.propertiesPanel;
  const toggleList = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (layout.list) next.delete("list");
        else next.set("list", "1");
        return next;
      },
      { replace: true },
    );
  const [chosen, setTab] = useState<TabId>("activity");
  const tab: TabId = wide && chosen === "properties" ? "activity" : chosen;
  // The tab panel is labelled by its tab (WAI-ARIA tabs pattern).
  const uid = useId();
  const tabId = (value: TabId) => `${uid}-tab-${value}`;
  // "Show in Activity" leaves the tab, so its button goes away: the focus goes to the Activity tab.
  const showActivity = () => {
    setTab("activity");
    document.getElementById(tabId("activity"))?.focus();
  };
  // The header chip "Needs you" scrolls to the newest row that needs the person, in Activity.
  const panel = useRef<HTMLDivElement>(null);
  const showNeed = () => {
    setTab("activity");
    setTimeout(() => {
      const rows = panel.current?.querySelectorAll<HTMLElement>("[data-needs-you]") ?? [];
      rows[rows.length - 1]?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }, 0);
  };
  // "Discuss" of a proposal puts the cursor in the message box.
  const messageBox = useRef<HTMLTextAreaElement>(null);
  const focusMessageBox = useCallback(() => {
    setTab((t) => (t === "activity" || t === "session" ? t : "activity"));
    setTimeout(() => messageBox.current?.focus(), 0);
  }, []);
  let body: ReactNode;
  if (query.isPending) body = <LoadingRows rows={6} label="Loading the task" />;
  else if (query.isError) {
    body = (
      <Alert severity="error" sx={{ m: 4 }}>
        {errorText(query.error)}
      </Alert>
    );
  } else {
    const task = query.data;
    const queue = queues.data?.get(task.id);
    const reading = tab === "activity" || tab === "session";
    const content: Record<TabId, ReactNode> = {
      activity: (
        <Stack spacing={4}>
          <NeedsYouCards ws={ws} task={task} />
          <Description task={task} />
          <Stack spacing={1}>
            <Typography variant="subtitle2" color="text.secondary">
              Activity
            </Typography>
            <Thread ws={ws} task={task} mode="activity" />
          </Stack>
        </Stack>
      ),
      session: (
        <Stack spacing={3}>
          <SessionSummary task={task} />
          <Thread ws={ws} task={task} mode="session" />
        </Stack>
      ),
      terminal: <TerminalView ws={ws} task={task.id} />,
      files: <TaskFiles ws={ws} task={task.id} />,
      properties: <Properties ws={ws} task={task} />,
    };
    body = (
      <>
        <Stack spacing={1} sx={{ px: 4, pt: 2, pb: 2, borderBottom: 1, borderColor: "divider" }}>
          <Stack
            direction="row"
            spacing={2}
            useFlexGap
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            {onBack && (
              <Button startIcon={<ArrowBack />} onClick={onBack} sx={{ ml: -1 }}>
                Back
              </Button>
            )}
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontFamily: "var(--aw-font-mono)" }}
            >
              {taskLabel(task)}
            </Typography>
            {task.project && <Chip label={task.project} />}
            {task.archived && <Chip label="Archived" variant="outlined" />}
            {/* A failed start replaces the queue chip: it names the cause (openspec restart-agent). */}
            <TaskChips
              task={task}
              queue={startFailureOf(task) ? undefined : queue}
              onShowNeed={showNeed}
            />
            <StartFailureNotice ws={ws} task={task} />
            <SessionOptionChips ws={ws} task={task} />
            <Box sx={{ flex: 1 }} />
            <NeedYouNavigation ws={ws} task={task.id} />
            {layout.canList && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<ViewSidebar fontSize="small" />}
                aria-pressed={layout.list}
                onClick={toggleList}
              >
                {layout.list ? "Hide list" : "Show list"}
              </Button>
            )}
            <TaskActionsMenu ws={ws} task={task} />
          </Stack>
          <Typography variant="h1">{task.title ?? "(no title)"}</Typography>
          <StageProgress stage={task.stage} />
        </Stack>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: wide
              ? `minmax(0, 1fr) ${PROPERTIES_PANEL_PX}px`
              : "minmax(0, 1fr)",
            flex: 1,
            minHeight: 0,
          }}
        >
          <Stack sx={{ minHeight: 0 }}>
            <Tabs
              value={tab}
              onChange={(_e, value: TabId) => setTab(value)}
              variant="scrollable"
              scrollButtons={false}
              aria-label="Task view"
              sx={{ px: 4, borderBottom: 1, borderColor: "divider" }}
            >
              <Tab value="activity" label="Activity" id={tabId("activity")} />
              <Tab value="session" label="Session" id={tabId("session")} />
              <Tab value="terminal" label="Terminal" id={tabId("terminal")} />
              <Tab value="files" label="Files" id={tabId("files")} />
              {!wide && <Tab value="properties" label="Properties" id={tabId("properties")} />}
            </Tabs>
            <Box
              ref={panel}
              role="tabpanel"
              aria-labelledby={tabId(tab)}
              sx={{ overflow: "auto", p: 4, flex: 1, minHeight: 0 }}
            >
              <Stack spacing={3} sx={reading ? READ_SX : undefined}>
                {/* Each tab except Activity: a gate never hides behind a tab. */}
                {tab !== "activity" && (
                  <NeedsYouCards
                    ws={ws}
                    task={task}
                    away={{
                      onShowActivity: showActivity,
                      terminal: tab === "terminal",
                    }}
                  />
                )}
                {content[tab]}
              </Stack>
            </Box>
            {reading && (
              <Box sx={{ px: 4, py: 2, borderTop: 1, borderColor: "divider" }}>
                <Box sx={READ_SX}>
                  <Composer ws={ws} task={task} inputRef={messageBox} />
                </Box>
              </Box>
            )}
          </Stack>
          {wide && (
            <Box sx={{ overflow: "auto", p: 4, borderLeft: 1, borderColor: "divider" }}>
              <Properties ws={ws} task={task} />
            </Box>
          )}
        </Box>
      </>
    );
  }
  return (
    <Box ref={ref} sx={{ height: "100%", minHeight: 0, display: "flex" }}>
      {layout.list && <TaskSwitchList ws={ws} current={taskId} />}
      <MessageBoxFocus.Provider value={focusMessageBox}>
        <Stack sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>{body}</Stack>
      </MessageBoxFocus.Provider>
    </Box>
  );
}
