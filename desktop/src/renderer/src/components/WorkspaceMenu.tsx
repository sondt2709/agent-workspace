// Create, rename and remove a workspace (openspec gap-setup, prd WS-01): the first-start screen
// and the workspace switcher of the navigation (openspec navigation-prototype).
import Check from "@mui/icons-material/CheckOutlined";
import ExpandMore from "@mui/icons-material/ExpandMoreOutlined";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { WorkspaceSummary } from "../../../shared/channels.ts";
import { errorText } from "../bridge.ts";
import { ADD_LOCATION_HELP, BAD_LOCATION } from "../create-model.ts";
import { initial, workspaceName } from "../nav-model.ts";
import { useStatus, useTasks, useWorkspaces } from "../queries.ts";
import { useInitWorkspace, useRemoveWorkspace, useRenameWorkspace } from "../setup-queries.ts";
import { useDialogs } from "./dialogs.tsx";
import { JoinWorkspaceDialog } from "./Pairing.tsx";
import { FolderField } from "./ProjectCreate.tsx";

/** The name of the default workspace (prd WS-01). */
export const DEFAULT_WORKSPACE = "Personal";

/**
 * Creates a workspace: a name and a location (openspec workspace-folder). awd makes
 * `<location>/<name>`, or `<name>-aw1` when that name is in use, and says so in `folder_note`.
 */
