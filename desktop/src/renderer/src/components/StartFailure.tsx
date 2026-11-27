// The failed start of a task in the task header, with "Restart agent" (openspec restart-agent).
import ErrorOutline from "@mui/icons-material/ErrorOutlineOutlined";
import Replay from "@mui/icons-material/Replay";
import Schedule from "@mui/icons-material/ScheduleOutlined";
import { Alert, Button, Chip } from "@mui/material";
import type { Task } from "../../../shared/channels.ts";
import { errorText } from "../bridge.ts";
import { useAssignTask } from "../queries.ts";
import { canRestart, startFailureOf, startFailureText } from "../start-failure-model.ts";

/**
 * "Did not start on <device>: <cause>" with "Restart agent", or "Starting again on <device>…".
 * "Restart agent" assigns the same agent again with no options: the task keeps its options and its
 * host choice, and the device tries the start at once.
 */
export function StartFailureNotice({ ws, task }: { ws: string; task: Task }) {
  const assign = useAssignTask(ws);
  const failure = startFailureOf(task);
  if (!failure) return null;
  const text = startFailureText(failure);
  if (failure.retrying) {
    return <Chip icon={<Schedule />} label={text} variant="outlined" />;
  }
  return (
    <>
      <Chip
        icon={<ErrorOutline />}
        label={text}
        color="error"
        variant="outlined"
        sx={{ maxWidth: "100%", height: "auto", "& .MuiChip-label": { whiteSpace: "normal" } }}
      />
      {canRestart(task) && task.assignee && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<Replay />}
          disabled={assign.isPending}
          onClick={() => assign.mutate({ task: task.id, assignee: task.assignee! })}
        >
          Restart agent
        </Button>
      )}
      {assign.isError && <Alert severity="error">{errorText(assign.error)}</Alert>}
    </>
  );
}
