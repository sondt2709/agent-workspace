// The task screens of a project and of All tasks: the Board and the List. A task opens as the task
// page (the task route) at each window width (openspec task-review-layout, design decision 10).
import { mainVar, tint } from "@aw/ui";
import Autorenew from "@mui/icons-material/AutorenewOutlined";
import CheckCircleOutline from "@mui/icons-material/CheckCircleOutlineOutlined";
import ExpandMore from "@mui/icons-material/ExpandMoreOutlined";
import HourglassEmpty from "@mui/icons-material/HourglassEmptyOutlined";
import Inventory from "@mui/icons-material/Inventory2Outlined";
import PanTool from "@mui/icons-material/PanToolOutlined";
import Pause from "@mui/icons-material/PauseOutlined";
import RadioButtonUnchecked from "@mui/icons-material/RadioButtonUncheckedOutlined";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  List,
  ListItemButton,
  ListSubheader,
  Stack,
  Typography,
} from "@mui/material";
import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import type { Task } from "../../../shared/channels.ts";
import { errorText } from "../bridge.ts";
import { useNow } from "../clock.ts";
import {
  ago,
  boardLanes,
  details,
  GROUP_LABEL,
  hlcMs,
  listGroups,
  STAGE_HINT,
  STAGE_LABEL,
  STAGES,
  taskLabel,
  type GroupId,
} from "../model.ts";
import { useQueues, useTasks } from "../queries.ts";
import type { TaskQueue } from "../queue-model.ts";
import {
  Empty,
  LoadingRows,
  moveRowFocus,
  NeedsYouChip,
  PausedChip,
  TaskChips,
} from "./common.tsx";
import { useDialogs } from "./dialogs.tsx";
import { FrameHeader } from "./ProjectFrame.tsx";
import { QueueChip } from "./QueueChip.tsx";
import { UnarchiveButton } from "./TaskActions.tsx";
import { TaskDetail } from "./TaskDetail.tsx";
import { LetterTile } from "./WorkspaceMenu.tsx";

type Queues = ReadonlyMap<string, TaskQueue>;
const NO_QUEUES: Queues = new Map();

/** The age of a task: the time of its last event ("5 min ago"), or nothing. */
function Age({ task }: { task: Task }) {
  const now = useNow(30_000);
  const ms = task.last_hlc ? hlcMs(task.last_hlc) : Number.NaN;
  if (Number.isNaN(ms)) return null;
  return (
    <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: "none" }}>
      {ago(ms, now)}
    </Typography>
  );
}

/** The one state chip of a card: Needs you, Paused, Queued or Moving (the column has the stage). */
function StateChip({ task, queue }: { task: Task; queue?: TaskQueue | undefined }) {
  const moving = details(task).moving_to;
  if (task.needs_you_lane) return <NeedsYouChip task={task} />;
  if (details(task).paused) return <PausedChip task={task} />;
  if (queue) return <QueueChip queue={queue} />;
  if (moving) return <Chip icon={<HourglassEmpty />} label={`Moving to ${moving}`} />;
  return null;
}

/** A quiet Board card (docs/design.md 8.5.3): key, project, title, one state chip, assignee, age. */
export function TaskCard({
  task,
  selected,
  onOpen,
  queue,
}: {
  task: Task;
  selected: boolean;
  onOpen: () => void;
  queue?: TaskQueue | undefined;
}) {
  return (
    <Card
      sx={{
        borderColor: task.needs_you_lane
          ? tint(mainVar("warning"), 40)
          : selected
            ? "aw.lineStrong"
            : "divider",
        opacity: task.stage === "done" ? 0.75 : 1,
      }}
    >
      <CardActionArea onClick={onOpen} aria-label={`${taskLabel(task)} ${task.title ?? ""}`}>
        <CardContent
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 1.5,
            p: 2.5,
            "&:last-child": { pb: 2.5 },
          }}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 0 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontFamily: "var(--aw-font-mono)", flex: "none" }}
            >
              {taskLabel(task)}
            </Typography>
            {task.project && (
              <>
                <LetterTile name={task.project} size={14} />
                <Typography variant="caption" color="text.secondary" noWrap>
                  {task.project}
                </Typography>
              </>
            )}
          </Stack>
          <Typography
            variant="body1"
            sx={{
              fontWeight: "fontWeightMedium",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              overflowWrap: "anywhere",
            }}
          >
            {task.title ?? "(no title)"}
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: "wrap", "&:empty": { display: "none" } }}
          >
            <StateChip task={task} queue={queue} />
          </Stack>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 0 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              title={task.assignee ?? undefined}
              sx={{ flex: 1, minWidth: 0, fontFamily: "var(--aw-font-mono)" }}
            >
              {task.assignee ?? ""}
            </Typography>
            <Age task={task} />
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

