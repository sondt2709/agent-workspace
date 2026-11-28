// Tasks (openspec nav-tasks-needs-you, spec tasks-view "Tasks screen"): the tabs "Needs you",
// "Working" and "All", and the project filter. The tab, the view and the filter are in the route:
// `?tab=needs|working|all`, `?view=list|board`, `?projects=a,b`.
import { filterByProjects } from "@aw/client/inbox";
import {
  Box,
  List,
  ListSubheader,
  Stack,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { digestLine } from "../kb-model.ts";
import { inboxGroups, inboxItems } from "../nav-model.ts";
import {
  useGateNoticeTasks,
  useIssues,
  useKbDigest,
  useQueues,
  useSyncStatus,
  useTasks,
} from "../queries.ts";
import { Empty, moveRowFocus } from "./common.tsx";
import { NeedsYou, TaskRow } from "./NeedsYou.tsx";
import { ProjectFilter, useProjectFilter } from "./ProjectFilter.tsx";
import { TaskScreen } from "./TaskViews.tsx";

export type TasksTab = "needs" | "working" | "all";

/** The tab of the route: "needs" by default. */
export function tasksTab(value: string | null): TasksTab {
  return value === "working" || value === "all" ? value : "needs";
}

function TabLabel({ label, count, you }: { label: string; count: number; you?: boolean }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline" }}>
      <span>{label}</span>
      <Typography
        component="span"
        variant="caption"
        sx={{ color: you && count > 0 ? "warning.main" : "text.secondary" }}
      >
        {count}
      </Typography>
    </Stack>
  );
}

/** The groups Working now, Paused and Queued of the tasks that are not in the lane. */
function Working({ projects }: { projects: readonly string[] }) {
  const { ws = "" } = useParams();
  const navigate = useNavigate();
  const groups = useWorkingGroups(ws, projects);
  if (groups.length === 0) {
    return <Empty title="Nothing works now">Assign a task to an agent to start it.</Empty>;
  }
  return (
    <Box onKeyDown={moveRowFocus} sx={{ py: 2, overflowY: "auto", height: "100%" }}>
      {groups.map((group) => (
        <List
          key={group.id}
          aria-label={group.label}
          disablePadding
          subheader={
            <ListSubheader sx={{ px: 4, mt: 1 }}>
              {`${group.label} · ${group.tasks.length}`}
            </ListSubheader>
          }
        >
          {group.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onOpen={() => void navigate(`/w/${ws}/tasks/${task.id}`)}
            />
          ))}
        </List>
      ))}
    </Box>
  );
}

function useNeedsYouItems(ws: string, projects: readonly string[]) {
  const tasks = (useTasks(ws).data ?? []).filter((t) => !t.archived);
  const notices = useGateNoticeTasks(ws);
  const issues = useIssues(ws).data;
  const digest = useKbDigest(ws).data;
  const sync = useSyncStatus(10_000).data;
  const counts = digest
    ? {
        learned: digest.learned.length,
        changes: digest.changes.length,
        pending: digest.pending.length,
      }
    : null;
  const filtered = filterByProjects(tasks, projects, (t) => t.project);
  const items = inboxItems({
    ws,
    tasks: filtered,
    notices,
    issues,
    digest: counts,
    ...(counts ? { digestLine: digestLine(counts) } : {}),
    sync,
  });
  return { tasks: filtered, you: items.filter((i) => i.tab === "you") };
}

function useWorkingGroups(ws: string, projects: readonly string[]) {
  const { tasks, you } = useNeedsYouItems(ws, projects);
  const queues = useQueues(ws).data;
  return inboxGroups(tasks, you, queues);
}

export function TasksPage() {
  const { ws = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = tasksTab(params.get("tab"));
  const view = params.get("view") === "board" ? "board" : "list";
  const { selected } = useProjectFilter(false);
  const { tasks, you } = useNeedsYouItems(ws, selected);
  const groups = useWorkingGroups(ws, selected);
  const working = groups.reduce((sum, g) => sum + g.tasks.length, 0);
  const select = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    if (key === "tab") next.delete("item");
    setParams(next);
  };
  return (
    <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Stack
        direction="row"
        spacing={2}
        sx={{
          flex: "none",
          px: { xs: 4, sm: 6 },
          borderBottom: 1,
          borderColor: "divider",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Tabs
          value={tab}
          onChange={(_e, value: TasksTab) => select("tab", value === "needs" ? null : value)}
          aria-label="Tasks"
          sx={{ minHeight: 36, flex: 1 }}
        >
          <Tab
            value="needs"
            sx={{ minHeight: 36 }}
            label={<TabLabel label="Needs you" count={you.length} you />}
          />
          <Tab
            value="working"
            sx={{ minHeight: 36 }}
            label={<TabLabel label="Working" count={working} />}
          />
          <Tab
            value="all"
            sx={{ minHeight: 36 }}
            label={<TabLabel label="All" count={tasks.length} />}
          />
        </Tabs>
        <ProjectFilter allowNone={false} />
        {tab === "all" && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_e, value: "list" | "board" | null) => {
              if (value) select("view", value === "list" ? null : value);
            }}
            aria-label="View"
          >
            <ToggleButton value="list">List</ToggleButton>
            <ToggleButton value="board">Board</ToggleButton>
          </ToggleButtonGroup>
        )}
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {tab === "needs" && <NeedsYou projects={selected} />}
        {tab === "working" && <Working projects={selected} />}
        {tab === "all" && <TaskScreen view={view} projects={selected} />}
      </Box>
    </Box>
  );
}
