// The task actions (openspec task-actions, docs/design.md 8.6.1): the "⋯" menu of the task header
// with Stop session, Archive task and Unarchive task, their confirm dialogs, and the Unarchive
// button of the Archived group of the List. Each action calls one awd service method, and a stop
// on any device is the person event `session.stop_requested`: the session device stops it.
import MoreHoriz from "@mui/icons-material/MoreHorizOutlined";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from "@mui/material";
import { useState } from "react";
import type { Task } from "../../../shared/channels.ts";
import { errorText } from "../bridge.ts";
import { details, taskLabel } from "../model.ts";
import { useArchiveTask, useStopTaskSession, useUnarchiveTask } from "../queries.ts";

/** The device of the running session of the task, or null when no session runs. */
export function runningSessionDevice(task: Task): string | null {
  const session = details(task).session;
  return session?.state === "running" ? session.device : null;
}

/** The texts of the archive confirm: with a running session, it names the device. */
export function archiveConfirmText(task: Task): { title: string; body: string; action: string } {
  const label = taskLabel(task);
  const device = runningSessionDevice(task);
  if (device === null) {
    return {
      title: `Archive ${label}?`,
      body: "The task leaves the Board and the lists, and shows in the Archived group of the List. AW keeps its files. You can unarchive it.",
      action: "Archive",
    };
  }
  return {
    title: `Stop the session and archive ${label}?`,
    body: `A session of this task runs on ${device}. AW stops that session first, then archives the task. ${device} stops it when it syncs. AW keeps the files, and you can unarchive the task.`,
    action: "Stop and archive",
  };
}

type Confirm = "stop" | "archive" | null;

/** The "⋯" menu of the task header. */
export function TaskActionsMenu({ ws, task }: { ws: string; task: Task }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const unarchive = useUnarchiveTask(ws);
  const device = runningSessionDevice(task);
  const pick = (next: Confirm) => {
    setAnchor(null);
    setConfirm(next);
  };
  return (
    <>
      <IconButton
        aria-label="Task actions"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <MoreHoriz fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {device !== null && <MenuItem onClick={() => pick("stop")}>Stop session…</MenuItem>}
        {task.archived ? (
          <MenuItem
            onClick={() => {
              setAnchor(null);
              unarchive.mutate(task.id);
            }}
          >
            Unarchive task
          </MenuItem>
        ) : (
          <MenuItem onClick={() => pick("archive")} sx={{ color: "error.main" }}>
            Archive task…
          </MenuItem>
        )}
      </Menu>
      {unarchive.isError && (
        <Alert severity="error" onClose={() => unarchive.reset()}>
          {errorText(unarchive.error)}
        </Alert>
      )}
      {confirm === "stop" && device !== null && (
        <StopSessionDialog ws={ws} task={task} device={device} onClose={() => setConfirm(null)} />
      )}
      {confirm === "archive" && (
        <ArchiveTaskDialog ws={ws} task={task} onClose={() => setConfirm(null)} />
      )}
    </>
  );
}

/** The confirm of Stop session: it names the session device. */
export function StopSessionDialog(props: {
  ws: string;
  task: Task;
  device: string;
  onClose: () => void;
}) {
  const stop = useStopTaskSession(props.ws, props.task.id);
  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="sm" aria-labelledby="stop-title">
      <DialogTitle id="stop-title">Stop the session on {props.device}?</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">
            {props.device} stops the agent of {taskLabel(props.task)} when it syncs. AW starts no
            new session until you start one with New session or Assign.
          </Typography>
          {stop.isError && <Alert severity="error">{errorText(stop.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button
          color="error"
          variant="contained"
          disabled={stop.isPending}
          onClick={() => stop.mutate(undefined, { onSuccess: props.onClose })}
        >
          Stop session
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** The one confirm of Archive task: with a running session, it stops the session first. */
export function ArchiveTaskDialog(props: { ws: string; task: Task; onClose: () => void }) {
  const archive = useArchiveTask(props.ws);
  const text = archiveConfirmText(props.task);
  const stop = runningSessionDevice(props.task) !== null;
  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="sm" aria-labelledby="archive-title">
      <DialogTitle id="archive-title">{text.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">{text.body}</Typography>
          {archive.isError && <Alert severity="error">{errorText(archive.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button
          color="error"
          variant="contained"
          disabled={archive.isPending}
          onClick={() =>
            archive.mutate({ task: props.task.id, stop }, { onSuccess: props.onClose })
          }
        >
          {text.action}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** "Unarchive" on a row of the Archived group of the List. */
export function UnarchiveButton({ ws, task }: { ws: string; task: Task }) {
  const unarchive = useUnarchiveTask(ws);
  return (
    <Button
      size="small"
      disabled={unarchive.isPending}
      aria-label={`Unarchive ${taskLabel(task)}`}
      onClick={() => unarchive.mutate(task.id)}
    >
      {unarchive.isError ? "Retry unarchive" : "Unarchive"}
    </Button>
  );
}
