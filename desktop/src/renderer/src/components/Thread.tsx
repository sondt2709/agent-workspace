// The thread of a task: the raw text of each human and agent message, the gates, the proposal
// versions and the system lines, in merge order (docs/workflow.md 2 and 4.3). Never a summary.
// The Session tab shows each event; the Activity tab shows the rows of the Activity rule
// (activity-model.ts, openspec task-view-focus and proposal-and-discussion) in 3 row styles: a
// message, the proposal card and a task line, with the gate card of another gate kind in its place.
import { agentMessage } from "@aw/client/gates";
import { Alert, Box, Button, Divider, Stack, TextField, Typography } from "@mui/material";
import { useState, type Ref } from "react";
import type { EventRow, Task, ThreadPage } from "../../../shared/channels.ts";
import { activityRows, clampText, QUESTION_KINDS, type ActivityRow } from "../activity-model.ts";
import { errorText } from "../bridge.ts";
import { useNow } from "../clock.ts";
import {
  ago,
  answerNotice,
  details,
  gateLabel,
  hlcMs,
  refusedNotice,
  stageLabel,
} from "../model.ts";
import { useAnswerGate, useGateNotice, useSendMessage, useThread } from "../queries.ts";
import { MarkdownText, RawText } from "./common.tsx";
import { GateCard, QuestionMessage } from "./GateCard.tsx";
import { LearnedLine, learnedText } from "./LearnedLine.tsx";
import { ProposalCard } from "./ProposalCard.tsx";

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
    case "proposal.proposed":
      return `Proposal v${String(d.version)} (${str(d.file)})`;
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
  /** Activity shows the text of a message as Markdown; the Session tab shows the raw text. */
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

/** One event of the Session tab: the raw text of each message, a line for each other event. */
function SessionRow({
  ws,
  row,
  delivered,
  now,
}: {
  ws: string;
  row: EventRow;
  delivered: Set<string>;
  now: number;
}) {
  const d = row.event.data;
  const when = ago(hlcMs(row.hlc), now);
  const by = row.event.by ?? row.dev;
  const notApplied = !row.applied && row.reason ? ` · not applied: ${row.reason}` : "";
  if (row.type === "task.created") {
    return (
      <MessageRow
        who={by}
        meta={`first message · ${when}${notApplied}`}
        text={str(d.first_message)}
      />
    );
  }
  if (row.type === "message.human") {
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
    // The source (openspec agent-pushes-updates): a turn text shows only in Session.
    const source = d.source === "turn" ? "turn text · " : d.source === "tool" ? "message · " : "";
    return <MessageRow who={by} tone="agent" meta={`${source}${when}`} text={str(d.text)} />;
  }
  if (row.type === "message.sent") {
    const done = delivered.has(str(d.id));
    return (
      <MessageRow
        who={by}
        meta={`${d.kind === "nudge" ? "nudge · " : ""}${done ? "sent" : "not delivered yet"} · ${when}`}
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
  return <TaskLine text={systemLine(row) ?? row.type} when={when} notApplied={notApplied} />;
}

/** A task line: one muted line of 13 px (openspec proposal-and-discussion, app-style). */
function TaskLine(props: { text: string; when: string; notApplied?: string }) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ py: 0.5, fontSize: 13 }}>
      {props.text} · {props.when}
      {props.notApplied}
    </Typography>
  );
}

