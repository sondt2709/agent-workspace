// The queue of a waiting task (openspec queue-and-assign): the chip "Queued · 2nd for
// claude@ubuntu-01" and the cause that blocks it, for example "2 sessions working".
import Schedule from "@mui/icons-material/ScheduleOutlined";
import { Chip, Typography } from "@mui/material";
import type { TaskQueue } from "../queue-model.ts";

export function QueueChip({ queue }: { queue: TaskQueue }) {
  return (
    <>
      <Chip
        icon={<Schedule />}
        label={queue.label}
        variant="outlined"
        // The label wraps in a narrow Board card: the agent name stays readable.
        sx={{ maxWidth: "100%", height: "auto", "& .MuiChip-label": { whiteSpace: "normal" } }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
        {queue.cause}
      </Typography>
    </>
  );
}