export function CreateWorkspaceDialog({
  onClose,
  initialName = "",
}: {
  onClose: () => void;
  initialName?: string;
}) {
  const create = useInitWorkspace();
  const navigate = useNavigate();
  const [name, setName] = useState(initialName);
  const [path, setPath] = useState("");
  const cleanPath = path.trim();
  const badPath = cleanPath.length > 0 && !cleanPath.startsWith("/");
  const done = create.data?.folder_note ? create.data : null;
  const open = (id: string) => {
    onClose();
    void navigate(`/w/${id}/inbox`);
  };
  if (done) {
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="ws-create-title">
        <DialogTitle id="ws-create-title">Workspace added</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="success">{done.folder_note}</Alert>
            <Typography variant="body2" color="text.secondary">
              Folder:{" "}
              <Box component="span" sx={{ fontFamily: "var(--aw-font-mono)" }}>
                {done.workspace.path}
              </Box>
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => open(done.workspace.id)}>
            Open the workspace
          </Button>
        </DialogActions>
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="ws-create-title">
      <DialogTitle id="ws-create-title">Add a workspace</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <FolderField
            label="Location"
            purpose="workspace"
            placeholder="~/AW"
            value={path}
            onChange={setPath}
            onPick={(folder) => setPath(folder.path)}
            error={badPath}
            helperText={badPath ? BAD_LOCATION : ADD_LOCATION_HELP}
          />
          {create.isError && <Alert severity="error">{errorText(create.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={name.trim().length === 0 || badPath || create.isPending}
          onClick={() =>
            create.mutate(
              { name: name.trim(), ...(cleanPath ? { parent: cleanPath } : {}) },
              {
                // A note means that AW used another folder name: the dialog shows it first.
                onSuccess: (reply) => {
                  if (!reply.folder_note) open(reply.workspace.id);
                },
              },
            )
          }
        >
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** The Home screen with no workspace: one click makes "Personal" (prd WS-01). */
export function FirstWorkspace() {
  const create = useInitWorkspace();
  const navigate = useNavigate();
  const [custom, setCustom] = useState(false);
  const [joining, setJoining] = useState(false);
  return (
    <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center", py: 10, px: 4 }}>
      <Typography variant="subtitle1">No workspace yet</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
        A workspace holds your projects, tasks and knowledge. AW makes the folder ~/AW/
        {DEFAULT_WORKSPACE} (or {DEFAULT_WORKSPACE}-aw1 when that name is in use) and syncs it to
        your other devices.
      </Typography>
      <Button
        variant="contained"
        disabled={create.isPending}
        onClick={() =>
          create.mutate(
            {},
            { onSuccess: (reply) => void navigate(`/w/${reply.workspace.id}/inbox`) },
          )
        }
      >
        Create the {DEFAULT_WORKSPACE} workspace
      </Button>
      <Link component="button" type="button" variant="body2" onClick={() => setCustom(true)}>
        Use another name or folder
      </Link>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
        Another computer has your workspace already? Do not create one here: a new workspace makes a
        new master key, and this computer then cannot join. Join with the pairing code of that
        computer.
      </Typography>
      <Button variant="outlined" onClick={() => setJoining(true)}>
        Join with a pairing code
      </Button>
      {create.isError && <Alert severity="error">{errorText(create.error)}</Alert>}
      {custom && <CreateWorkspaceDialog onClose={() => setCustom(false)} />}
      {joining && (
        <JoinWorkspaceDialog
          onClose={() => setJoining(false)}
          onJoined={(ws) => void navigate(`/w/${ws}/inbox`)}
        />
      )}
    </Stack>
  );
}

export function RenameDialog({ ws, onClose }: { ws: WorkspaceSummary; onClose: () => void }) {
  const rename = useRenameWorkspace();
  const [name, setName] = useState(ws.name ?? "");
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="ws-rename-title">
      <DialogTitle id="ws-rename-title">Rename the workspace</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            helperText="Your other devices get the new name when they sync."
            autoFocus
          />
          {rename.isError && <Alert severity="error">{errorText(rename.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={name.trim().length === 0 || rename.isPending}
          onClick={() =>
            rename.mutate({ ws: ws.id, name: name.trim() }, { onSuccess: () => onClose() })
          }
        >
          Rename
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function RemoveDialog({ ws, onClose }: { ws: WorkspaceSummary; onClose: () => void }) {
  const remove = useRemoveWorkspace();
  const navigate = useNavigate();
  // The open tasks of this device stay assigned to it after the remove (gap-setup workflow 1).
  const me = useStatus().data?.device.slug ?? null;
  const tasks = useTasks(ws.id).data ?? [];
  const left = tasks.filter(
    (t) =>
      me !== null &&
      !t.archived &&
      t.stage !== "done" &&
      t.assignee !== null &&
      t.assignee.slice(t.assignee.indexOf("@") + 1) === me,
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="ws-remove-title">
      <DialogTitle id="ws-remove-title">Remove {ws.name ?? ws.id} from this device?</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">
            This device stops syncing the workspace and runs no session for it. The files stay in{" "}
            {ws.path}. Your other devices keep the workspace.
          </Typography>
          {left.length > 0 && (
            <Alert severity="warning">
              These tasks stay assigned to {me}, which runs no session for them then:{" "}
              {left.map((t) => t.key ?? t.id).join(", ")}. Assign them to another device.
            </Alert>
          )}
          {remove.isError && <Alert severity="error">{errorText(remove.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          color="error"
          variant="contained"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(ws.id, {
              onSuccess: () => {
                onClose();
                void navigate("/");
              },
            })
          }
        >
          Remove
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** The letter tile of a workspace or a project (docs/design.md 8.2: no color, color means status). */
export function LetterTile({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <Box
      aria-hidden
      component="span"
      sx={{
        width: size,
        height: size,
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 1,
        bgcolor: "aw.selected",
        color: "aw.text2",
        typography: "overline",
        lineHeight: 1,
      }}
    >
      {initial(name)}
    </Box>
  );
}

/**
 * The workspace switcher at the top of the navigation (docs/design.md 8.2.3): each workspace of
 * this device with its folder, then Add a project, Add a workspace, Rename and Remove from this
 * device. "Join with a pairing code" stays on the first-run screen (openspec navigation-prototype).
 */
export function WorkspaceSwitcher({
  current,
  compact = false,
}: {
  current: WorkspaceSummary;
  compact?: boolean;
}) {
  const dialogs = useDialogs();
  const navigate = useNavigate();
  const workspaces = useWorkspaces().data ?? [current];
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const name = workspaceName(current);
  const pick = (next: "rename" | "remove" | "add" | "project") => {
    setAnchor(null);
    if (next === "project") dialogs.addProject(current.id);
    else if (next === "add") dialogs.workspace("add");
    else dialogs.workspace(next, current);
  };
  const button = (
    <ButtonBase
      aria-label="Switch workspace"
      aria-haspopup="menu"
      aria-expanded={anchor !== null}
      onClick={(e) => setAnchor(e.currentTarget)}
      sx={{
        width: compact ? 36 : "100%",
        height: 32,
        px: compact ? 0 : 2,
        gap: 2,
        borderRadius: 1.5,
        justifyContent: compact ? "center" : "flex-start",
        "&:hover": { bgcolor: "aw.hover" },
      }}
    >
      <LetterTile name={name} />
      {!compact && (
        <>
          <Typography
            variant="subtitle1"
            component="span"
            noWrap
            sx={{ flex: 1, textAlign: "left" }}
          >
            {name}
          </Typography>
          <ExpandMore fontSize="small" sx={{ color: "text.secondary" }} />
        </>
      )}
    </ButtonBase>
  );
  return (
    <>
      {compact ? (
        <Tooltip title={`${name} · Switch workspace`} placement="right">
          {button}
        </Tooltip>
      ) : (
        button
      )}
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { width: 280 } } }}
      >
        <ListSubheader sx={{ bgcolor: "transparent", lineHeight: "28px" }}>
          Workspaces
        </ListSubheader>
        {workspaces.map((w) => (
          <MenuItem
            key={w.id}
            selected={w.id === current.id}
            onClick={() => {
              setAnchor(null);
              void navigate(`/w/${w.id}/inbox`);
            }}
            sx={{ gap: 2 }}
          >
            <LetterTile name={workspaceName(w)} />
            <ListItemText
              primary={workspaceName(w)}
              secondary={w.path}
              slotProps={{
                primary: { noWrap: true },
                secondary: { noWrap: true, sx: { fontFamily: "var(--aw-font-mono)" } },
              }}
            />
            {w.id === current.id && <Check fontSize="small" aria-label="Current workspace" />}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={() => pick("project")}>Add a project…</MenuItem>
        <MenuItem onClick={() => pick("add")}>Add a workspace…</MenuItem>
        <Divider />
        <MenuItem onClick={() => pick("rename")}>Rename…</MenuItem>
        <MenuItem onClick={() => pick("remove")}>Remove from this device…</MenuItem>
      </Menu>
    </>
  );
}