/** A message row of Activity: the text of the agent or of a person, as Markdown. */
function ActivityMessage({
  row,
  delivered,
  now,
}: {
  row: EventRow;
  delivered: Set<string>;
  now: number;
}) {
  const d = row.event.data;
  const when = ago(hlcMs(row.hlc), now);
  const by = row.event.by ?? row.dev;
  if (row.type === "message.human") {
    // A message of another agent of the session reads as that agent, as Markdown; a person
    // message as Markdown too (openspec task-review-layout, design decision 5).
    const other = agentMessage(str(d.text));
    if (other) {
      return (
        <MessageRow
          who={other.kind === "subagent_report" ? "Subagent report" : "Agent message"}
          tone="agent"
          meta={`arrived in the terminal · ${when}`}
          text={other.body}
          clamp
          markdown
        />
      );
    }
    return (
      <MessageRow
        who={by}
        meta={`typed in the terminal · ${when}`}
        text={str(d.text)}
        clamp
        markdown
      />
    );
  }
  if (row.type === "message.agent") {
    return <MessageRow who={by} tone="agent" meta={when} text={str(d.text)} clamp markdown />;
  }
  if (row.type === "message.sent") {
    const meta = `${delivered.has(str(d.id)) ? "sent" : "not delivered yet"} · ${when}`;
    return <MessageRow who={by} meta={meta} text={str(d.text)} clamp markdown />;
  }
  return <MessageRow who={by} meta={`comment · ${when}`} text={str(d.text)} clamp markdown />;
}

/** One row of Activity in its style. */
function ActivityItem({
  ws,
  task,
  item,
  delivered,
  now,
}: {
  ws: string;
  task: Task;
  item: ActivityRow;
  delivered: Set<string>;
  now: number;
}) {
  const row = item.row;
  const when = ago(hlcMs(row.hlc), now);
  const by = row.event.by ?? row.dev;
  const notApplied = !row.applied && row.reason ? ` · not applied: ${row.reason}` : "";
  switch (item.style) {
    case "message":
      if (item.kind === "question") {
        return (
          <QuestionMessage
            ws={ws}
            task={task}
            gate={task.gates.find((g) => g.gate === item.gate) ?? null}
            opened={row}
            title={item.title}
            text={item.text}
            open={item.open}
            note={item.note}
          />
        );
      }
      if (item.kind === "answer") {
        // An answer is person text: Markdown, as a message (task-review-layout).
        return (
          <MessageRow
            who={by}
            meta={`${item.label ?? "answer"} · ${when}${notApplied}`}
            text={item.text}
            clamp
            markdown
          />
        );
      }
      return <ActivityMessage row={row} delivered={delivered} now={now} />;
    case "proposal":
      return (
        <ProposalCard
          ws={ws}
          task={task}
          version={item.version}
          file={item.file}
          by={by}
          hlc={row.hlc}
          gate={item.gate}
          state={item.state}
          approvedBy={item.approvedBy}
          gateText={item.gateText}
        />
      );
    case "card": {
      // The task view decides: a gate that it has as resolved shows no card.
      const gate = task.gates.find((g) => g.gate === item.gate);
      if (!gate || gate.state !== "open") return null;
      return <GateCard ws={ws} task={task} gate={gate} />;
    }
    case "line":
      if (row.type === "task.learned") {
        return <LearnedLine ws={ws} row={row} meta={`${when}${notApplied}`} />;
      }
      return (
        <TaskLine
          text={item.line ?? systemLine(row) ?? row.type}
          when={when}
          notApplied={notApplied}
        />
      );
  }
}

/** The ids of the message.sent events that the session got (a `message.human` with the id). */
function deliveredIds(page: ThreadPage): Set<string> {
  return new Set(
    page.events
      .filter((r) => r.type === "message.human" && typeof r.event.data.delivery_id === "string")
      .map((r) => str(r.event.data.delivery_id)),
  );
}

/**
 * The Activity rows of a page, oldest first. An open gate whose `gate.opened` is older than the
 * page shows after the rows, so a gate never hides.
 */
function ActivityPage(props: {
  ws: string;
  task: Task;
  page: ThreadPage;
  now: number;
  older: boolean;
}) {
  const { ws, task, page, now } = props;
  const delivered = deliveredIds(page);
  const rows = activityRows(page.events);
  const inPage = new Set(
    page.events.filter((r) => r.type === "gate.opened").map((r) => str(r.event.data.gate)),
  );
  const older = task.gates.filter(
    (g) => g.state === "open" && g.kind !== "assign" && !inPage.has(g.gate),
  );
  if (rows.length === 0 && older.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {props.older
          ? `No activity in the newest ${page.events.length} events. "Show older" loads more.`
          : "No activity yet."}{" "}
        The Session tab shows each event of the session.
      </Typography>
    );
  }
  return (
    <Stack spacing={1.5} component="section" aria-label="Activity">
      {rows.map((item) => (
        <ActivityItem
          key={item.event}
          ws={ws}
          task={task}
          item={item}
          delivered={delivered}
          now={now}
        />
      ))}
      {older.map((gate) => (
        <GateCard key={gate.gate} ws={ws} task={task} gate={gate} />
      ))}
    </Stack>
  );
}

