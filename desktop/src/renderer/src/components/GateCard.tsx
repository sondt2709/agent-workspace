// The gate cards (docs/workflow.md 3): the person acts on a gate in the card. The card type comes
// from the gate kind, the buttons from the gate options, the text and the time from the
// `gate.opened` event of the thread. A question or a reply shows as an agent message with its
// options as buttons, and a proposal as the proposal card (openspec proposal-and-discussion).
import { gateHasBody, gateQuestions, questionMode, recommendedOption } from "@aw/client/gates";
import { mainVar, tint } from "@aw/ui";
import Check from "@mui/icons-material/CheckOutlined";
import HelpOutline from "@mui/icons-material/HelpOutlined";
import PersonAdd from "@mui/icons-material/PersonAddOutlined";
import Reply from "@mui/icons-material/ReplyOutlined";
import Security from "@mui/icons-material/SecurityOutlined";
import Timer from "@mui/icons-material/TimerOutlined";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState, type ReactNode } from "react";
import { isAgentRef } from "../../../shared/agent-ref.ts";
import type { EventRow, Gate, Task } from "../../../shared/channels.ts";
import { QUESTION_KINDS } from "../activity-model.ts";
import { errorText } from "../bridge.ts";
import { useNow } from "../clock.ts";
import {
  agentChoices,
  ago,
  answerNotice,
  commentRule,
  countdown,
  gateLabel,
  gateOpened,
  hlcMs,
  openedHlc,
  pendingAnswer,
  proposalFileVersion,
  refusedNotice,
} from "../model.ts";
import {
  useAnswerGate,
  useAssignTask,
  useGateContext,
  useGateNotice,
  useProjects,
  useStatus,
  useWorkEvents,
} from "../queries.ts";
import {
  GateBody,
  GateContext,
  OptionButton,
  QuestionList,
  ResultArtifacts,
} from "./GateParts.tsx";
import { ProposalCard } from "./ProposalCard.tsx";
import { OpenTerminalButton } from "./TerminalView.tsx";

const ICONS: Record<string, ReactNode> = {
  question: <HelpOutline fontSize="small" />,
  reply: <Reply fontSize="small" />,
  approve_command: <Security fontSize="small" />,
  assign: <PersonAdd fontSize="small" />,
};

function CardFrame(props: {
  icon: ReactNode;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  live?: boolean;
}) {
  return (
    <Card
      sx={{
        borderColor: props.live === false ? "divider" : tint(mainVar("warning"), 40),
      }}
      data-testid="gate-card"
      {...(props.live === false ? {} : { "data-needs-you": "true" })}
    >
      <CardContent
        sx={{ display: "flex", flexDirection: "column", gap: 2, "&:last-child": { pb: 3 } }}
      >
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", color: "warning.main" }}>
          {props.icon ?? <Check fontSize="small" />}
          <Typography variant="subtitle1" sx={{ flex: 1, minWidth: 0 }}>
            {props.title}
          </Typography>
          {props.meta}
        </Stack>
        {props.children}
      </CardContent>
    </Card>
  );
}

