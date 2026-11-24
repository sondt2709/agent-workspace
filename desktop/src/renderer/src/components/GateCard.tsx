// The gate cards (docs/workflow.md 3): the person acts on a gate in the card. The card type comes
// from the gate kind, the buttons from the gate options, the text and the time from the
// `gate.opened` event of the thread.
import {
  canPickDecisions,
  decisionsAnswer,
  gateBody,
  gateDecisions,
  gateHasBody,
  gateQuestions,
  questionMode,
  recommendedOption,
} from "@aw/client/gates";
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
import type { Gate, Task } from "../../../shared/channels.ts";
import { errorText } from "../bridge.ts";
import { useNow } from "../clock.ts";
import {
  agentChoices,
  answerNotice,
  commentRule,
  countdown,
  gateLabel,
  gateOpened,
  hlcMs,
  openedHlc,
  pendingAnswer,
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
  DecisionList,
  GateBody,
  GateContext,
  OptionButton,
  QuestionList,
  ResultArtifacts,
} from "./GateParts.tsx";
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

/** The free-text answer of a question or a reply. */
function FreeText(props: {
  label: string;
  button: string;
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

export interface GateCardProps {
  ws: string;
  task: Task;
  gate: Gate;
}

export function GateCard({ ws, task, gate }: GateCardProps) {
  if (gate.kind === "assign") return <AssignCard ws={ws} task={task} />;
  return <AnswerCard ws={ws} task={task} gate={gate} />;
}

function AnswerCard({ ws, task, gate }: GateCardProps) {
  const status = useStatus();
  const work = useWorkEvents(ws, task.id);
  const answer = useAnswerGate(ws, task.id);
  const [, setNotice] = useGateNotice(ws, task.id);
  const [choice, setChoice] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const opened = gateOpened(work.data, gate.gate);
  const openedMs = hlcMs(opened?.hlc ?? openedHlc(gate) ?? "");
  const isCommand = gate.kind === "approve_command";
  const now = useNow(1000, isCommand && gate.state === "open");
  const device = status.data?.device.slug ?? null;
  const { mine, other } = pendingAnswer(gate, device);
  const owner = task.owner ?? "the session device";
  const decisions = gateDecisions(opened?.event.data);
  // The decision picks: the recommended option until the person picks another (task-review-layout).
  const [picked, setPicked] = useState<Record<number, string>>({});
  const pickable = decisions.length > 0 && canPickDecisions(gate.options);
  const picks = decisions.map((d, i) => picked[i] ?? d.recommended);
  const choices = pickable ? decisionsAnswer(decisions, picks) : null;
  // The decisions show as a list: the text loses the decision block of awd (decision 4).
  const text = gateBody(
    typeof opened?.event.data.text === "string" ? opened.event.data.text : "",
    decisions,
  );
  // Question details, context and questions (openspec gate-context).
  const questions = gateQuestions(opened?.event.data);
  const mode = questionMode(questions);
  const hasBody = gateHasBody(gate.title, text, questions);
  const asks = gate.kind === "question" || gate.kind === "reply";
  const context = useGateContext(ws, task.id, opened, asks && !hasBody);
  const recommended = recommendedOption(gate.options);
  const describe = (option: string) =>
    mode === "buttons"
      ? (questions[0]!.options.find((o) => o.label === option)?.description ?? "")
      : "";

  const send = (value: string, note: string | null) => {
    setNotice(null);
    // The promise of mutateAsync settles also after the card unmounts (an event of awd can close
    // the gate before the reply arrives); the callbacks of mutate() would not run then.
    answer
      .mutateAsync({
        gate: gate.gate,
        body: { answer: value, comment: note, version: gate.version },
      })
      .then(
        (reply) => setNotice(answerNotice(reply)),
        (error: unknown) => setNotice(refusedNotice(error)),
      );
  };

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

  const freeText = gate.kind === "question" || gate.kind === "reply" || gate.options.length === 0;
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
      {!isCommand && !hasBody && asks && <GateContext rows={context.data ?? []} />}
      <DecisionList
        decisions={decisions}
        {...(pickable && !mine
          ? {
              picks,
              disabled: answer.isPending,
              onPick: (i: number, option: string) => setPicked((p) => ({ ...p, [i]: option })),
            }
          : {})}
      />
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
          {mode === "list" && (
            <QuestionList
              questions={questions}
              disabled={busy}
              onSend={(value) => send(value, null)}
            />
          )}
          {mode !== "list" && asks && gate.options.length > 0 && (
            // A question or a reply: one full-width button per option, stacked; the recommended
            // option is filled (openspec polish-prototype-style).
            <Stack spacing={1} data-testid="gate-options">
              {gate.options.map((option, i) => (
                <OptionButton
                  key={option}
                  label={option}
                  description={describe(option)}
                  filled={i === recommended && commentRule(option) === "none"}
                  disabled={busy}
                  onClick={() => pick(option)}
                />
              ))}
            </Stack>
          )}
          {mode !== "list" && !asks && gate.options.length > 0 && (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              {gate.options.map((option, i) =>
                choices && i === recommended ? (
                  // A pick differs: the recommended option would ignore it (design decision 4).
                  <Button
                    key={option}
                    variant="contained"
                    disabled={busy}
                    onClick={() => send(choices.answer, choices.comment)}
                  >
                    Send my choices
                  </Button>
                ) : (
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
                ),
              )}
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
          {freeText && (
            <FreeText
              label={gate.kind === "reply" ? "Your reply" : "Or type your answer"}
              button={gate.kind === "reply" ? "Send reply" : "Submit answer"}
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
