// The "New projects" section of Settings (openspec permissions-default): the permission mode that
// each new project of a workspace gets. The value is in tasks/workspace.yaml, so each device of the
// workspace uses it. The menu saves at once, as Appearance does.
import { Alert, MenuItem, Stack, TextField } from "@mui/material";
import type { WorkspaceSummary } from "../../../shared/channels.ts";
import { errorText } from "../bridge.ts";
import { useWorkspaces } from "../queries.ts";
import {
  MODE_HELP,
  MODE_LABEL,
  SKIP_WARNING,
  type PermissionMode,
} from "../session-options-model.ts";
import { useEditWorkspace } from "../setup-queries.ts";
import { Section } from "./common.tsx";

const MODES: PermissionMode[] = ["default", "accept_edits", "skip"];

/** The label of the menu: with more than one workspace it names the workspace. */
export function newProjectsLabel(ws: WorkspaceSummary, count: number): string {
  const label = "Default permissions for new projects";
  return count > 1 ? `${label} · ${ws.name ?? ws.id}` : label;
}

/** The mode of the summary; an older awd sends none: the product default `skip`. */
export function newProjectsMode(ws: WorkspaceSummary): PermissionMode {
  return ws.new_project_permission_mode ?? "skip";
}

function WorkspaceMode({ ws, count }: { ws: WorkspaceSummary; count: number }) {
  const edit = useEditWorkspace();
  const saved = newProjectsMode(ws);
  const mode = edit.isPending ? (edit.variables.body.new_project_permission_mode ?? saved) : saved;
  return (
    <Stack spacing={1}>
      <TextField
        select
        label={newProjectsLabel(ws, count)}
        value={mode}
        disabled={edit.isPending || !ws.ready}
        onChange={(e) =>
          edit.mutate({
            ws: ws.id,
            body: { new_project_permission_mode: e.target.value as PermissionMode },
          })
        }
        helperText={MODE_HELP[mode]}
        sx={{ maxWidth: 480 }}
      >
        {MODES.map((m) => (
          <MenuItem key={m} value={m}>
            {MODE_LABEL[m]}
          </MenuItem>
        ))}
      </TextField>
      {mode === "skip" && <Alert severity="error">{SKIP_WARNING}</Alert>}
      {edit.isError && <Alert severity="error">{errorText(edit.error)}</Alert>}
    </Stack>
  );
}

export function NewProjectsCard() {
  const workspaces = useWorkspaces();
  const list = workspaces.data ?? [];
  if (list.length === 0) return null;
  return (
    <Section
      title="New projects"
      description="A new project gets this permission mode. It syncs to each device of the workspace. Existing projects keep their mode: change it in the project settings."
    >
      <Stack spacing={3}>
        {list.map((ws) => (
          <WorkspaceMode key={ws.id} ws={ws} count={list.length} />
        ))}
      </Stack>
    </Section>
  );
}
