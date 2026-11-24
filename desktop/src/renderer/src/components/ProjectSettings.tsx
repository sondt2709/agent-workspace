// The Settings page of a project (openspec gap-setup, prd WS-05 to WS-07, DEV-05, DEV-06, AGT-19):
// the shared settings in project.yaml (General, Devices, Test servers), and the bindings of this
// device (checkout, session host with where a session works, test slots, Use Orca), in sections
// (openspec screens-align), then Archive and Remove (openspec project-remove).
import ArrowDownward from "@mui/icons-material/ArrowDownwardOutlined";
import ArrowUpward from "@mui/icons-material/ArrowUpwardOutlined";
import Close from "@mui/icons-material/CloseOutlined";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useParams } from "react-router";
import type { BindingsView, EditProjectInput, Project } from "../../../shared/channels.ts";
import { errorText } from "../bridge.ts";
import { useDevices, useProjects } from "../queries.ts";
import {
  MODE_HELP,
  MODE_LABEL,
  projectMode,
  type PermissionMode,
} from "../session-options-model.ts";
import { useBindings, useEditBindings, useEditProject } from "../setup-queries.ts";
import { FolderField } from "./ProjectCreate.tsx";
import { RemoveProjectDialog, RemoveSection } from "./ProjectRemove.tsx";
import { LoadingRows, Section } from "./common.tsx";

const NAME = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;

/** The lines of a text field, without empty lines. */
export function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Parses "k3d=1, browser=2" into a resource map, or returns the error text. */
export function parseSlots(text: string): Record<string, number> | string {
  const result: Record<string, number> = {};
  for (const part of text
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    const match = /^([^=\s]+)\s*=\s*(\d{1,4})$/.exec(part);
    if (!match || !NAME.test(match[1]!) || Number(match[2]) < 1 || Number(match[2]) > 1000) {
      return `"${part}" is not name=capacity (capacity 1 to 1000)`;
    }
    result[match[1]!] = Number(match[2]);
  }
  return result;
}

function slotsText(resources: Record<string, number>): string {
  return Object.entries(resources)
    .map(([name, n]) => `${name}=${n}`)
    .join(", ");
}

