// The "Remove" section of the project Settings page and its dialog (openspec project-remove). The
// dialog shows the open tasks and the running sessions that the remove stops, and asks the person to
// type the slug. After the remove it shows what this device kept, then opens the Inbox.
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { Project } from "../../../shared/channels.ts";
import { errorText } from "../bridge.ts";
import { useProjectRemoval, useRemoveProject } from "../setup-queries.ts";
import { DialogStatus, FOOTER_SX } from "./ProjectCreate.tsx";
import { LoadingRows, Section } from "./common.tsx";

/** The text of one cleanup item of this device: what AW removed or kept, and why. */
export function cleanupText(item: {
  key: string | null;
  task: string;
  path: string | null;
  branch: string | null;
  result: "removed" | "kept";
  reason: string | null;
}): string {
  const what =
    [item.path, item.branch].filter(Boolean).join(" on the branch ") || (item.key ?? item.task);
  return item.result === "removed" ? `Removed ${what}` : `Kept ${what}: ${item.reason ?? "kept"}`;
}

/**
 * The remove dialog. The Settings page keeps it open after the remove, when the project has left
 * the project list, so the person sees what this device kept.
 */
export function RemoveProjectDialog(props: { ws: string; project: Project; onClose: () => void }) {
  const { ws, project } = props;
  const navigate = useNavigate();
  const preview = useProjectRemoval(ws, project.slug, true);
  const remove = useRemoveProject(ws);
  const [typed, setTyped] = useState("");
  const result = remove.data;
  const confirmed = typed.trim() === project.slug;
  const close = () => {
    props.onClose();
    if (result) void navigate(`/w/${encodeURIComponent(ws)}/inbox`);
  };
  const kept = result?.cleanup.filter((c) => c.result === "kept") ?? [];
  return (
    <Dialog open onClose={close} fullWidth maxWidth="sm" aria-labelledby="project-remove-title">
      <DialogTitle id="project-remove-title">
        {result ? `${project.name} is removed` : `Remove ${project.name}?`}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {!result && (
            <>
              <Typography variant="body2">
                The project and its tasks leave each view on each device. Each device stops its
                sessions of the project, removes its checkout of the project, and removes the clean
                worktrees and aw/&lt;key&gt; branches. You can add {project.slug} again with another
                folder.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                AW keeps the task folders, project.yaml and each worktree or branch with unpushed
                work.
              </Typography>
              {preview.isPending && <LoadingRows rows={2} label="Loading the open tasks" />}
              {preview.isError && <Alert severity="error">{errorText(preview.error)}</Alert>}
              {preview.data && (
                <>
                  {preview.data.sessions.length > 0 && (
                    <Alert severity="warning">
                      These sessions stop:{" "}
                      {preview.data.sessions
                        .map((s) => `${s.key ?? s.task} on ${s.device}`)
                        .join(", ")}
                      .
                    </Alert>
                  )}
                  <Box>
                    <Typography variant="subtitle2">
                      {preview.data.tasks.length === 0
                        ? "No open task."
                        : `Open tasks (${preview.data.tasks.length})`}
                    </Typography>
                    {preview.data.tasks.map((t) => (
                      <Typography key={t.id} variant="body2" color="text.secondary">
                        {t.key ?? t.id} · {t.title ?? ""} · {t.stage}
                      </Typography>
                    ))}
                  </Box>
                </>
              )}
              <TextField
                label={`Type ${project.slug} to confirm`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                slotProps={{ htmlInput: { spellCheck: false } }}
              />
            </>
          )}
          {result && (
            <>
              <Alert severity={kept.length > 0 ? "warning" : "success"}>
                {project.slug} is removed. You can add {project.slug} again.
                {kept.length > 0 && " AW kept these items on this device:"}
              </Alert>
              {result.cleanup.map((item) => (
                <Typography
                  key={`${item.task}-${item.path ?? ""}-${item.branch ?? ""}`}
                  variant="body2"
                  color={item.result === "kept" ? "warning.main" : "text.secondary"}
                >
                  {cleanupText(item)}
                </Typography>
              ))}
              <Typography variant="body2" color="text.secondary">
                Each other device cleans its own worktrees and branches when it syncs.
              </Typography>
            </>
          )}
          {remove.isError && <Alert severity="error">{errorText(remove.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={FOOTER_SX}>
        <DialogStatus>
          {result
            ? "Close opens the Inbox."
            : confirmed
              ? "The remove syncs to each device."
              : `Type ${project.slug} to enable Remove.`}
        </DialogStatus>
        <Button onClick={close}>{result ? "Close" : "Cancel"}</Button>
        {!result && (
          <Button
            color="error"
            variant="outlined"
            disabled={!confirmed || remove.isPending || !preview.data}
            onClick={() => remove.mutate(project.slug)}
          >
            Remove project
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** The last section of the project Settings page. `onOpen` opens the dialog of the page. */
export function RemoveSection({ onOpen }: { onOpen: () => void }) {
  return (
    <Section
      title="Remove"
      description="Remove the project from AW, for example when it points to the wrong folder. Its tasks leave each view, and you can add the same slug again."
    >
      <Box>
        <Button color="error" variant="outlined" onClick={onOpen}>
          Remove the project…
        </Button>
      </Box>
    </Section>
  );
}
