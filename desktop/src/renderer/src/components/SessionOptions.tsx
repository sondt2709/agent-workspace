// The session options (openspec session-options): the fields of New task, New session and
// "Assign to another device…", the chips of the task header, and the rows of the task Properties.
import ContentCopy from "@mui/icons-material/ContentCopyOutlined";
import FolderOpen from "@mui/icons-material/FolderOpenOutlined";
import GppMaybe from "@mui/icons-material/GppMaybeOutlined";
import Groups from "@mui/icons-material/GroupsOutlined";
import {
  Alert,
  Button,
  Chip,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { Task } from "../../../shared/channels.ts";
import { call, errorText } from "../bridge.ts";
import { useProjects, useStatus } from "../queries.ts";
import {
  CHECKOUT_WARNING,
  KEEP_BRANCH_WARNING,
  MODE_HELP,
  MODE_LABEL,
  NO_COMMIT_HINT,
  projectMode,
  shownOptions,
  SKIP_WARNING,
  WORK_IN_LABEL,
  worksInText,
  type OptionsForm,
  type PermissionMode,
  type WorkIn,
} from "../session-options-model.ts";
import { FolderField } from "./ProjectCreate.tsx";

const MODES: PermissionMode[] = ["default", "accept_edits", "skip"];
const WORK_IN: WorkIn[] = ["worktree", "checkout", "folder"];

/** The mode that a session gets from the form: the project default for "Project default". */
export function effectiveMode(value: OptionsForm, projectDefault: PermissionMode): PermissionMode {
  return value.mode === "project" ? projectDefault : value.mode;
}

/**
 * The Permissions menu. New task shows it next to the assignee (openspec permissions-default); the
 * other dialogs show it in the Session block. The caller shows the skip warning below it.
 */
export function PermissionsField(props: {
  value: OptionsForm;
  onChange: (value: OptionsForm) => void;
  projectDefault: PermissionMode;
  disabled?: boolean;
  fullWidth?: boolean;
}) {
  const { value, onChange } = props;
  const mode = effectiveMode(value, props.projectDefault);
  return (
    <TextField
      select
      label="Permissions"
      value={value.mode}
      fullWidth={props.fullWidth}
      disabled={props.disabled}
      onChange={(e) => onChange({ ...value, mode: e.target.value as OptionsForm["mode"] })}
      helperText={MODE_HELP[mode]}
    >
      <MenuItem value="project">Project default · {MODE_LABEL[props.projectDefault]}</MenuItem>
      {MODES.map((m) => (
        <MenuItem key={m} value={m}>
          {MODE_LABEL[m]}
        </MenuItem>
      ))}
    </TextField>
  );
}

/** The `err` warning of "Skip permissions" (check soc-1). */
export function SkipWarning() {
  return <Alert severity="error">{SKIP_WARNING}</Alert>;
}

/**
 * The fields of the session options. `here`: the session runs on this device, so "Choose…" opens
 * the folder dialog; for another device the person types the absolute folder of that device.
 * `permissions={false}` leaves out the Permissions menu: New task shows it at the top.
 */
export function SessionOptionsFields(props: {
  value: OptionsForm;
  onChange: (value: OptionsForm) => void;
  /** The default mode of the project. */
  projectDefault: PermissionMode;
  /** The device of the session, or "" when not known yet. */
  device: string;
  here: boolean;
  disabled?: boolean;
  /** Show the Permissions menu in this block (default true). */
  permissions?: boolean;
  /** The checkout has no commit: "Separate worktree" is disabled (openspec project-checkout-no-worktree). */
  worktreeBlocked?: boolean;
}) {
  const { value, onChange } = props;
  const set = (patch: Partial<OptionsForm>) => onChange({ ...value, ...patch });
  const mode = effectiveMode(value, props.projectDefault);
  const permissions = props.permissions ?? true;
  return (
    <Stack spacing={2} component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
      <Typography variant="overline" color="text.secondary" component="legend">
        Session
      </Typography>
      {permissions && (
        <PermissionsField
          value={value}
          onChange={onChange}
          projectDefault={props.projectDefault}
          disabled={props.disabled}
        />
      )}
      {permissions && mode === "skip" && <SkipWarning />}
      <Stack spacing={0.25}>
        <FormControlLabel
          control={
            <Switch
              checked={value.teams}
              disabled={props.disabled}
              onChange={(e) => set({ teams: e.target.checked })}
            />
          }
          label="Agent teams"
        />
        <Typography variant="caption" color="text.secondary">
          Claude Code can start teammates. They run in the same terminal and get the same
          permissions.
        </Typography>
      </Stack>
      <Stack spacing={0.5}>
        <Typography variant="subtitle2" id="work-in-label">
          Work in
        </Typography>
        <RadioGroup
          row
          aria-labelledby="work-in-label"
          value={value.workIn}
          onChange={(e) => set({ workIn: e.target.value as WorkIn })}
        >
          {WORK_IN.map((w) => (
            <FormControlLabel
              key={w}
              value={w}
              control={<Radio />}
              disabled={props.disabled || (w === "worktree" && props.worktreeBlocked === true)}
              label={WORK_IN_LABEL[w]}
            />
          ))}
        </RadioGroup>
        {props.worktreeBlocked && (
          <Typography variant="caption" color="text.secondary">
            {NO_COMMIT_HINT}
          </Typography>
        )}
        {value.workIn === "worktree" && (
          <Typography variant="caption" color="text.secondary">
            AW makes a git worktree aw-&lt;key&gt; of the checkout. Your checkout does not change.
          </Typography>
        )}
        {value.workIn === "checkout" && (
          <>
            <FormControlLabel
              control={
                <Switch
                  checked={value.switchBranch}
                  disabled={props.disabled}
                  onChange={(e) => set({ switchBranch: e.target.checked })}
                />
              }
              label="Switch to the task branch"
            />
            <Alert severity="warning">
              {value.switchBranch ? CHECKOUT_WARNING : KEEP_BRANCH_WARNING}
            </Alert>
          </>
        )}
        {value.workIn === "folder" && (
          <FolderField
            label={props.device ? `Folder on ${props.device}` : "Folder"}
            purpose="session"
            value={value.folder}
            onPick={(folder) => set({ folder: folder.path })}
            onChange={(folder) => set({ folder })}
            placeholder="/work/billing-api/services/api"
            disabled={props.disabled}
            helperText={
              props.here
                ? "The agent works in this folder as it is: no worktree, no branch change."
                : `Type the absolute folder of ${props.device || "the device"}. "Choose…" shows the folders of this computer.`
            }
          />
        )}
      </Stack>
    </Stack>
  );
}

/** The default mode of the project of a task. */
function useProjectMode(ws: string, task: Task): PermissionMode {
  const projects = useProjects(ws);
  return projectMode(projects.data?.find((p) => p.slug === task.project));
}

/** The chips of the task header: "Skips permissions" in `err`, and "Agent teams". */
export function SessionOptionChips({ ws, task }: { ws: string; task: Task }) {
  const shown = shownOptions(task, useProjectMode(ws, task));
  return (
    <>
      {shown.mode === "skip" && (
        <Tooltip
          title={
            shown.running
              ? "The session runs each command with no gate."
              : "The next session runs each command with no gate."
          }
        >
          <Chip icon={<GppMaybe />} label="Skips permissions" color="error" />
        </Tooltip>
      )}
      {shown.teams && <Chip icon={<Groups />} label="Agent teams" variant="outlined" />}
    </>
  );
}

/** The rows of the task Properties: Permissions, Agent teams, and Works in with Copy and Open. */
export function SessionOptionRows({ ws, task }: { ws: string; task: Task }) {
  const shown = shownOptions(task, useProjectMode(ws, task));
  const status = useStatus();
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  const open = useMutation({ mutationFn: () => call("openSessionFolder", { ws, task: task.id }) });
  const here = shown.device !== null && shown.device === status.data?.device.slug;
  const when = shown.running ? "" : " (next session)";
  return (
    <>
      <Row label="Permissions">
        <Typography variant="body2" color={shown.mode === "skip" ? "error" : undefined}>
          {MODE_LABEL[shown.mode]}
          {when}
        </Typography>
      </Row>
      <Row label="Agent teams">
        <Typography variant="body2">
          {shown.teams ? "On" : "Off"}
          {when}
        </Typography>
      </Row>
      <Row label="Works in">
        <Typography
          variant="body2"
          sx={{
            fontFamily: shown.path ? "var(--aw-font-mono)" : undefined,
            overflowWrap: "anywhere",
          }}
        >
          {worksInText(shown, task.key)}
        </Typography>
        {shown.path && (
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              startIcon={<ContentCopy />}
              onClick={() => {
                navigator.clipboard.writeText(shown.path!).then(
                  () => setCopied("yes"),
                  () => setCopied("failed"),
                );
              }}
            >
              {copied === "yes" ? "Copied" : "Copy"}
            </Button>
            {here && (
              <Button
                size="small"
                startIcon={<FolderOpen />}
                disabled={open.isPending}
                onClick={() => open.mutate()}
              >
                Open
              </Button>
            )}
          </Stack>
        )}
        {shown.path && shown.device && !here && (
          <Typography variant="caption" color="text.secondary">
            The folder is on {shown.device}.
          </Typography>
        )}
        {copied === "failed" && (
          <Alert severity="error">The copy failed. Select the folder text and copy it.</Alert>
        )}
        {open.isError && <Alert severity="error">{errorText(open.error)}</Alert>}
      </Row>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="subtitle2" color="text.secondary">
        {label}
      </Typography>
      {children}
    </Stack>
  );
}
