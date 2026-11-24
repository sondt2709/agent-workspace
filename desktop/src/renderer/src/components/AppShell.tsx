// The window layout: the navigation (a temporary drawer below 600 px, an 80 px rail up to 1200 px,
// a 240 px drawer above), the top bar with New task and New session, the connection banner and the
// screen of the route (docs/tech-stack.md 1.4 "Layout", docs/design.md 8.1 to 8.3). On macOS the
// traffic lights sit in the 44 px title row of the sidebar, and the title rows move the window.
import { mainVar, tint } from "@aw/ui";
import Add from "@mui/icons-material/AddOutlined";
import ChevronRight from "@mui/icons-material/ChevronRightOutlined";
import Devices from "@mui/icons-material/DevicesOutlined";
import Inbox from "@mui/icons-material/InboxOutlined";
import Key from "@mui/icons-material/KeyOutlined";
import Laptop from "@mui/icons-material/LaptopMacOutlined";
import MenuBook from "@mui/icons-material/MenuBookOutlined";
import MenuIcon from "@mui/icons-material/MenuOutlined";
import PanTool from "@mui/icons-material/PanToolOutlined";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";
import Sync from "@mui/icons-material/SyncOutlined";
import Terminal from "@mui/icons-material/TerminalOutlined";
import ViewKanban from "@mui/icons-material/ViewKanbanOutlined";
import {
  Alert,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  ButtonBase,
  Divider,
  Drawer,
  IconButton,
  Link,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  type Theme,
} from "@mui/material";
import { useEffect, useState, type ReactNode } from "react";
import {
  Navigate,
  Outlet,
  Link as RouterLink,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import type { Task, WorkspaceSummary } from "../../../shared/channels.ts";
import { bridge, errorText } from "../bridge.ts";
import { useNow } from "../clock.ts";
import { useConnection } from "../events.ts";
import {
  activeCount,
  crumbs,
  needsYouCount,
  projectCounts,
  syncSummary,
  workspaceName,
  type SyncTone,
} from "../nav-model.ts";
import { isMac, TITLE_ROW, TRAFFIC_LIGHTS_WIDTH } from "../platform.ts";
import {
  useGateNoticeTasks,
  useIssues,
  useProjects,
  useStatus,
  useSyncStatus,
  useTask,
  useTasks,
  useWorkspaces,
} from "../queries.ts";
import { CommandMenu } from "./CommandMenu.tsx";
import { DialogsProvider, useDialogs } from "./dialogs.tsx";
import { RecoveryPhraseGate } from "./Settings.tsx";
import { FirstWorkspace, LetterTile, WorkspaceSwitcher } from "./WorkspaceMenu.tsx";

/** The rail holds the traffic lights of macOS in its title row (docs/design.md 4.4). */
export const RAIL_WIDTH = TRAFFIC_LIGHTS_WIDTH;
export const DRAWER_WIDTH = 240;

const SYNC_TONE_COLOR: Record<SyncTone, string> = {
  ok: "aw.ok",
  run: "aw.run",
  wait: "aw.wait",
  err: "aw.err",
};

/** The data of the sidebar and the top bar: counts and the sync state of the current workspace. */
function useNavData(ws: string | undefined) {
  const tasks = useTasks(ws).data ?? [];
  const issues = useIssues(ws).data;
  const notices = useGateNoticeTasks(ws ?? "");
  // The sync state reads again every 10 s, as the Devices screen (openspec navigation-prototype).
  const sync = useSyncStatus(10_000).data;
  const now = useNow(10_000);
  return {
    tasks,
    needsYou: needsYouCount(tasks, issues, notices),
    active: activeCount(tasks),
    sync: syncSummary(sync, now),
  };
}

function NavItem(props: {
  to: string;
  icon: ReactNode;
  label: string;
  compact: boolean;
  count?: number;
  /** The count is a "Needs you" count: the `you` color, and a badge on the rail. */
  you?: boolean;
  /** Active only on this exact path (All tasks: not on a task route). */
  exact?: boolean;
  /** Active on each path that starts with it (a project: each tab). */
  match?: string;
  /** The right part of a full item in place of the count (the counts of a project). */
  trailing?: ReactNode;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const base = props.match ?? props.to;
  const active = props.exact ? pathname === props.to : pathname.startsWith(base);
  const count = props.count ?? 0;
  const icon =
    props.compact && props.you && count > 0 ? (
      <Badge badgeContent={count} color="warning">
        {props.icon}
      </Badge>
    ) : (
      props.icon
    );
  const item = (
    <ListItemButton
      component={RouterLink}
      to={props.to}
      onClick={props.onNavigate}
      selected={active}
      aria-current={active ? "page" : undefined}
      aria-label={props.compact ? props.label : undefined}
      sx={{
        mx: 2,
        my: 0.25,
        minHeight: 28,
        py: 0.5,
        px: 2,
        justifyContent: props.compact ? "center" : "flex-start",
        "& .MuiSvgIcon-root": { fontSize: 18 },
        "&.Mui-selected .MuiListItemIcon-root": { color: "text.primary" },
      }}
    >
      <ListItemIcon sx={{ minWidth: props.compact ? 0 : 28 }}>{icon}</ListItemIcon>
      {!props.compact && (
        <ListItemText
          primary={props.label}
          slotProps={{ primary: { noWrap: true, sx: { fontWeight: "fontWeightMedium" } } }}
        />
      )}
      {!props.compact && props.trailing}
      {!props.compact && !props.trailing && count > 0 ? (
        <Typography
          variant="caption"
          sx={{ color: props.you ? "warning.main" : "text.secondary", ml: 1 }}
        >
          {count}
        </Typography>
      ) : null}
    </ListItemButton>
  );
  return props.compact ? (
    <Tooltip title={count > 0 ? `${props.label} · ${count}` : props.label} placement="right">
      {item}
    </Tooltip>
  ) : (
    item
  );
}

/** A section label of the sidebar ("Projects", "Workspace", "This device"): not a heading. */
function NavSection({
  label,
  compact,
  action,
}: {
  label: string;
  compact: boolean;
  action?: ReactNode;
}) {
  if (compact) return <Divider sx={{ mx: 4, my: 2 }} />;
  return (
    <Stack direction="row" sx={{ alignItems: "center", px: 4, pr: 2, pt: 4, pb: 1, minHeight: 28 }}>
      <Typography variant="subtitle2" component="div" color="text.secondary" sx={{ flex: 1 }}>
        {label}
      </Typography>
      {action}
    </Stack>
  );
}

/** One row per project: the letter tile, the name and the counts "needs you · working". */
function ProjectRows({
  ws,
  tasks,
  compact,
  onNavigate,
}: {
  ws: string;
  tasks: Task[];
  compact: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const projects = useProjects(ws);
  return (
    <>
      {(projects.data ?? []).map((p) => {
        const counts = projectCounts(tasks, p.slug);
        const label = p.archived ? `${p.name} · archived` : p.name;
        return (
          <NavItem
            key={p.slug}
            to={`/w/${ws}/p/${p.slug}/board`}
            match={`/w/${ws}/p/${p.slug}/`}
            compact={compact}
            label={label}
            icon={<LetterTile name={p.name} size={18} />}
            count={compact ? counts.you : 0}
            you
            trailing={
              <Typography variant="caption" color="text.secondary" title="Needs you · working">
                <Box component="span" sx={{ color: counts.you > 0 ? "warning.main" : undefined }}>
                  {counts.you}
                </Box>
                {` · ${counts.working}`}
              </Typography>
            }
            onNavigate={onNavigate}
          />
        );
      })}
    </>
  );
}

/** The "+" of the Projects section: Add a project (openspec create-flows). */
function AddProjectButton({ ws }: { ws: WorkspaceSummary }) {
  const dialogs = useDialogs();
  const label = `Add a project to ${workspaceName(ws)}`;
  return (
    <Tooltip title={label}>
      <IconButton size="small" aria-label={label} onClick={() => dialogs.addProject(ws.id)}>
        <Add fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

/** The task of the page: the task route, or the task selected on a Board or a List. */
function usePageTask(): string | null {
  const { task } = useParams();
  const [params] = useSearchParams();
  return task ?? params.get("task");
}

/** The sync state: a dot in the status color and the text. It opens Devices & sync. */
function SyncState({ ws, text, tone }: { ws: string; text: string; tone: SyncTone }) {
  return (
    <ButtonBase
      component={RouterLink}
      to={`/w/${ws}/devices`}
      aria-label={`${text}. Open Devices & sync`}
      sx={{
        gap: 1.5,
        px: 2,
        height: 24,
        borderRadius: 1,
        border: 1,
        borderColor: "divider",
        maxWidth: "100%",
        "&:hover": { bgcolor: "aw.hover" },
      }}
    >
      <Box
        component="span"
        sx={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          bgcolor: SYNC_TONE_COLOR[tone],
          flex: "none",
        }}
      />
      <Typography variant="caption" color="aw.text2" noWrap>
        {text}
      </Typography>
    </ButtonBase>
  );
}

/** The bottom of the sidebar: this device, the sync state and Sync (docs/design.md 8.2.1). */
function SidebarFooter({
  ws,
  compact,
  sync,
}: {
  ws: string;
  compact: boolean;
  sync: { text: string; tone: SyncTone };
}) {
  const dialogs = useDialogs();
  const device = useStatus().data?.device.name ?? "This device";
  if (compact) {
    return (
      <Stack sx={{ alignItems: "center", py: 2 }}>
        <Tooltip title={`${device} · ${sync.text}. Sync now (⌘R)`} placement="right">
          <IconButton aria-label="Sync" onClick={() => dialogs.sync()}>
            <Badge
              variant="dot"
              sx={{ "& .MuiBadge-dot": { bgcolor: SYNC_TONE_COLOR[sync.tone] } }}
            >
              <Sync fontSize="small" />
            </Badge>
          </IconButton>
        </Tooltip>
      </Stack>
    );
  }
  return (
    <Stack spacing={1.5} sx={{ px: 4, py: 3, alignItems: "flex-start" }}>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", color: "text.secondary", minWidth: 0, maxWidth: "100%" }}
      >
        <Laptop sx={{ fontSize: 16 }} />
        <Typography variant="caption" noWrap>
          {device} · this device
        </Typography>
      </Stack>
      <SyncState ws={ws} {...sync} />
      <Button fullWidth variant="outlined" startIcon={<Sync />} onClick={() => dialogs.sync()}>
        Sync
      </Button>
    </Stack>
  );
}

export function Sidebar({
  current,
  compact,
  onNavigate,
}: {
  current: string | undefined;
  compact: boolean;
  onNavigate?: () => void;
}) {
  const workspaces = useWorkspaces();
  const list = workspaces.data ?? [];
  const selected = list.find((w) => w.id === current) ?? list[0];
  const data = useNavData(selected?.id);
  const ws = selected?.id;
  return (
    <Box
      component="nav"
      aria-label="Navigation"
      sx={{
        overflowY: "auto",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        pt: isMac() ? 0 : 2,
      }}
    >
      {/* Sticky: a scroll of the navigation never moves an item under the traffic lights. */}
      {isMac() && (
        <Box
          className="aw-drag"
          sx={{
            height: TITLE_ROW,
            flex: "none",
            position: "sticky",
            top: 0,
            zIndex: 1,
            bgcolor: "aw.canvas",
          }}
        />
      )}
      {selected && (
        <Box sx={{ px: 2, pb: 1, display: "flex", justifyContent: "center" }}>
          <WorkspaceSwitcher current={selected} compact={compact} />
        </Box>
      )}
      {ws && (
        <List disablePadding>
          <NavItem
            to={`/w/${ws}/inbox`}
            compact={compact}
            icon={<Inbox fontSize="small" />}
            label="Inbox"
            count={data.needsYou}
            you
            onNavigate={onNavigate}
          />
          <NavItem
            to={`/w/${ws}/tasks`}
            exact
            compact={compact}
            icon={<ViewKanban fontSize="small" />}
            label="All tasks"
            count={data.active}
            onNavigate={onNavigate}
          />
          <NavSection
            label="Projects"
            compact={compact}
            {...(selected ? { action: <AddProjectButton ws={selected} /> } : {})}
          />
          <ProjectRows ws={ws} tasks={data.tasks} compact={compact} onNavigate={onNavigate} />
          <NavSection label="Workspace" compact={compact} />
          <NavItem
            to={`/w/${ws}/knowledge`}
            compact={compact}
            icon={<MenuBook fontSize="small" />}
            label="Shared knowledge"
            onNavigate={onNavigate}
          />
          <NavItem
            to={`/w/${ws}/credentials`}
            compact={compact}
            icon={<Key fontSize="small" />}
            label="Credentials"
            onNavigate={onNavigate}
          />
        </List>
      )}
      <List disablePadding>
        <NavSection label="This device" compact={compact} />
        {ws && (
          <NavItem
            to={`/w/${ws}/devices`}
            compact={compact}
            icon={<Devices fontSize="small" />}
            label="Devices & sync"
            onNavigate={onNavigate}
          />
        )}
        <NavItem
          to="/settings"
          compact={compact}
          icon={<SettingsIcon fontSize="small" />}
          label="Settings"
          onNavigate={onNavigate}
        />
      </List>
      <Box sx={{ flex: 1 }} />
      {ws && (
        <Box
          sx={{
            position: "sticky",
            bottom: 0,
            flex: "none",
            bgcolor: "aw.canvas",
            borderTop: 1,
            borderColor: "divider",
          }}
        >
          <SidebarFooter ws={ws} compact={compact} sync={data.sync} />
        </Box>
      )}
    </Box>
  );
}

/** The breadcrumb of the top bar (docs/design.md 8.3): below 600 px only its last part. */
function Breadcrumb({ ws, narrow }: { ws: string | undefined; narrow: boolean }) {
  const { pathname } = useLocation();
  const { task } = useParams();
  const workspaces = useWorkspaces().data;
  const projects = useProjects(ws).data;
  const taskView = useTask(ws, task).data;
  const workspace = workspaces?.find((w) => w.id === ws);
  const parts = crumbs(pathname, {
    workspace: workspace ? workspaceName(workspace) : undefined,
    project: (slug) => projects?.find((p) => p.slug === slug)?.name ?? slug,
    task: taskView,
  });
  const shown = narrow ? parts.slice(-1) : parts;
  return (
    <Breadcrumbs
      aria-label="Breadcrumb"
      separator={<ChevronRight sx={{ fontSize: 14, color: "text.secondary" }} />}
      sx={{
        flex: 1,
        minWidth: 0,
        "& .MuiBreadcrumbs-ol": { flexWrap: "nowrap" },
        "& .MuiBreadcrumbs-li": { minWidth: 0 },
      }}
    >
      {shown.map((part, i) => {
        const first = i === 0 && !narrow && part.to === `/w/${ws}/inbox` && workspace;
        const label = (
          <Stack
            component="span"
            direction="row"
            spacing={1.5}
            sx={{ alignItems: "center", minWidth: 0 }}
          >
            {first && <LetterTile name={part.label} size={16} />}
            <Box
              component="span"
              sx={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                ...(part.mono ? { fontFamily: "var(--aw-font-mono)" } : {}),
              }}
            >
              {part.label}
            </Box>
          </Stack>
        );
        return part.to ? (
          <Link
            key={part.label}
            component={RouterLink}
            to={part.to}
            underline="hover"
            color="text.secondary"
            variant="body1"
            sx={{ display: "flex", minWidth: 0 }}
          >
            {label}
          </Link>
        ) : (
          <Typography
            key={part.label}
            variant="body1"
            color="text.primary"
            aria-current="page"
            sx={{ fontWeight: "fontWeightMedium", display: "flex", minWidth: 0 }}
          >
            {label}
          </Typography>
        );
      })}
    </Breadcrumbs>
  );
}

/** A key hint of a button (docs/design.md 8.10.3). Screen readers read the tooltip instead. */
function KeyHint({ children }: { children: string }) {
  return (
    <Box
      component="kbd"
      aria-hidden
      sx={{
        ml: 1,
        px: 1,
        minWidth: 16,
        height: 16,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 1,
        border: 1,
        borderColor: "currentColor",
        opacity: 0.7,
        typography: "caption",
        lineHeight: 1,
        fontFamily: "var(--aw-font-mono)",
      }}
    >
      {children}
    </Box>
  );
}

function ConnectionBanner() {
  const connection = useConnection();
  const now = useNow(1000, connection.state === "offline");
  if (connection.state !== "offline") return null;
  const next =
    connection.retryAt === null ? null : Math.max(0, Math.ceil((connection.retryAt - now) / 1000));
  return (
    <Alert severity="warning" square sx={{ py: 0 }}>
      awd is not reachable: {connection.reason}.
      {next !== null ? ` Next try in ${next} s.` : " Connecting again."} The screens show the last
      loaded data.
    </Alert>
  );
}

/**
 * Runs the commands of the app menu (CmdOrCtrl+N, CmdOrCtrl+R), the Tray ("Sync now") and a
 * notification click (open a task).
 */
function MenuCommands() {
  const dialogs = useDialogs();
  const navigate = useNavigate();
  const { project } = useParams();
  const task = usePageTask();
  useEffect(
    () =>
      bridge().onCommand((command) => {
        // A menu command does not replace an open dialog: the draft of the dialog stays (fc1-d3).
        if (typeof command === "string" && dialogs.isOpen()) return;
        if (command === "new-task") dialogs.newTask(project);
        else if (command === "new-session") dialogs.newSession(task);
        else if (command === "sync-now") dialogs.sync();
        else if (typeof command === "object" && command.open === "task") {
          void navigate(
            `/w/${encodeURIComponent(command.ws)}/tasks/${encodeURIComponent(command.task)}`,
          );
        }
      }),
    [dialogs, project, task, navigate],
  );
  return null;
}

/** ⌘K and ⌘1 to ⌘4 with the project and the task of the page (openspec navigation-prototype). */
function Shortcuts({ ws }: { ws: string | undefined }) {
  const { project } = useParams();
  const task = usePageTask();
  return <CommandMenu ws={ws} project={project ?? null} task={task} />;
}

function TopBar({ onMenu, ws }: { onMenu?: () => void; ws: string | undefined }) {
  const dialogs = useDialogs();
  const { project } = useParams();
  const task = usePageTask();
  const data = useNavData(ws);
  // Below 600 px: the last breadcrumb part and icons only; below 840 px Sync and New session are
  // icons; the sync state shows from 1200 px (docs/design.md 8.3).
  const narrow = useMediaQuery((theme: Theme) => theme.breakpoints.down("sm"));
  const compact = useMediaQuery((theme: Theme) => theme.breakpoints.down("md"));
  const wide = useMediaQuery((theme: Theme) => theme.breakpoints.up("lg"));
  return (
    <Stack
      direction="row"
      spacing={1}
      className="aw-drag"
      sx={{
        alignItems: "center",
        // With no sidebar on the left, the traffic lights of macOS sit in this row.
        pl: onMenu && isMac() ? `${TRAFFIC_LIGHTS_WIDTH}px` : 4,
        pr: 3,
        minHeight: TITLE_ROW,
        flex: "none",
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "background.default",
      }}
    >
      {onMenu && (
        <IconButton aria-label="Open the navigation" onClick={onMenu}>
          <MenuIcon fontSize="small" />
        </IconButton>
      )}
      <Breadcrumb ws={ws} narrow={narrow} />
      {/* With no workspace, these actions do nothing: the first-run screen has the next step (F-32). */}
      {ws && data.needsYou > 0 && (
        <Tooltip title="Open the Inbox (⌘1)">
          <Button
            component={RouterLink}
            to={`/w/${ws}/inbox`}
            aria-label={`Needs you: ${data.needsYou}`}
            startIcon={<PanTool sx={{ fontSize: 16 }} />}
            sx={{
              color: "warning.main",
              bgcolor: tint(mainVar("warning"), 14),
              "&:hover": { bgcolor: tint(mainVar("warning"), 20) },
            }}
          >
            {narrow ? data.needsYou : `Needs you ${data.needsYou}`}
          </Button>
        </Tooltip>
      )}
      {ws && wide && <SyncState ws={ws} {...data.sync} />}
      {ws &&
        (compact ? (
          <>
            <Tooltip title="Sync now (⌘R)">
              <IconButton aria-label="Sync now" onClick={() => dialogs.sync()}>
                <Sync fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="New session">
              <IconButton aria-label="New session" onClick={() => dialogs.newSession(task)}>
                <Terminal fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip title="Sync now (⌘R)">
              <Button variant="outlined" startIcon={<Sync />} onClick={() => dialogs.sync()}>
                Sync now
              </Button>
            </Tooltip>
            <Button
              variant="outlined"
              startIcon={<Terminal />}
              onClick={() => dialogs.newSession(task)}
            >
              New session
            </Button>
          </>
        ))}
      {ws &&
        (narrow ? (
          <Tooltip title="New task (⌘N)">
            <IconButton aria-label="New task" onClick={() => dialogs.newTask(project)}>
              <Add fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : (
          <Tooltip title="New task (⌘N)" describeChild>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => dialogs.newTask(project)}
            >
              New task
              <KeyHint>⌘N</KeyHint>
            </Button>
          </Tooltip>
        ))}
    </Stack>
  );
}

export function AppShell() {
  const { ws } = useParams();
  const workspaces = useWorkspaces();
  const phone = useMediaQuery((theme: Theme) => theme.breakpoints.down("sm"));
  const wide = useMediaQuery((theme: Theme) => theme.breakpoints.up("lg"));
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  // A route with no workspace (Settings) keeps the last workspace of the session.
  const [last, setLast] = useState<string | undefined>(ws);
  useEffect(() => {
    if (ws) setLast(ws);
  }, [ws]);
  const known = workspaces.data?.some((w) => w.id === last) ? last : undefined;
  const current = ws ?? known ?? workspaces.data?.[0]?.id;
  useEffect(() => setDrawer(false), [location.pathname]);
  const width = wide ? DRAWER_WIDTH : RAIL_WIDTH;
  return (
    <DialogsProvider ws={current}>
      <MenuCommands />
      <Shortcuts ws={current} />
      <RecoveryPhraseGate />
      <Box
        sx={{
          display: "flex",
          height: "100vh",
          bgcolor: "background.default",
          color: "text.primary",
        }}
      >
        {phone ? (
          <Drawer
            open={drawer}
            onClose={() => setDrawer(false)}
            slotProps={{ paper: { sx: { width: DRAWER_WIDTH } } }}
          >
            <Sidebar current={current} compact={false} onNavigate={() => setDrawer(false)} />
          </Drawer>
        ) : (
          <Box
            sx={{
              width,
              flex: "none",
              borderRight: 1,
              borderColor: "divider",
              bgcolor: "aw.canvas",
            }}
          >
            <Sidebar current={current} compact={!wide} />
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <TopBar onMenu={phone ? () => setDrawer(true) : undefined} ws={current} />
          <ConnectionBanner />
          <Box component="main" sx={{ flex: 1, minHeight: 0 }}>
            <Outlet />
          </Box>
        </Box>
      </Box>
    </DialogsProvider>
  );
}

/** `/`: the Inbox of the first workspace. */
export function Home() {
  const workspaces = useWorkspaces();
  if (workspaces.isPending) return <Typography sx={{ p: 4 }}>Loading…</Typography>;
  // No data is not "no workspace": awd can be down (desktop-shell review 8).
  if (workspaces.isError) {
    return (
      <Alert severity="error" sx={{ m: 4 }}>
        {errorText(workspaces.error)}
      </Alert>
    );
  }
  const first = workspaces.data[0];
  if (!first) return <FirstWorkspace />;
  return <Navigate to={`/w/${first.id}/inbox`} replace />;
}