/** The free-text answer of a gate: a field and its send button. */
function FreeText(props: {
  label: string;
  button: string;
  placeholder?: string;
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const send = () => {
    if (!text.trim()) return;
    props.onSend(text);
    setText("");
  };
  return (
    <Stack spacing={1}>
      <TextField
        label={props.label}
        placeholder={props.placeholder}
        multiline
        minRows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
      />
      <Box>
        <Button variant="contained" disabled={props.disabled || !text.trim()} onClick={send}>
          {props.button}
        </Button>
      </Box>
    </Stack>
  );
}

/** Sends an answer of the person to a gate and keeps the notice of the reply (decision 8). */
function useSendAnswer(ws: string, task: string) {
  const answer = useAnswerGate(ws, task);
  const [, setNotice] = useGateNotice(ws, task);
  const send = (gate: string, version: number, value: string, note: string | null) => {
    setNotice(null);
    // The promise of mutateAsync settles also after the card unmounts (an event of awd can close
    // the gate before the reply arrives); the callbacks of mutate() would not run then.
    answer.mutateAsync({ gate, body: { answer: value, comment: note, version } }).then(
      (reply) => setNotice(answerNotice(reply)),
      (error: unknown) => setNotice(refusedNotice(error)),
    );
  };
  return { send, answer };
}

export interface GateCardProps {
  ws: string;
  task: Task;
  gate: Gate;
  /** The Inbox detail: a question has its own reply field (the task page has the message box). */
  reply?: boolean;
}

/**
 * The Activity row of one open gate, from the gate view: the question message, the proposal card,
 * the Assign card, or the gate card of another kind. Activity shows a gate at its place in time;
 * the Inbox detail and a gate older than the thread window use this.
 */
export function GateCard({ ws, task, gate, reply = false }: GateCardProps) {
  if (gate.kind === "assign") return <AssignCard ws={ws} task={task} />;
  if (QUESTION_KINDS.has(gate.kind)) {
    return <OpenQuestion ws={ws} task={task} gate={gate} reply={reply} />;
  }
  if (gate.kind === "approve_proposal") return <OpenProposal ws={ws} task={task} gate={gate} />;
  return <AnswerCard ws={ws} task={task} gate={gate} />;
}

/** A question or a reply from the gate view, with its `gate.opened` from the work events. */
function OpenQuestion({ ws, task, gate, reply }: Required<GateCardProps>) {
  const work = useWorkEvents(ws, task.id);
  const opened = gateOpened(work.data, gate.gate);
  const data = opened?.event.data;
  return (
    <QuestionMessage
      ws={ws}
      task={task}
      gate={gate}
      opened={opened}
      title={gate.title}
      text={typeof data?.text === "string" ? data.text : ""}
      open={gate.state === "open"}
      note={gate.state === "resolved" && gate.answer_event === null ? gate.answer : null}
      reply={reply}
    />
  );
}

/** A proposal from its gate view, with its `proposal.proposed` from the work events. */
function OpenProposal({ ws, task, gate }: Omit<GateCardProps, "reply">) {
  const work = useWorkEvents(ws, task.id);
  const opened = gateOpened(work.data, gate.gate);
  const version = proposalFileVersion(gate.file) ?? 0;
  const proposed =
    work.data?.events.find(
      (r) =>
        r.type === "proposal.proposed" &&
        (r.event.data.file === gate.file || r.event.data.version === version),
    ) ?? opened;
  const text = opened?.event.data.text;
  return (
    <ProposalCard
      ws={ws}
      task={task}
      version={version}
      file={gate.file ?? `proposal/v${version}.md`}
      by={proposed?.event.by ?? proposed?.dev ?? task.assignee ?? "the agent"}
      hlc={proposed?.hlc ?? openedHlc(gate) ?? ""}
      gate={gate.gate}
      state={gate.state === "open" ? "open" : "closed"}
      approvedBy={null}
      gateText={typeof text === "string" ? text : ""}
    />
  );
}

export interface QuestionMessageProps {
  ws: string;
  task: Task;
  /** The gate view, for the version and the pending answers; null when awd has no view of it. */
  gate: Gate | null;
  /** The `gate.opened` event: the author, the time, the questions and the context. */
  opened: EventRow | null;
  title: string;
  text: string;
  /** True while the question waits for an answer: the buttons and "Waits for your reply". */
  open: boolean;
  /** Why AW closed the question with no answer, for example "Replaced by a newer question". */
  note: string | null;
  /** The Inbox detail: a reply field under the buttons. */
  reply?: boolean;
}

/**
 * A question of the agent as an agent message (openspec proposal-and-discussion, design decision
 * 3): the title in bold, the text as Markdown (or the Context), and while it is open the options
 * as buttons and the chip "Waits for your reply". The message box of the task page is its free
 * text; the Inbox detail has a reply field.
 */
export function QuestionMessage(props: QuestionMessageProps) {
  const { ws, task, gate, opened } = props;
  const status = useStatus();
  const now = useNow(30_000);
  const { send, answer } = useSendAnswer(ws, task.id);
  const open = props.open && gate?.state !== "resolved";
  const { mine, other } = gate
    ? pendingAnswer(gate, status.data?.device.slug ?? null)
    : { mine: null, other: null };
  const questions = gateQuestions(opened?.event.data);
  const mode = questionMode(questions);
  const hasBody = gateHasBody(props.title, props.text, questions);
  // The context only while the question waits: then the person needs it to answer.
  const context = useGateContext(ws, task.id, opened, open && !hasBody);
  const options =
    gate?.options ??
    (Array.isArray(opened?.event.data.options) ? opened.event.data.options.map(String) : []);
  const recommended = recommendedOption(options);
  const describe = (option: string) =>
    mode === "buttons"
      ? (questions[0]!.options.find((o) => o.label === option)?.description ?? "")
      : "";
  const openedGate = opened?.event.data.gate;
  const gateId = gate?.gate ?? (typeof openedGate === "string" ? openedGate : "");
  const version = gate?.version ?? Number(opened?.event.data.version ?? 1);
  const answerWith = (value: string) => send(gateId, version, value, null);
  const by = opened?.event.by ?? opened?.dev ?? task.assignee ?? "the agent";
  const hlc = opened?.hlc ?? (gate ? openedHlc(gate) : null) ?? "";
  const owner = task.owner ?? "the session device";
  const busy = answer.isPending;
  return (
    <Box
      component="article"
      aria-label={`Question: ${props.title}`}
      data-testid="question-message"
      {...(open ? { "data-needs-you": "true" } : {})}
      sx={{
        borderLeft: 2,
        borderColor: "info.main",
        pl: 3,
        py: 1,
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Typography variant="caption" color="text.secondary">
          <b>{by}</b> · question · {ago(hlcMs(hlc), now)}
        </Typography>
        {open && !mine && <Chip size="small" color="warning" label="Waits for your reply" />}
      </Stack>
      <Typography variant="body1" sx={{ fontWeight: "fontWeightBold", overflowWrap: "anywhere" }}>
        {props.title || gateLabel(gate?.kind ?? "question")}
      </Typography>
      {hasBody && <GateBody text={props.text} />}
      {!hasBody && open && <GateContext rows={context.data ?? []} />}
      {props.note && (
        <Typography variant="caption" color="text.secondary">
          {props.note}
        </Typography>
      )}
      {open && mine && (
        <Alert severity="info" variant="outlined">
          Answer sent: “{mine.answer}”. {owner} uses it when it gets it.
        </Alert>
      )}
      {open && !mine && (
        <>
          {other && (
            <Typography variant="body2" color="text.secondary">
              {other.dev} sent an answer. {owner} uses the first answer that it gets. A later answer
              becomes a comment.
            </Typography>
          )}
          {mode === "list" && (
            <QuestionList questions={questions} disabled={busy} onSend={answerWith} />
          )}
          {mode !== "list" && options.length > 0 && (
            // One full-width button per option, stacked; the recommended option is filled
            // (openspec polish-prototype-style).
            <Stack spacing={1} data-testid="gate-options">
              {options.map((option, i) => (
                <OptionButton
                  key={option}
                  label={option}
                  description={describe(option)}
                  filled={i === recommended}
                  disabled={busy}
                  onClick={() => answerWith(option)}
                />
              ))}
            </Stack>
          )}
          {props.reply ? (
            <FreeText
              label="Or write your answer"
              placeholder={`Reply to ${by}…`}
              button="Send"
              disabled={busy}
              onSend={answerWith}
            />
          ) : (
            <Typography variant="caption" color="text.secondary">
              {options.length > 0
                ? "Or write your answer in the message box."
                : "Write your answer in the message box."}
            </Typography>
          )}
        </>
      )}
      {answer.isError && refusedNotice(answer.error) === null && (
        <Alert severity="error">{errorText(answer.error)}</Alert>
      )}
    </Box>
  );
}

/** The card of an open gate of another kind: Approve result, Approve command, a custom gate. */
function AnswerCard({ ws, task, gate }: Omit<GateCardProps, "reply">) {
  const status = useStatus();
  const work = useWorkEvents(ws, task.id);
  const { send: sendAnswer, answer } = useSendAnswer(ws, task.id);
  const [choice, setChoice] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const opened = gateOpened(work.data, gate.gate);
  const openedMs = hlcMs(opened?.hlc ?? openedHlc(gate) ?? "");
  const isCommand = gate.kind === "approve_command";
  const now = useNow(1000, isCommand && gate.state === "open");
  const device = status.data?.device.slug ?? null;
  const { mine, other } = pendingAnswer(gate, device);
  const owner = task.owner ?? "the session device";
  // The gate text as written: a gate shows no decisions (openspec proposal-and-discussion).
  const text = typeof opened?.event.data.text === "string" ? opened.event.data.text : "";
  const hasBody = gateHasBody(gate.title, text);
  const recommended = recommendedOption(gate.options);
  const send = (value: string, note: string | null) =>
    sendAnswer(gate.gate, gate.version, value, note);

  const pick = (option: string) => {
    if (commentRule(option) === "none") send(option, null);
    else setChoice(option);
  };

  let meta: ReactNode = (
    <Typography variant="caption" color="text.secondary">
      v{gate.version}
    </Typography>
  );
  if (isCommand && Number.isFinite(openedMs)) {
    const left = countdown(openedMs, now);
    meta = left.expired ? (
      <Chip label="Denied after 120 s" variant="outlined" />
    ) : (
      <Chip icon={<Timer />} color="warning" role="timer" label={`Denies in ${left.left} s`} />
    );
  }

  const busy = answer.isPending;

  return (
    <CardFrame icon={ICONS[gate.kind]} title={gate.title || gateLabel(gate.kind)} meta={meta}>
      <Typography variant="caption" color="text.secondary">
        {gateLabel(gate.kind)}
        {isCommand && typeof opened?.event.data.request_id === "string"
          ? ` · request ${opened.event.data.request_id}`
          : ""}
      </Typography>
      {isCommand && text && (
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 2,
            borderRadius: 1,
            bgcolor: "action.selected",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            fontFamily: "var(--aw-font-mono)",
            fontSize: 12,
          }}
        >
          {text}
        </Box>
      )}
      {!isCommand && hasBody && <GateBody text={text} />}
      {gate.kind === "approve_result" && (
        <ResultArtifacts ws={ws} task={task.id} gate={gate} rows={work.data?.events ?? []} />
      )}
      {mine ? (
        <Alert severity="info" variant="outlined">
          Answer sent: “{mine.answer}”. {owner} uses it when it gets it.
        </Alert>
      ) : (
        <>
          {other && (
            <Typography variant="body2" color="text.secondary">
              {other.dev} sent an answer. {owner} uses the first answer that it gets. A later answer
              becomes a comment.
            </Typography>
          )}
          {gate.kind === "take_over_terminal" && (
            <OpenTerminalButton ws={ws} task={task.id} action="attach" />
          )}
          {gate.options.length > 0 && (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              {gate.options.map((option, i) => (
                <Button
                  key={option}
                  variant={
                    i === recommended && commentRule(option) === "none" ? "contained" : "outlined"
                  }
                  color={
                    i === recommended && commentRule(option) === "none" ? "primary" : "inherit"
                  }
                  disabled={busy}
                  aria-pressed={choice === option}
                  onClick={() => pick(option)}
                >
                  {isCommand && countdown(openedMs, now).expired && i === 0
                    ? `${option} (late)`
                    : option}
                </Button>
              ))}
            </Stack>
          )}
          {choice && (
            <Stack spacing={1}>
              <TextField
                label={
                  commentRule(choice) === "required" ? "What must change?" : "Comment (optional)"
                }
                multiline
                minRows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                autoFocus
              />
              <Stack direction="row" spacing={1}>
                <Button onClick={() => setChoice(null)}>Cancel</Button>
                <Button
                  variant="contained"
                  disabled={busy || (commentRule(choice) === "required" && !comment.trim())}
                  onClick={() => {
                    send(choice, comment.trim() ? comment : null);
                    setChoice(null);
                    setComment("");
                  }}
                >
                  Send to agent
                </Button>
              </Stack>
            </Stack>
          )}
          {gate.options.length === 0 && (
            <FreeText
              label="Your answer"
              button="Send answer"
              disabled={busy}
              onSend={(value) => send(value, null)}
            />
          )}
          <Typography variant="caption" color="text.secondary">
            {isCommand
              ? "Each answer names the request id. With no answer in 120 s, the hook denies. A late Allow becomes a one-time approval."
              : `${owner} delivers your answer as the next input of the session.`}
          </Typography>
        </>
      )}
      {answer.isError && refusedNotice(answer.error) === null && (
        <Alert severity="error">{errorText(answer.error)}</Alert>
      )}
    </CardFrame>
  );
}

/**
 * "Assign task": a task with no assignee. AW never assigns a task alone. The default agent of the
 * project on its first device is one click (review F-38); another agent needs "Other agent…".
 */
export function AssignCard({ ws, task }: { ws: string; task: Task }) {
  const projects = useProjects(ws);
  const assign = useAssignTask(ws);
  const [other, setOther] = useState(false);
  const [custom, setCustom] = useState("");
  const [main, ...rest] = agentChoices(projects.data ?? [], task.project);
  // The same check as the assign route of awd (desktop-shell review 12).
  const valid = isAgentRef(custom.trim());
  return (
    <CardFrame icon={ICONS.assign} title="Assign task">
      <Typography variant="body2">
        {task.parent
          ? "An agent created this subtask. Choose the agent and the device that implement it."
          : "Choose the agent and the device that implement this task."}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        {main && (
          <Button
            variant="contained"
            disabled={assign.isPending}
            onClick={() => assign.mutate({ task: task.id, assignee: main })}
          >
            Assign to {main}
          </Button>
        )}
        {rest.map((agent) => (
          <Button
            key={agent}
            variant="outlined"
            disabled={assign.isPending}
            onClick={() => assign.mutate({ task: task.id, assignee: agent })}
          >
            {agent}
          </Button>
        ))}
        {!other && (
          <Button onClick={() => setOther(true)} disabled={assign.isPending}>
            Other agent…
          </Button>
        )}
      </Stack>
      {other && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-end" }}>
          <TextField
            label="Other agent@device"
            placeholder="claude@ubuntu-01"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            autoFocus
            sx={{ flex: 1 }}
          />
          <Button
            variant="outlined"
            disabled={!valid || assign.isPending}
            onClick={() => assign.mutate({ task: task.id, assignee: custom.trim() })}
          >
            Assign
          </Button>
        </Stack>
      )}
      <Typography variant="caption" color="text.secondary">
        The task starts when it has an assignee. The device of the agent claims it.
      </Typography>
      {assign.isError && <Alert severity="error">{errorText(assign.error)}</Alert>}
    </CardFrame>
  );
}
