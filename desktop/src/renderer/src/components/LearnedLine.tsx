// The learning step of a task in its thread (openspec agent-learning, decision D3): "Nothing new
// learned by …", or "Learned by …: <path>" with Undo of that knowledge change
// (docs/architecture.md 4.8.3).
import { Alert, Button, Stack, Typography } from "@mui/material";
import type { ChangeResult, EventRow } from "../../../shared/channels.ts";
import { errorText } from "../bridge.ts";
import { useKbUndo } from "../queries.ts";

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** The one-line text of a `task.learned` event. */
export function learnedText(row: EventRow): string {
  const d = row.event.data;
  const by = row.event.by ?? row.dev;
  if (d.nothing_new === true) return `Nothing new learned by ${by}`;
  const waits = str(d.suggestion) ? " (waits for approval)" : "";
  return `Learned by ${by}: ${str(d.path) || "-"}${waits}`;
}

function undoText(result: ChangeResult): string {
  if (result.suggestion) return "The Undo waits for approval.";
  if (result.unchanged) return "The file already has that version.";
  return "Undone.";
}

/** The thread line of a `task.learned` event, with Undo when it names a knowledge change. */
export function LearnedLine(props: { ws: string; row: EventRow; meta: string }) {
  const undo = useKbUndo(props.ws);
  const change = str(props.row.event.data.change);
  return (
    <Stack spacing={0.5} sx={{ py: 0.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
          {learnedText(props.row)} · {props.meta}
        </Typography>
        {change && (
          <Button
            size="small"
            disabled={undo.isPending || undo.isSuccess}
            onClick={() => undo.mutate(change)}
          >
            Undo
          </Button>
        )}
      </Stack>
      {undo.data && <Alert severity="info">{undoText(undo.data)}</Alert>}
      {undo.isError && <Alert severity="error">{errorText(undo.error)}</Alert>}
    </Stack>
  );
}
