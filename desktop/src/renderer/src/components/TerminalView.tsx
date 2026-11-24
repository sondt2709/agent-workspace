// The Terminal tab of the task detail, and the button "Open the terminal" / "Sign in" (openspec
// task-terminal-view). The tab shows the newest terminal snapshot of the task with its device and
// capture time. The main process opens Terminal.app or Orca for a session on this computer; for
// another device the card shows the command to copy.
import ContentCopy from "@mui/icons-material/ContentCopyOutlined";
import TerminalIcon from "@mui/icons-material/TerminalOutlined";
import { Alert, Box, Button, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import type { OpenTerminalResult, TerminalAction } from "../../../shared/channels.ts";
import { errorText } from "../bridge.ts";
import { useNow } from "../clock.ts";
import { ago } from "../model.ts";
import { useOpenTerminal, useTerminal } from "../queries.ts";

/** "Captured 14:20:05 on ubuntu-01 · 3 min ago", or the device alone with no time. */
export function capturedLine(device: string, at: string | null, now: number): string {
  if (at === null) return `Captured on ${device} · time not known`;
  const ms = Date.parse(at);
  const time = new Date(ms).toLocaleTimeString([], { hour12: false });
  return `Captured ${time} on ${device} · ${ago(ms, now)}`;
}

function OpenResult({ result }: { result: OpenTerminalResult }) {
  if (result.opened) {
    return (
      <Alert severity="success" variant="outlined">
        {result.via === "orca" ? "Opened in Orca" : "Opened in Terminal"}:{" "}
        <Box component="code" sx={{ fontFamily: "var(--aw-font-mono)" }}>
          {result.command}
        </Box>
      </Alert>
    );
  }
  return (
    <Alert severity="info" variant="outlined" sx={{ "& .MuiAlert-message": { minWidth: 0 } }}>
      <Typography variant="body2">{result.text}</Typography>
      {result.command && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 1 }}>
          <Box
            component="code"
            data-testid="terminal-command"
            sx={{
              fontFamily: "var(--aw-font-mono)",
              fontSize: 12,
              p: 1,
              borderRadius: 1,
              bgcolor: "action.selected",
              overflowWrap: "anywhere",
              flex: 1,
              minWidth: 0,
            }}
          >
            {result.command}
          </Box>
          <Tooltip title="Copy the command">
            <IconButton
              aria-label="Copy the command"
              onClick={() => void navigator.clipboard?.writeText(result.command!)}
            >
              <ContentCopy fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      )}
    </Alert>
  );
}

/** "Open the terminal" (attach) or "Sign in" (sign_in), with the result below. */
export function OpenTerminalButton({
  ws,
  task,
  action,
  variant = "outlined",
}: {
  ws: string;
  task: string;
  action: TerminalAction;
  variant?: "outlined" | "contained" | "text";
}) {
  const open = useOpenTerminal(ws, task);
  return (
    <Stack spacing={1}>
      <Box>
        <Button
          variant={variant}
          color="inherit"
          startIcon={<TerminalIcon />}
          disabled={open.isPending}
          onClick={() => open.mutate(action)}
        >
          {action === "attach" ? "Open the terminal" : "Sign in"}
        </Button>
      </Box>
      {open.data && <OpenResult result={open.data} />}
      {open.isError && <Alert severity="error">{errorText(open.error)}</Alert>}
    </Stack>
  );
}

export function TerminalView({ ws, task }: { ws: string; task: string }) {
  const query = useTerminal(ws, task);
  const now = useNow(10_000);
  if (query.isPending) return <Typography>Loading the terminal…</Typography>;
  if (query.isError) return <Alert severity="error">{errorText(query.error)}</Alert>;
  const reply = query.data;
  return (
    <Stack spacing={2} data-testid="terminal-view">
      {reply.snapshot && (
        <Typography variant="caption" color="text.secondary">
          {capturedLine(reply.snapshot.device, reply.snapshot.captured_at, now)}
        </Typography>
      )}
      {reply.snapshot ? (
        <Box
          component="pre"
          data-testid="terminal-snapshot"
          sx={{
            m: 0,
            p: 2,
            borderRadius: 2,
            bgcolor: "aw.term",
            color: "aw.termFg",
            fontFamily: "var(--aw-font-mono)",
            fontSize: 12,
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            maxHeight: "60vh",
            overflow: "auto",
          }}
        >
          {reply.snapshot.text || " "}
        </Box>
      ) : null}
      {reply.note && (
        <Typography variant="body2" color="text.secondary">
          {reply.note}
        </Typography>
      )}
      {!reply.snapshot && !reply.note && (
        <Typography variant="body2" color="text.secondary">
          No terminal snapshot yet.
        </Typography>
      )}
      {reply.open && <OpenTerminalButton ws={ws} task={task} action="attach" />}
      <Typography variant="caption" color="text.secondary">
        A snapshot of the session screen, written by the session device at most every 30 s when the
        screen changes, and at each gate. Credential values show as [redacted:&lt;name&gt;].
      </Typography>
    </Stack>
  );
}