function Page({ ws, page, now }: { ws: string; page: ThreadPage; now: number }) {
  const delivered = deliveredIds(page);
  return (
    <Stack spacing={1} component="section" aria-label="Session events">
      {page.events.map((row) => (
        <SessionRow key={row.id} ws={ws} row={row} delivered={delivered} now={now} />
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
      {mode === "activity" ? (
        <ActivityPage ws={ws} task={task} page={reply} now={now} older={reply.prev !== null} />
      ) : (
        <Page ws={ws} page={reply} now={now} />
      )}
    </Stack>
  );
}

/**
 * The message box: raw text to the running session, delivered as its next input. While a question
 * or a reply of the agent is open, the text is its free-text answer (openspec
 * proposal-and-discussion); while a proposal waits, the text discusses it and the gate stays open.
 */
export function Composer({
  ws,
  task,
  inputRef,
}: {
  ws: string;
  task: Task;
  /** The text field: "Discuss" of the proposal puts the cursor in it. */
  inputRef?: Ref<HTMLTextAreaElement>;
}) {
  const session = details(task).session;
  const running = session?.state === "running";
  const sendMessage = useSendMessage(ws, task.id);
  const answer = useAnswerGate(ws, task.id);
  const [, setNotice] = useGateNotice(ws, task.id);
  const [text, setText] = useState("");
  const open = task.gates.filter((g) => g.state === "open");
  // A question with an answer that waits for its delivery takes no second answer: a message then.
  const question =
    open
      .filter((g) => QUESTION_KINDS.has(g.kind) && !g.answers.some((a) => a.use === "pending"))
      .at(-1) ?? null;
  const proposal = open.some((g) => g.kind === "approve_proposal");
  const enabled = running || question !== null;
  const busy = sendMessage.isPending || answer.isPending;
  const send = () => {
    if (!text.trim() || !enabled) return;
    // Principle 8: the agent gets the original words; trim() only checks for an empty text.
    if (question) {
      setNotice(null);
      const sent = text;
      setText("");
      answer
        .mutateAsync({
          gate: question.gate,
          body: { answer: sent, comment: null, version: question.version },
        })
        .then(
          (reply) => setNotice(answerNotice(reply)),
          (error: unknown) => setNotice(refusedNotice(error)),
        );
      return;
    }
    sendMessage.mutate(text, { onSuccess: () => setText("") });
  };
  return (
    <Stack spacing={1}>
      <TextField
        label={`Message to ${task.assignee ?? "the agent"}`}
        placeholder={
          question
            ? "Reply, or ask the agent…"
            : !running
              ? "No session runs. Assign the task to start a session."
              : proposal
                ? "Discuss the proposal, or ask the agent…"
                : "It arrives as the next input of the session."
        }
        multiline
        minRows={2}
        maxRows={8}
        value={text}
        disabled={!enabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
        {...(inputRef ? { inputRef } : {})}
      />
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {question
            ? `⌘↵ to send · your message answers the question “${question.title}”`
            : running
              ? `⌘↵ to send · ${session.device} delivers it when no dialog is open`
              : "The next session reads the thread."}
        </Typography>
        <Button variant="contained" disabled={!enabled || !text.trim() || busy} onClick={send}>
          Send
        </Button>
      </Stack>
      {sendMessage.isError && <Alert severity="error">{errorText(sendMessage.error)}</Alert>}
      {answer.isError && refusedNotice(answer.error) === null && (
        <Alert severity="error">{errorText(answer.error)}</Alert>
      )}
    </Stack>
  );
}