function Cards(props: {
  tasks: Task[];
  selected: string | null;
  onOpen: (t: Task) => void;
  queues: Queues;
}) {
  return props.tasks.map((task) => (
    <TaskCard
      key={task.id}
      task={task}
      selected={task.id === props.selected}
      onOpen={() => props.onOpen(task)}
      queue={props.queues.get(task.id)}
    />
  ));
}

/** The label of a Board row: it spans the columns and stays at the left in a side scroll. */
function LaneLabel({ row, you, children }: { row: number; you?: boolean; children: ReactNode }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        gridColumn: "1 / -1",
        gridRow: row,
        justifySelf: "start",
        position: "sticky",
        left: 0,
        alignItems: "center",
        px: 1,
        pt: 2,
        color: you ? "warning.main" : "text.secondary",
      }}
    >
      {you && <PanTool sx={{ fontSize: 14 }} />}
      <Typography variant="subtitle2" component="div">
        {children}
      </Typography>
    </Stack>
  );
}

/**
 * The Board (docs/design.md 8.5): one column per stage with its count and a short description;
 * "Needs you" is a row across the columns, so a card keeps its stage. The columns share the width
 * (at least 160 px). Each column is a region that spans the rows (CSS subgrid).
 */
export function Board({
  tasks,
  selected,
  onOpen,
  queues = NO_QUEUES,
}: {
  tasks: Task[];
  selected: string | null;
  onOpen: (t: Task) => void;
  queues?: Queues;
}) {
  const { needsYou, rest } = boardLanes(tasks);
  const youCount = STAGES.reduce((n, s) => n + needsYou[s].length, 0);
  const restCount = STAGES.reduce((n, s) => n + rest[s].length, 0);
  const lanes = youCount > 0;
  // Rows: 1 header; with lanes 2 label, 3 Needs you, 4 label, 5 the rest; else 2 the rest.
  const restRow = lanes ? 5 : 2;
  const cell = { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 } as const;
  return (
    <Box sx={{ overflow: "auto", height: "100%", p: 4 }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(${STAGES.length}, minmax(160px, 1fr))`,
          gridTemplateRows: lanes ? "auto auto auto auto 1fr" : "auto 1fr",
          columnGap: 2,
          rowGap: 2,
          minHeight: "100%",
        }}
      >
        {lanes && (
          <LaneLabel row={2} you>
            Needs you · {youCount}
          </LaneLabel>
        )}
        {lanes && <LaneLabel row={4}>Everything else · {restCount}</LaneLabel>}
        {STAGES.map((stage, i) => {
          const count = needsYou[stage].length + rest[stage].length;
          return (
            <Box
              key={stage}
              component="section"
              aria-label={STAGE_LABEL[stage]}
              sx={{
                gridColumn: i + 1,
                gridRow: "1 / -1",
                display: "grid",
                gridTemplateRows: "subgrid",
                rowGap: 2,
                minWidth: 0,
              }}
            >
              <Box sx={{ gridRow: 1, px: 1, pb: 1, borderBottom: 1, borderColor: "divider" }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
                  <Typography variant="subtitle2" component="h2" color="text.primary">
                    {STAGE_LABEL[stage]}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {count}
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary" component="p">
                  {STAGE_HINT[stage]}
                </Typography>
              </Box>
              {lanes && (
                <Box sx={{ ...cell, gridRow: 3 }} aria-label={`${STAGE_LABEL[stage]} · Needs you`}>
                  <Cards
                    tasks={needsYou[stage]}
                    selected={selected}
                    onOpen={onOpen}
                    queues={queues}
                  />
                </Box>
              )}
              <Box sx={{ ...cell, gridRow: restRow }}>
                {count === 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
                    No tasks
                  </Typography>
                )}
                <Cards tasks={rest[stage]} selected={selected} onOpen={onOpen} queues={queues} />
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/** A project with no task: the next step is New task (docs/design.md 8.13). */
function NoTasks() {
  const dialogs = useDialogs();
  const { project } = useParams();
  return (
    <Empty
      title="No tasks yet"
      action={
        <Button variant="contained" onClick={() => dialogs.newTask(project ?? null)}>
          New task
        </Button>
      }
    >
      Write what you want. An agent of the project works on it.
    </Empty>
  );
}

/** The status icon of a List row, from its group (docs/design.md 8.4.1). */
const GROUP_ICON: Record<GroupId, ReactNode> = {
  needs_you: <PanTool sx={{ fontSize: 16, color: "warning.main" }} />,
  running: <Autorenew sx={{ fontSize: 16, color: "aw.run" }} />,
  paused: <Pause sx={{ fontSize: 16, color: "aw.wait" }} />,
  queued: <HourglassEmpty sx={{ fontSize: 16, color: "aw.wait" }} />,
  backlog: <RadioButtonUnchecked sx={{ fontSize: 16, color: "text.secondary" }} />,
  done: <CheckCircleOutline sx={{ fontSize: 16, color: "aw.ok" }} />,
  archived: <Inventory sx={{ fontSize: 16, color: "text.secondary" }} />,
};

/** One List row of 36 px: status icon, key, title, chips, assignee and age. */
function TaskRow(props: {
  task: Task;
  group: GroupId;
  selected: boolean;
  onOpen: () => void;
  queue?: TaskQueue | undefined;
}) {
  const { task } = props;
  return (
    <ListItemButton
      data-row
      selected={props.selected}
      onClick={props.onOpen}
      aria-label={`${taskLabel(task)} ${task.title ?? ""}`}
      sx={{
        gap: 2,
        minHeight: 36,
        py: 0.5,
        px: 4,
        borderRadius: 0,
        borderLeft: 2,
        borderColor: props.selected ? "primary.main" : "transparent",
      }}
    >
      <Box sx={{ display: "flex", flex: "none" }}>{GROUP_ICON[props.group]}</Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontFamily: "var(--aw-font-mono)", width: 56, flex: "none" }}
      >
        {taskLabel(task)}
      </Typography>
      <Typography
        variant="body1"
        noWrap
        sx={{ flex: 1, minWidth: 0, fontWeight: "fontWeightMedium" }}
      >
        {task.title ?? "(no title)"}
      </Typography>
      <Box
        sx={{
          display: { xs: "none", sm: "flex" },
          flex: "none",
          maxWidth: "40%",
          overflow: "hidden",
          "& > *": { flexWrap: "nowrap" },
        }}
      >
        <TaskChips task={task} queue={props.queue} />
      </Box>
      <Typography
        variant="caption"
        color="text.secondary"
        noWrap
        sx={{
          display: { xs: "none", md: "block" },
          width: 160,
          flex: "none",
          fontFamily: "var(--aw-font-mono)",
        }}
      >
        {task.assignee ?? ""}
      </Typography>
      <Box sx={{ width: 64, flex: "none", textAlign: "right" }}>
        <Age task={task} />
      </Box>
    </ListItemButton>
  );
}

/**
 * The List (docs/design.md 8.4): groups with a header that collapses the group, and one-line
 * rows. Up and Down move the focus between the rows; Enter opens the row. The group "Archived" is
 * closed at the start, and each of its rows has "Unarchive" (openspec task-actions).
 */
export function TaskList({
  ws,
  tasks,
  selected,
  onOpen,
  queues = NO_QUEUES,
}: {
  ws: string;
  tasks: Task[];
  selected: string | null;
  onOpen: (t: Task) => void;
  queues?: Queues;
}) {
  const [closed, setClosed] = useState<ReadonlySet<GroupId>>(new Set(["archived"]));
  const groups = listGroups(tasks, queues);
  if (groups.length === 0) return <NoTasks />;
  const toggle = (id: GroupId) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Box sx={{ overflowY: "auto", height: "100%" }} onKeyDown={moveRowFocus}>
      {groups.map((group) => {
        const open = !closed.has(group.id);
        const label = GROUP_LABEL[group.id];
        return (
          <List
            key={group.id}
            aria-label={label}
            disablePadding
            subheader={
              <ListSubheader
                disableGutters
                sx={{ bgcolor: "aw.canvas", lineHeight: "32px", zIndex: 2 }}
              >
                <ButtonBase
                  onClick={() => toggle(group.id)}
                  aria-expanded={open}
                  aria-label={`${label} · ${group.tasks.length}`}
                  sx={{ width: "100%", justifyContent: "flex-start", gap: 1.5, px: 4, height: 32 }}
                >
                  <ExpandMore
                    sx={{
                      fontSize: 16,
                      transform: open ? "none" : "rotate(-90deg)",
                      transition: "transform 150ms ease-out",
                    }}
                  />
                  <Typography variant="subtitle2" component="span" color="text.primary">
                    {label}
                  </Typography>
                  <Typography variant="caption" component="span" color="text.secondary">
                    {group.tasks.length}
                  </Typography>
                </ButtonBase>
              </ListSubheader>
            }
          >
            {open &&
              group.tasks.map((task) => {
                const row = (
                  <TaskRow
                    key={task.id}
                    task={task}
                    group={group.id}
                    selected={task.id === selected}
                    onOpen={() => onOpen(task)}
                    queue={queues.get(task.id)}
                  />
                );
                if (group.id !== "archived") return row;
                return (
                  <Box key={task.id} sx={{ display: "flex", alignItems: "center", pr: 2 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>{row}</Box>
                    <UnarchiveButton ws={ws} task={task} />
                  </Box>
                );
              })}
          </List>
        );
      })}
    </Box>
  );
}

/**
 * Board or List: the tasks of one project, or all tasks of the workspace (All tasks). A task opens as
 * the task page; Back returns here with the search params. An old link with `?task=` opens the page.
 */
function TaskScreen({ view, project }: { view: "board" | "list"; project?: string }) {
  const { ws = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tasks = useTasks(ws, project ? { project } : {});
  const queues = useQueues(ws).data ?? NO_QUEUES;
  const selected = params.get("task");
  if (selected) return <Navigate replace to={`/w/${ws}/tasks/${selected}`} />;
  const open = (task: Task) => void navigate(`/w/${ws}/tasks/${task.id}`);
  let body;
  if (tasks.isPending) body = <LoadingRows rows={8} label="Loading the tasks" />;
  else if (tasks.isError)
    body = (
      <Alert severity="error" sx={{ m: 4 }}>
        {errorText(tasks.error)}
      </Alert>
    );
  // The List also shows the archived tasks (group "Archived"); the Board shows none.
  else if (tasks.data.filter((t) => view === "list" || !t.archived).length === 0)
    body = <NoTasks />;
  else if (view === "board")
    body = <Board tasks={tasks.data} selected={null} onOpen={open} queues={queues} />;
  else body = <TaskList ws={ws} tasks={tasks.data} selected={null} onOpen={open} queues={queues} />;
  return <Box sx={{ height: "100%", minHeight: 0 }}>{body}</Box>;
}

/** Board or List of one project (the project frame has the header and the tabs). */
export function ProjectTasks({ view }: { view: "board" | "list" }) {
  const { project = "" } = useParams();
  return <TaskScreen view={view} project={project} />;
}

/** All tasks of the workspace, with the tabs Board and List (`?view=list`). */
export function AllTasks() {
  const [params] = useSearchParams();
  const view = params.get("view") === "list" ? "list" : "board";
  return (
    <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <FrameHeader
        title="All tasks"
        label="All tasks views"
        value={view}
        tabs={[
          { label: "Board", value: "board", to: "?view=board" },
          { label: "List", value: "list", to: "?view=list" },
        ]}
      />
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <TaskScreen view={view} />
      </Box>
    </Box>
  );
}

/** The task route: the full task detail, with Back (no Close). */
export function TaskPage() {
  const { ws = "", task = "" } = useParams();
  const navigate = useNavigate();
  // The first page of the app has the key "default": it has no page to go back to.
  const first = useLocation().key === "default";
  const back = () => void (first ? navigate(`/w/${ws}/inbox`) : navigate(-1));
  // Esc goes back, except in a text field (docs/design.md 8.4.4). A dialog stops its Esc.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable='true']")) return;
    back();
  };
  return (
    <Box sx={{ height: "100%", minHeight: 0, bgcolor: "background.paper" }} onKeyDown={onKeyDown}>
      {/* A new task opens on its Activity tab: the key resets the tab. */}
      <TaskDetail key={task} ws={ws} taskId={task} onBack={back} />
    </Box>
  );
}
