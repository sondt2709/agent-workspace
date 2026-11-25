// The Inbox (openspec navigation-prototype, docs/phase-1.md 10.8): a list and a detail with the
// tabs "Needs you" and "Updates". "Needs you" lists each task in the lane and each file to fix,
// then the working, paused and queued tasks; the detail of a task has the Activity row of each
// open gate to act in place (openspec proposal-and-discussion). A task with an answer notice keeps its row until the notice closes. The tab and the
// selection are the search params `tab` and `item`.
import AutoAwesome from "@mui/icons-material/AutoAwesomeOutlined";
import ErrorOutline from "@mui/icons-material/ErrorOutlineOutlined";
import PanTool from "@mui/icons-material/PanToolOutlined";
import SyncProblem from "@mui/icons-material/SyncProblemOutlined";
import {
  Alert,
  Box,
  Button,
  List,
  ListItemButton,
  ListSubheader,
  Stack,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
  type Theme,
} from "@mui/material";
import type { ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { Task } from "../../../shared/channels.ts";
import { errorText } from "../bridge.ts";
import { digestLine } from "../kb-model.ts";
import { taskLabel } from "../model.ts";
import { inboxGroups, inboxItems, type InboxItem, type InboxTab } from "../nav-model.ts";
import {
  useGateNoticeTasks,
  useIssues,
  useKbDigest,
  useProjects,
  useQueues,
  useSyncStatus,
  useTasks,
} from "../queries.ts";
import { Empty, LoadingRows, moveRowFocus } from "./common.tsx";
import { useDialogs } from "./dialogs.tsx";
import { FixFileCard, FixFileCards } from "./Files.tsx";
import { DigestCard } from "./Knowledge.tsx";
import { ListDetail } from "./ListDetail.tsx";
import { PhraseReminder } from "./Settings.tsx";
import { NeedsYouCards } from "./TaskDetail.tsx";

const ITEM_ICON: Record<InboxItem["kind"], ReactNode> = {
  task: <PanTool sx={{ fontSize: 16 }} />,
  file: <ErrorOutline sx={{ fontSize: 16 }} />,
  digest: <AutoAwesome sx={{ fontSize: 16 }} />,
  sync: <SyncProblem sx={{ fontSize: 16 }} />,
};

function ItemRow(props: { item: InboxItem; selected: boolean; onOpen: () => void }) {
  const { item } = props;
  const you = item.tab === "you";
  return (
    <ListItemButton
      data-row
      selected={props.selected}
      onClick={props.onOpen}
      aria-label={`${item.reason}: ${item.key ? `${item.key} ` : ""}${item.title}`}
      sx={{ gap: 2, alignItems: "flex-start", py: 1.5, mx: 2, my: 0.25 }}
    >
      <Box sx={{ pt: 0.25, color: you ? "warning.main" : "text.secondary", display: "flex" }}>
        {ITEM_ICON[item.kind]}
      </Box>
      <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="caption" sx={{ color: you ? "warning.main" : "text.secondary" }}>
          {item.reason}
        </Typography>
        <Typography variant="body1" noWrap sx={{ fontWeight: "fontWeightMedium" }}>
          {item.title}
        </Typography>
        <Stack direction="row" spacing={1.5} sx={{ minWidth: 0 }}>
          {item.key && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontFamily: "var(--aw-font-mono)" }}
            >
              {item.key}
            </Typography>
          )}
          {item.sub && (
            <Typography variant="caption" color="text.secondary" noWrap>
              {item.sub}
            </Typography>
          )}
        </Stack>
      </Stack>
    </ListItemButton>
  );
}

function TaskRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  return (
    <ListItemButton data-row onClick={onOpen} sx={{ gap: 2, mx: 2, my: 0.25, minHeight: 36 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontFamily: "var(--aw-font-mono)", width: 56, flex: "none" }}
      >
        {taskLabel(task)}
      </Typography>
      <Typography variant="body1" noWrap sx={{ flex: 1, minWidth: 0 }}>
        {task.title ?? "(no title)"}
      </Typography>
    </ListItemButton>
  );
}

/**
 * The detail of an Inbox row: the Activity row of each open gate of a task (a question with its
 * reply field, the proposal card, a gate card), Assign or a pause; a file to fix; the knowledge;
 * the sync.
 */
function ItemDetail({ ws, item }: { ws: string; item: InboxItem }) {
  const navigate = useNavigate();
  const dialogs = useDialogs();
  let body: ReactNode;
  if (item.kind === "task") {
    const task = item.task;
    body = (
      <>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontFamily: "var(--aw-font-mono)" }}
          >
            {taskLabel(task)}
          </Typography>
          {task.project && (
            <Typography variant="caption" color="text.secondary">
              {task.project}
            </Typography>
          )}
          {task.assignee && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
              {task.assignee}
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <Button variant="outlined" onClick={() => void navigate(`/w/${ws}/tasks/${task.id}`)}>
            Open task
          </Button>
        </Stack>
        <Typography variant="h2" component="h2">
          {task.title ?? "(no title)"}
        </Typography>
        <Box role="region" aria-label={`${taskLabel(task)} needs you`}>
          <NeedsYouCards ws={ws} task={task} inbox />
        </Box>
      </>
    );
  } else if (item.kind === "file") {
    body = <FixFileCard ws={ws} issue={item.issue} />;
  } else if (item.kind === "digest") {
    body = <DigestCard ws={ws} />;
  } else {
    body = (
      <>
        <Typography variant="h2" component="h2">
          Not synced
        </Typography>
        <Typography variant="body1">{item.title}</Typography>
        <Typography variant="body2" color="text.secondary">
          The changes stay on this device. They go to {item.device} when both devices are online at
          the same time.
        </Typography>
        <Box>
          <Button variant="outlined" onClick={() => dialogs.sync()}>
            Sync now
          </Button>
        </Box>
      </>
    );
  }
  return (
    <Stack spacing={3} sx={{ p: { xs: 4, sm: 6 }, maxWidth: 880 }}>
      {body}
    </Stack>
  );
}