function DeviceOrder({
  ws,
  devices,
  onChange,
}: {
  ws: string;
  devices: string[];
  onChange: (devices: string[]) => void;
}) {
  const known = useDevices(ws);
  const candidates = (known.data ?? [])
    .filter((d) => d.role !== "mobile" && d.state === "valid" && !devices.includes(d.slug))
    .map((d) => d.slug);
  const move = (from: number, to: number) => {
    const next = [...devices];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  return (
    <Box>
      <Typography variant="subtitle2" component="h3" color="text.secondary">
        Device order
      </Typography>
      <Typography variant="body2" color="text.secondary">
        The first device implements the tasks of the project. The next ones are the choices for a
        manual move.
      </Typography>
      <List
        dense
        aria-label="Device order"
        sx={{ my: 2, border: 1, borderColor: "divider", borderRadius: 1, py: 0 }}
      >
        {devices.length === 0 && (
          <ListItem>
            <ListItemText primary="No device yet" />
          </ListItem>
        )}
        {devices.map((slug, i) => (
          <ListItem
            key={slug}
            divider={i < devices.length - 1}
            secondaryAction={
              <>
                <IconButton
                  aria-label={`Move ${slug} up`}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  <ArrowUpward fontSize="small" />
                </IconButton>
                <IconButton
                  aria-label={`Move ${slug} down`}
                  disabled={i === devices.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ArrowDownward fontSize="small" />
                </IconButton>
                <IconButton
                  aria-label={`Remove ${slug}`}
                  onClick={() => onChange(devices.filter((d) => d !== slug))}
                >
                  <Close fontSize="small" />
                </IconButton>
              </>
            }
          >
            <ListItemText
              primary={`${i + 1}. ${slug}`}
              secondary={i === 0 ? "Implements the tasks" : null}
            />
          </ListItem>
        ))}
      </List>
      {candidates.length > 0 && (
        <FormControl sx={{ minWidth: 240 }}>
          <InputLabel id="add-device-label">Add a device</InputLabel>
          <Select
            labelId="add-device-label"
            label="Add a device"
            value=""
            displayEmpty
            renderValue={() => "Choose a device"}
            onChange={(e) => onChange([...devices, String(e.target.value)])}
          >
            {candidates.map((slug) => (
              <MenuItem key={slug} value={slug}>
                {slug}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
    </Box>
  );
}

function SharedSettings({ ws, project }: { ws: string; project: Project }) {
  const edit = useEditProject(ws, project.slug);
  const [name, setName] = useState(project.name);
  const [devices, setDevices] = useState(project.devices);
  const [agent, setAgent] = useState(project.default_agent);
  const [mainRepo, setMainRepo] = useState(project.main_repo ?? "");
  const [links, setLinks] = useState(
    project.links.filter((l) => l !== project.main_repo).join("\n"),
  );
  const [servers, setServers] = useState<string[]>(project.test_servers);
  // The name in the field that is not a chip yet: Save sends it too (screens-align check).
  const [typed, setTyped] = useState("");
  const [subtasks, setSubtasks] = useState(
    project.switches?.assign_new_subtasks_to_default_device ?? false,
  );
  const [mode, setMode] = useState<PermissionMode>(projectMode(project));
  const allServers = [...new Set([...servers, typed.trim()].filter(Boolean))];
  const badServer = allServers.find((s) => !NAME.test(s));
  const save = () => {
    const repo = mainRepo.trim();
    const body: EditProjectInput = {
      name: name.trim(),
      devices,
      default_agent: agent.trim(),
      main_repo: repo || null,
      links: repo ? [repo, ...lines(links).filter((l) => l !== repo)] : lines(links),
      test_servers: allServers,
      switches: { assign_new_subtasks_to_default_device: subtasks },
      permission_mode: mode,
    };
    edit.mutate(body);
  };
  return (
    <Stack spacing={6}>
      <Section title="General" description="These settings sync to each device of the workspace.">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="Default agent"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          helperText="The agent of new tasks, for example claude"
        />
        <TextField
          label="Main repository"
          value={mainRepo}
          onChange={(e) => setMainRepo(e.target.value)}
          placeholder="https://github.com/example/billing-api"
        />
        <TextField
          label="Other links"
          multiline
          minRows={2}
          value={links}
          onChange={(e) => setLinks(e.target.value)}
          helperText="One link on each line. Agents use them as defaults."
        />
      </Section>
      <Divider />
      <Section title="Devices">
        <DeviceOrder ws={ws} devices={devices} onChange={setDevices} />
        <FormControlLabel
          control={<Switch checked={subtasks} onChange={(e) => setSubtasks(e.target.checked)} />}
          label="Assign new subtasks to the default device"
        />
      </Section>
      <Divider />
      <Section
        title="Sessions"
        description="The permission mode of new sessions when a task sets none. A task can set its own."
      >
        <TextField
          select
          label="Permissions"
          value={mode}
          onChange={(e) => setMode(e.target.value as PermissionMode)}
          helperText={
            mode === "skip"
              ? "Only the tasks that a person creates get it. A subtask of an agent gets Default."
              : MODE_HELP[mode]
          }
        >
          {(["default", "accept_edits", "skip"] as const).map((m) => (
            <MenuItem key={m} value={m}>
              {MODE_LABEL[m]}
            </MenuItem>
          ))}
        </TextField>
        {mode === "skip" && (
          <Alert severity="error">
            The agents of this project run each command as you, with no gate. A hidden command can
            still act as you in AW: use it only for tasks you trust.
          </Alert>
        )}
      </Section>
      <Divider />
      <Section
        title="Test servers"
        description="The test servers that the tasks of this project can use."
      >
        <Autocomplete
          multiple
          freeSolo
          options={[]}
          value={servers}
          inputValue={typed}
          onInputChange={(_e, value) => setTyped(value)}
          onChange={(_e, value) => setServers(value.map((v) => v.trim()).filter(Boolean))}
          renderValue={(value, getItemProps) =>
            value.map((option, index) => {
              const { key, ...itemProps } = getItemProps({ index });
              return (
                <Chip
                  key={key}
                  label={option}
                  color={NAME.test(option) ? "default" : "error"}
                  {...itemProps}
                />
              );
            })
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label="Server names"
              placeholder={servers.length === 0 ? "k3d-lab" : undefined}
              error={badServer !== undefined}
              helperText={
                badServer
                  ? `${badServer} is not a test server name`
                  : "Names from secure/test-servers.yaml. Type a name and press Enter."
              }
            />
          )}
        />
      </Section>
      <Stack spacing={2}>
        {edit.isError && <Alert severity="error">{errorText(edit.error)}</Alert>}
        {edit.isSuccess && <Alert severity="success">Saved.</Alert>}
        <Stack
          direction="row"
          spacing={3}
          useFlexGap
          sx={{ alignItems: "center", flexWrap: "wrap" }}
        >
          <Button
            variant="contained"
            disabled={
              name.trim().length === 0 ||
              agent.trim().length === 0 ||
              badServer !== undefined ||
              edit.isPending
            }
            onClick={save}
          >
            Save
          </Button>
          <Typography variant="body2" color="text.secondary">
            Saves General, Devices, Sessions and Test servers for each device of the workspace.
          </Typography>
        </Stack>
      </Stack>
    </Stack>
  );
}

/** The help line under the session host (fix list ux-1): where a session of the project works. */
export const SESSION_FOLDER_HELP =
  "Each session works in its own git worktree aw-<key> on the branch aw/<key>, unless the task sets another Work in. With tmux, the worktree is in ~/.aw/worktrees/aw-<key>. With Orca, Orca makes the worktree aw-<key> in its own folder, and the task shows the path.";

function DeviceSettings({
  ws,
  project,
  bindings,
}: {
  ws: string;
  project: string;
  bindings: BindingsView;
}) {
  const edit = useEditBindings(ws);
  const checkout = bindings.checkouts.find((c) => c.project === project);
  const [path, setPath] = useState(checkout?.path ?? "");
  const [host, setHost] = useState<"default" | "tmux" | "orca">(
    checkout?.session_host ?? "default",
  );
  const [slots, setSlots] = useState(slotsText(bindings.resources));
  const parsed = parseSlots(slots);
  const badPath = path.trim().length > 0 && !path.trim().startsWith("/");
  const title = `This device: ${bindings.device}`;
  if (!bindings.may_run) {
    return (
      <Section title={title}>
        <Alert severity="info">
          {bindings.device} runs no agent, so it has no checkout or test slots.
        </Alert>
      </Section>
    );
  }
  return (
    <Section
      title={title}
      description="These settings are only for this device. Set them on each device that runs agents."
    >
      <FolderField
        label="Checkout folder"
        purpose="checkout"
        value={path}
        onChange={setPath}
        onPick={(folder) => setPath(folder.path)}
        error={badPath}
        placeholder="/path/to/billing-api"
        helperText="The absolute path of the git repository of the project on this device. Choose it, or paste it."
      />
      <Box>
        <FormControl sx={{ minWidth: 240 }}>
          <InputLabel id="host-label">Session host</InputLabel>
          <Select
            labelId="host-label"
            label="Session host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            aria-describedby="host-help"
          >
            <MenuItem value="default">
              Device default ({bindings.use_orca ? "Orca" : "tmux"})
            </MenuItem>
            <MenuItem value="tmux">tmux</MenuItem>
            <MenuItem value="orca">Orca</MenuItem>
          </Select>
          <FormHelperText id="host-help">{SESSION_FOLDER_HELP}</FormHelperText>
        </FormControl>
      </Box>
      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Button
          variant="contained"
          disabled={path.trim().length === 0 || badPath || edit.isPending}
          onClick={() =>
            edit.mutate({
              checkouts: [
                {
                  project,
                  path: path.trim(),
                  session_host: host === "default" ? null : host,
                },
              ],
            })
          }
        >
          Save checkout
        </Button>
        {checkout && (
          <Button
            variant="outlined"
            color="error"
            disabled={edit.isPending}
            onClick={() =>
              edit.mutate(
                { checkouts: [{ project, path: null }] },
                { onSuccess: () => setPath("") },
              )
            }
          >
            Remove checkout
          </Button>
        )}
      </Stack>
      <Box>
        <FormControlLabel
          control={
            <Switch
              checked={bindings.use_orca}
              disabled={edit.isPending}
              onChange={(e) => edit.mutate({ use_orca: e.target.checked })}
            />
          }
          label="Use Orca on this device"
        />
        <Typography variant="body2" color="text.secondary">
          When it is on, a new session of a project with the device default host runs in Orca. A
          running session keeps its host.
        </Typography>
      </Box>
      <TextField
        label="Test slots of this device"
        value={slots}
        onChange={(e) => setSlots(e.target.value)}
        error={typeof parsed === "string"}
        helperText={
          typeof parsed === "string"
            ? parsed
            : "For example k3d=1, browser=2: the count of sessions that can hold each resource at the same time. For each project of the device."
        }
      />
      <Box>
        <Button
          variant="outlined"
          disabled={typeof parsed === "string" || edit.isPending}
          onClick={() => {
            if (typeof parsed !== "string") edit.mutate({ resources: parsed });
          }}
        >
          Save test slots
        </Button>
      </Box>
      {edit.isError && <Alert severity="error">{errorText(edit.error)}</Alert>}
    </Section>
  );
}

function ArchiveSection({ ws, project }: { ws: string; project: Project }) {
  const edit = useEditProject(ws, project.slug);
  const archived = project.archived ?? false;
  return (
    <Section
      title={archived ? "Archived" : "Archive"}
      description={
        archived
          ? "The project gets no new tasks. Its tasks and files stay."
          : "An archived project gets no new tasks. AW keeps its tasks and files."
      }
    >
      {edit.isError && <Alert severity="error">{errorText(edit.error)}</Alert>}
      <Box>
        <Button
          color={archived ? "primary" : "error"}
          variant="outlined"
          disabled={edit.isPending}
          onClick={() => edit.mutate({ archived: !archived })}
        >
          {archived ? "Unarchive" : "Archive the project"}
        </Button>
      </Box>
    </Section>
  );
}

export function ProjectSettingsPage() {
  const { ws = "", project: slug = "" } = useParams();
  const projects = useProjects(ws);
  const bindings = useBindings(ws);
  const project = projects.data?.find((p) => p.slug === slug);
  // The remove dialog stays open when the removed project leaves the list (openspec project-remove).
  const [removing, setRemoving] = useState<Project | null>(null);
  return (
    <Box sx={{ overflowY: "auto", height: "100%" }}>
      <Stack spacing={6} sx={{ p: { xs: 4, sm: 6 }, maxWidth: 960, mx: "auto" }}>
        {/* The project frame shows the name and the tab (openspec navigation-prototype). */}
        {projects.isError && <Alert severity="error">{errorText(projects.error)}</Alert>}
        {projects.isPending && <LoadingRows rows={6} label="Loading the project" />}
        {projects.isSuccess && !project && (
          <Alert severity="warning">The project {slug} does not exist.</Alert>
        )}
        {project && (
          <Stack spacing={6} divider={<Divider flexItem />}>
            {/* The key resets the form when another device changes the project. */}
            <SharedSettings
              key={JSON.stringify({ ...project, tasks: [] })}
              ws={ws}
              project={project}
            />
            {bindings.isError && <Alert severity="error">{errorText(bindings.error)}</Alert>}
            {bindings.data && (
              <DeviceSettings
                // Another project or new bindings reset the form: no folder of another project.
                key={JSON.stringify({ ws, slug, bindings: bindings.data })}
                ws={ws}
                project={slug}
                bindings={bindings.data}
              />
            )}
            <ArchiveSection ws={ws} project={project} />
            <RemoveSection onOpen={() => setRemoving(project)} />
          </Stack>
        )}
        {removing && (
          <RemoveProjectDialog ws={ws} project={removing} onClose={() => setRemoving(null)} />
        )}
      </Stack>
    </Box>
  );
}
