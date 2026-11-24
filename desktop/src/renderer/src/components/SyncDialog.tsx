// The Sync dialog (the "Sync" button, the menu item "Sync now" on CmdOrCtrl+R, the Tray) and the
// dialog "Assign to another device…" of a paused task (docs/decisions/2026-11-23-manual-move.md):
// Sync only syncs and shows the result; it suggests no move. A move is a human `task.assigned`
// that the person chooses.
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import type { Task } from "../../../shared/channels.ts";
import { errorText } from "../bridge.ts";
import {
  clockTime,
  otherDeviceChoices,
  sessionHostChoice,
  syncResultLines,
  type SessionHostName,
} from "../devices-model.ts";
import { details, pauseLabel, taskLabel } from "../model.ts";
import { useAssignTask, useProjects, useSessionHosts, useSyncNow } from "../queries.ts";
import {
  changedOptionsBody,
  formOf,
  formProblem,
  optionsField,
  projectMode,
  type OptionsForm,
} from "../session-options-model.ts";
import { chosenHost, sentHost, SessionHostPicker } from "./SessionHostPicker.tsx";
import { SessionOptionsFields } from "./SessionOptions.tsx";

export function SyncDialog({ onClose }: { onClose: () => void }) {
  const sync = useSyncNow();
  const started = useRef(false);
  const { mutate } = sync;
  useEffect(() => {
    // One run per open, also with the double effect of StrictMode.
    if (started.current) return;
    started.current = true;
    mutate(undefined);
  }, [mutate]);
  const reply = sync.data;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="sync-title">
      <DialogTitle id="sync-title">Sync</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {sync.isPending && (
            <Typography>Syncing with your devices… This stops after 20 s.</Typography>
          )}
          {sync.isError && <Alert severity="error">{errorText(sync.error)}</Alert>}
          {reply && (
            <>
              <Alert severity={reply.pending.length === 0 ? "success" : "warning"}>
                {syncResultLines(reply).map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </Alert>
              {reply.status.peers.length > 0 && (
                <List dense aria-label="Sync state of each device">
                  {reply.status.peers.map((peer) => (
                    <ListItem key={peer.device} disableGutters>
                      <ListItemText primary={peer.device} secondary={peer.text} />
                    </ListItem>
                  ))}
                </List>
              )}
              <Typography variant="caption" color="text.secondary">
                Synced at {clockTime(Date.parse(reply.at))}.
              </Typography>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => sync.mutate(undefined)} disabled={sync.isPending}>
          Sync again
        </Button>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** "Assign to another device…": the person chooses; nothing is selected at the start. */
export function AssignDeviceDialog(props: { ws: string; task: Task; onClose: () => void }) {
  const projects = useProjects(props.ws);
  const assign = useAssignTask(props.ws);
  const [choice, setChoice] = useState("");
  const choices = otherDeviceChoices(projects.data ?? [], props.task);
  const hosts = useSessionHosts(props.ws);
  const hostChoice = sessionHostChoice(hosts.data, choice.split("@")[1] ?? "", props.task.project);
  const [picked, setPicked] = useState<SessionHostName | null>(null);
  const host = chosenHost(hostChoice, picked);
  const paused = details(props.task).paused;
  // The options of the task, for the new session on the other device (openspec session-options).
  const [options, setOptions] = useState<OptionsForm>(() => formOf(props.task));
  const optionsProblem = formProblem(options);
  const project = (projects.data ?? []).find((p) => p.slug === props.task.project);
  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="sm" aria-labelledby="assign-title">
      <DialogTitle id="assign-title">Assign {taskLabel(props.task)} to another device</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {paused ? `Paused: ${pauseLabel(paused)}. ` : ""}
            The device that you choose claims the task and starts from the last pushed step. The
            work that {props.task.owner ?? "the old device"} did not push comes back as a branch
            when it wakes.
          </Typography>
          {choices.length === 0 ? (
            <Alert severity="info">
              The project has no other device. Add a device to the project first.
            </Alert>
          ) : (
            <RadioGroup
              aria-label="Agent and device"
              value={choice}
              onChange={(e) => {
                setChoice(e.target.value);
                setPicked(null);
              }}
            >
              {choices.map((agent) => (
                <FormControlLabel key={agent} value={agent} control={<Radio />} label={agent} />
              ))}
            </RadioGroup>
          )}
          {choice && (
            <SessionOptionsFields
              value={options}
              onChange={setOptions}
              projectDefault={projectMode(project)}
              device={choice.split("@")[1] ?? ""}
              here={false}
            />
          )}
          {choice && <SessionHostPicker choice={hostChoice} value={host} onChange={setPicked} />}
          {assign.isError && <Alert severity="error">{errorText(assign.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={
            !choice ||
            assign.isPending ||
            (hosts.isPending && picked === null) ||
            optionsProblem !== null
          }
          onClick={() =>
            assign.mutate(
              {
                task: props.task.id,
                assignee: choice,
                session_host: sentHost(hostChoice, picked, hosts.isSuccess),
                ...optionsField(changedOptionsBody(options, props.task)),
              },
              { onSuccess: () => props.onClose() },
            )
          }
        >
          Assign
        </Button>
      </DialogActions>
    </Dialog>
  );
}