export function Inbox() {
  const { ws = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const wide = useMediaQuery((theme: Theme) => theme.breakpoints.up("md"));
  const tasks = useTasks(ws);
  const projects = useProjects(ws);
  const dialogs = useDialogs();
  const notices = useGateNoticeTasks(ws);
  const issues = useIssues(ws).data;
  const digest = useKbDigest(ws).data;
  const sync = useSyncStatus(10_000).data;
  const queues = useQueues(ws).data;
  if (tasks.isPending) return <LoadingRows rows={5} label="Loading the Inbox" />;
  if (tasks.isError)
    return (
      <Alert severity="error" sx={{ m: 4 }}>
        {errorText(tasks.error)}
      </Alert>
    );
  const active = tasks.data.filter((t) => !t.archived);
  // A new workspace: the next step is a project, then a task (openspec create-flows).
  const noProject = projects.isSuccess && !projects.data.some((p) => p.archived !== true);
  const start =
    active.length > 0 ? null : noProject ? (
      <Empty
        title="No projects yet"
        action={
          <Button variant="contained" onClick={() => dialogs.addProject(ws)}>
            Add a project
          </Button>
        }
      >
        Add a project with its checkout folder. Then write the first task.
      </Empty>
    ) : projects.isSuccess ? (
      <Empty
        title="No tasks yet"
        action={
          <Button variant="contained" onClick={() => dialogs.newTask(null)}>
            New task
          </Button>
        }
      >
        Write a task. An agent works on it and asks here when it needs you.
      </Empty>
    ) : null;
  if (start) {
    return (
      <Box sx={{ overflowY: "auto", height: "100%" }}>
        <Stack spacing={3} sx={{ p: 4, maxWidth: 880, mx: "auto" }}>
          <PhraseReminder />
          {/* A file to fix and the knowledge of today show in each state (fix list cfc-3). */}
          <FixFileCards ws={ws} />
          {start}
          <DigestCard ws={ws} />
        </Stack>
      </Box>
    );
  }
  const counts = digest
    ? {
        learned: digest.learned.length,
        changes: digest.changes.length,
        pending: digest.pending.length,
      }
    : null;
  const items = inboxItems({
    ws,
    tasks: active,
    notices,
    issues,
    digest: counts,
    ...(counts ? { digestLine: digestLine(counts) } : {}),
    sync,
  });
  const tab: InboxTab = params.get("tab") === "updates" ? "updates" : "you";
  const shown = items.filter((i) => i.tab === tab);
  const chosen = params.get("item");
  // From 840 px the first row shows when none is selected (prototype), and when the selected row
  // left the list (for example after its gate is answered).
  const selected = shown.find((i) => i.id === chosen) ?? (wide ? shown[0] : undefined);
  const groups = tab === "you" ? inboxGroups(active, shown, queues) : [];
  const open = (item: InboxItem) =>
    setParams({ ...(tab === "updates" ? { tab } : {}), item: item.id });
  const count = (t: InboxTab) => items.filter((i) => i.tab === t).length;
  const list = (
    <Box onKeyDown={moveRowFocus} sx={{ py: 2 }}>
      <List aria-label={tab === "you" ? "Needs you" : "Updates"} disablePadding>
        {shown.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            selected={item === selected}
            onOpen={() => open(item)}
          />
        ))}
      </List>
      {shown.length === 0 &&
        (tab === "you" ? (
          <Empty title="Nothing needs you">Agents ask here when they need an answer.</Empty>
        ) : (
          <Empty title="No updates">
            The knowledge of today and the devices that wait for sync show here.
          </Empty>
        ))}
      {groups.map((group) => (
        <List
          key={group.id}
          aria-label={group.label}
          disablePadding
          subheader={
            <ListSubheader
              sx={{ px: 4, mt: 2 }}
            >{`${group.label} · ${group.tasks.length}`}</ListSubheader>
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
  const detail = selected ? (
    <ItemDetail ws={ws} item={selected} />
  ) : (
    <Empty title="Nothing selected">Select a row to see what it needs.</Empty>
  );
  return (
    <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box sx={{ flex: "none", px: { xs: 4, sm: 6 }, borderBottom: 1, borderColor: "divider" }}>
        <Box sx={{ pt: 2, "&:empty": { display: "none" } }}>
          <PhraseReminder />
        </Box>
        <Tabs
          value={tab}
          onChange={(_e, value: InboxTab) => setParams(value === "updates" ? { tab: value } : {})}
          aria-label="Inbox"
          sx={{ minHeight: 36 }}
        >
          <Tab
            value="you"
            sx={{ minHeight: 36 }}
            label={
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline" }}>
                <span>Needs you</span>
                <Typography
                  component="span"
                  variant="caption"
                  sx={{ color: count("you") > 0 ? "warning.main" : "text.secondary" }}
                >
                  {count("you")}
                </Typography>
              </Stack>
            }
          />
          <Tab
            value="updates"
            sx={{ minHeight: 36 }}
            label={
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline" }}>
                <span>Updates</span>
                <Typography component="span" variant="caption" color="text.secondary">
                  {count("updates")}
                </Typography>
              </Stack>
            }
          />
        </Tabs>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <ListDetail
          list={list}
          detail={detail}
          selected={selected !== undefined}
          onBack={() => setParams(tab === "updates" ? { tab } : {})}
          listWidth={360}
        />
      </Box>
    </Box>
  );
}
