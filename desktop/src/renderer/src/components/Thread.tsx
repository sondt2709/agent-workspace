// The thread of a task: the raw text of each human and agent message, the gates, the approach
// versions and the system lines, in merge order (docs/workflow.md 2 and 4.3). Never a summary.
// The Session tab shows each event; the Activity tab shows the rows of the Activity rule
// (activity-model.ts, openspec task-view-focus) in a compact form.
import { Alert, Box, Button, Divider, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import type { EventRow, Task, ThreadPage } from "../../../shared/channels.ts";
import { activityLine, clampText, inActivity } from "../activity-model.ts";
import { errorText } from "../bridge.ts";
import { useNow } from "../clock.ts";
import { ago, details, gateLabel, hlcMs, stageLabel } from "../model.ts";
import { useSendMessage, useThread } from "../queries.ts";
import { MarkdownText, RawText } from "./common.tsx";
import { LearnedLine, learnedText } from "./LearnedLine.tsx";

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** The one-line text of a system event, or null for a message with its own body. */
export function systemLine(row: EventRow): string | null {
  const d = row.event.data;
  switch (row.type) {
    case "task.created":
      return `Created by ${row.event.by ?? row.dev}`;
    case "task.assigned":
      return `Assigned to ${str(d.assignee)}`;
    case "task.claimed":
      return `${str(d.device)} claimed the task (epoch ${String(d.epoch)})`;
    case "task.released":
      return `${row.dev} released the task (epoch ${String(d.epoch)})`;
    case "task.rekeyed":
      return `${str(d.from)} is now ${str(d.to)}`;
    case "task.edited":
      return `Edited ${str(d.field).replace("_", " ")}`;
    case "task.stage_changed":
      return `Stage: ${stageLabel(str(d.from))} → ${stageLabel(str(d.to))}`;
    case "task.paused":
      return `Paused: ${str(d.next_step) || str(d.cause)}`;
    case "task.resumed":
      return "Resumed";
    case "task.ready":
      return Array.isArray(d.missing) && d.missing.length > 0
        ? `aw ready: missing ${d.missing.map(String).join(", ")}`
        : "aw ready passed";
    case "task.progress":
      return `Progress: ${str(d.text)}`;
    case "task.done":
      return "Done";
    case "task.archived":
      return "Archived";
    case "task.unarchived":
      return "Unarchived";
    case "task.learned":
      return learnedText(row);
    case "gate.opened":
      return `${gateLabel(str(d.kind))} opened${str(d.title) ? `: ${str(d.title)}` : ""}`;
    case "gate.answered":
      return `${row.event.by ?? row.dev} answered: ${str(d.answer)}${str(d.comment) ? ` · ${str(d.comment)}` : ""}`;
    case "gate.resolved":
      return `${row.dev} resolved the gate: ${str(d.answer)}`;
    case "approach.proposed":
      return `Approach v${String(d.version)} (${str(d.file)})`;
    case "artifact.added":
      return `Artifact: ${str(d.path)}`;
    case "result.posted":
      return `Result posted: ${str(d.file)}`;
    case "handoff.written":
      return `Handoff written: ${str(d.file)}`;
    case "session.started":
      return `Session started on ${row.dev} in ${str(d.host)}`;
    case "session.resumed":
      return `Session resumed on ${row.dev}${str(d.text) ? `: ${str(d.text)}` : ""}`;
    case "session.ended":
      return `Session ended (${str(d.reason)})`;
    case "comment.added":
    case "message.human":
    case "message.agent":
    case "message.sent":
      return null;
    default:
      return row.type;
  }
}

type Mode = "session" | "activity";

function MessageRow(props: {
  who: string;
  meta: string;
  text: string;
  tone?: "agent" | "human";
  clamp?: boolean;
  /** Activity shows the text of the agent as Markdown; the Session tab shows the raw text. */
  markdown?: boolean;
}) {
  const [all, setAll] = useState(false);
  const { head, cut } = props.clamp ? clampText(props.text) : { head: props.text, cut: false };
  return (
    <Box
      sx={{
        borderLeft: 2,
        borderColor: props.tone === "agent" ? "info.main" : "divider",
        pl: 3,
        py: 1,
      }}
    >
      <Typography variant="caption" color="text.secondary">
        <b>{props.who}</b> · {props.meta}
      </Typography>
      {props.markdown ? (
        <MarkdownText text={cut && !all ? head : props.text} />
      ) : (
        <RawText text={cut && !all ? head : props.text} />
      )}
      {cut && (
        <Button size="small" onClick={() => setAll((v) => !v)} sx={{ mt: 0.5 }}>
          {all ? "Show less" : "Show more"}
        </Button>
      )}
    </Box>
  );
}

function Row({
  ws,
  row,
  delivered,
  now,
  mode,
}: {
  ws: string;
  row: EventRow;
  delivered: Set<string>;
  now: number;
  mode: Mode;
}) {
  const d = row.event.data;
  const when = ago(hlcMs(row.hlc), now);
  const by = row.event.by ?? row.dev;
  const notApplied = !row.applied && row.reason ? ` · not applied: ${row.reason}` : "";
  // Activity shows the first message once, as the description above the rows.
  if (row.type === "task.created" && mode === "session") {
    return (
      <MessageRow
        who={by}
        meta={`first message · ${when}${notApplied}`}
        text={str(d.first_message)}
      />
    );
  }
  if (row.type === "message.human") {
    if (mode === "activity") {
      return <MessageRow who={by} meta={`typed in the terminal · ${when}`} text={str(d.text)} />;
    }
    const delivery = str(d.delivery_id);
    return (
      <MessageRow
        who={by}
        meta={`${str(d.source)}${delivery ? ` · delivered ${delivery.slice(0, 8)}` : ""} · ${when}`}
        text={str(d.text)}
      />
    );
  }
  if (row.type === "message.agent") {
    return (
      <MessageRow
        who={by}
        tone="agent"
        meta={when}
        text={str(d.text)}
        clamp={mode === "activity"}
        markdown={mode === "activity"}
      />
    );
  }
  if (row.type === "message.sent") {
    const done = delivered.has(str(d.id));
    return (
      <MessageRow
        who={by}
        meta={`${done ? "sent" : "not delivered yet"} · ${when}`}
        text={str(d.text)}
      />
    );
  }
  if (row.type === "comment.added") {
    return <MessageRow who={by} meta={`comment · ${when}`} text={str(d.text)} />;
  }
  if (row.type === "task.learned") {
    return <LearnedLine ws={ws} row={row} meta={`${when}${notApplied}`} />;
  }
  return (
    <Typography variant="body2" color="text.secondary" sx={{ py: 0.5 }}>
      {(mode === "activity" ? activityLine(row) : null) ?? systemLine(row)} · {when}
      {notApplied}
    </Typography>
  );
}

function Page({
  ws,
  page,
  now,
  mode = "session",
  older = false,
}: {
  ws: string;
  page: ThreadPage;
  now: number;
  mode?: Mode;
  /** True when "Show older" can load more events. */
  older?: boolean;
}) {
  const delivered = new Set(
    page.events
      .filter((r) => r.type === "message.human" && typeof r.event.data.delivery_id === "string")
      .map((r) => str(r.event.data.delivery_id)),
  );
  const rows = mode === "activity" ? page.events.filter(inActivity) : page.events;
  if (rows.length === 0 && mode === "activity") {
    return (
      <Typography variant="body2" color="text.secondary">
        {older
          ? `No activity in the newest ${page.events.length} events. "Show older" loads more.`
          : "No activity yet."}{" "}
        The Session tab shows each event of the session.
      </Typography>
    );
  }
  return (
    <Stack
      spacing={1}
      component="section"
      aria-label={mode === "activity" ? "Activity" : "Session events"}
    >
      {rows.map((row) => (
        <Row key={row.id} ws={ws} row={row} delivered={delivered} now={now} mode={mode} />
      ))}
    </Stack>
  );
}

/**
 * The thread window of a task. `session` (the Session tab): each event, the ancestors and the
 * paging. `activity` (the Activity tab): only the rows of the Activity rule, with the same paging.
 */
export function Thread({ ws, task, mode = "session" }: { ws: string; task: Task; mode?: Mode }) {
  // The newest 500 events; "Show older" adds 500 (fix list 0-7, prd TSK-24). The page count
  // belongs to one task: another task starts with one page again.
  const [shown, setShown] = useState({ task: task.id, pages: 1 });
  const pages = shown.task === task.id ? shown.pages : 1;
  const thread = useThread(ws, task.id, pages);
  const now = useNow(30_000);
  const [ancestors, setAncestors] = useState(false);
  if (thread.isPending) return <Typography color="text.secondary">Loading the thread…</Typography>;
  if (thread.isError) return <Alert severity="error">{errorText(thread.error)}</Alert>;
  const reply = thread.data;
  return (
    <Stack spacing={2}>
      {mode === "session" && reply.ancestors.length > 0 && (
        <Box>
          <Button onClick={() => setAncestors((v) => !v)}>
            {ancestors ? "Hide the original conversation" : "Show the original conversation"}
          </Button>
          {ancestors &&
            reply.ancestors.map((page) => (
              <Box key={page.task.id} sx={{ opacity: 0.8 }}>
                <Typography variant="overline">
                  {page.task.key ?? page.task.id.slice(0, 8)}
                </Typography>
                <Page ws={ws} page={page} now={now} />
                <Divider sx={{ my: 2 }} />
              </Box>
            ))}
        </Box>
      )}
      {reply.prev && (
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Button
            variant="outlined"
            disabled={thread.isFetching}
            onClick={() => setShown({ task: task.id, pages: pages + 1 })}
          >
            Show older
          </Button>
          <Typography variant="caption" color="text.secondary">
            The thread shows the newest {reply.events.length} events.
          </Typography>
        </Stack>
      )}
      <Page ws={ws} page={reply} now={now} mode={mode} older={reply.prev !== null} />
    </Stack>
  );
}

/** The message box: raw text to the running session, delivered as its next input. */
export function Composer({ ws, task }: { ws: string; task: Task }) {
  const session = details(task).session;
  const running = session?.state === "running";
  const sendMessage = useSendMessage(ws, task.id);
  const [text, setText] = useState("");
  const send = () => {
    if (!text.trim() || !running) return;
    // Principle 8: the agent gets the original words; trim() only checks for an empty text.
    sendMessage.mutate(text, { onSuccess: () => setText("") });
  };
  return (
    <Stack spacing={1}>
      <TextField
        label="Message to the agent"
        placeholder={
          running
            ? task.needs_you.length > 0
              ? "It does not answer the gate. It arrives as the next input."
              : "It arrives as the next input of the session."
            : "No session runs. Assign the task to start a session."
        }
        multiline
        minRows={2}
        maxRows={8}
        value={text}
        disabled={!running}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
      />
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {running
            ? `⌘↵ to send · ${session.device} delivers it when no dialog is open`
            : "The next session reads the thread."}
        </Typography>
        <Button
          variant="contained"
          disabled={!running || !text.trim() || sendMessage.isPending}
          onClick={send}
        >
          Send
        </Button>
      </Stack>
      {sendMessage.isError && <Alert severity="error">{errorText(sendMessage.error)}</Alert>}
    </Stack>
  );
}
