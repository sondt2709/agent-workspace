// The proposal card of Activity and its full screen view (openspec proposal-and-discussion, design
// decisions 4 and 7): "Proposal v<n>", the author, the time, the proposal as Markdown in the text
// size of the device, and "Approve proposal" while its gate is open. The person discusses the
// proposal with a message: the card has no other answer.
import { PROPOSAL_TEXT, changeProposalTextSize } from "@aw/client/gates";
import { radius } from "@aw/ui";
import CheckCircle from "@mui/icons-material/CheckCircleOutlined";
import OpenInFull from "@mui/icons-material/OpenInFullOutlined";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import type { Task } from "../../../shared/channels.ts";
import type { ProposalState } from "../activity-model.ts";
import { errorText } from "../bridge.ts";
import { useNow } from "../clock.ts";
import { ago, answerNotice, hlcMs, pendingAnswer, refusedNotice, taskLabel } from "../model.ts";
import {
  useAnswerGate,
  useGateNotice,
  useProposalTextSize,
  useStatus,
  useTaskFile,
} from "../queries.ts";
import { MarkdownText } from "./common.tsx";
import { GateBody } from "./GateParts.tsx";

/**
 * Puts the cursor in the message box of the task page. The task page gives it; the Inbox has no
 * message box, so "Discuss" there opens the task page.
 */
export const MessageBoxFocus = createContext<(() => void) | null>(null);

/** The answer of "Approve proposal" (awd also reads the old "Confirm"). */
export const APPROVE = "Approve";

export interface ProposalCardProps {
  ws: string;
  task: Task;
  version: number;
  /** The file in the task folder: `proposal/v<n>.md`, or `approach/v<n>.md` from before the rename. */
  file: string;
  /** The author and the HLC of the `proposal.proposed` event. */
  by: string;
  hlc: string;
  /** The `approve_proposal` gate of the version, or null. */
  gate: string | null;
  state: ProposalState;
  approvedBy: string | null;
  /** The gate text: the start of the proposal, while the file loads or when it is not here. */
  gateText: string;
}

/** The text of the proposal: its file, else the gate text. */
function useProposalText(ws: string, task: string, file: string, fallback: string): string {
  const read = useTaskFile(ws, task, `tasks/${task}/${file}`);
  return read.data?.text ?? fallback;
}

/**
 * A− and A+ with the size between them (14 to 24 px, steps of 2 px). A button turns off at its
 * limit; the focus then goes to the other button, so it stays in the dialog.
 */
export function TextSizeControl({
  size,
  onChange,
}: {
  size: number;
  onChange: (px: number) => void;
}) {
  const smaller = useRef<HTMLButtonElement>(null);
  const larger = useRef<HTMLButtonElement>(null);
  const change = (action: "larger" | "smaller") => {
    const next = changeProposalTextSize(size, action);
    onChange(next);
    if (action === "larger" && next >= PROPOSAL_TEXT.max) smaller.current?.focus();
    if (action === "smaller" && next <= PROPOSAL_TEXT.min) larger.current?.focus();
  };
  return (
    <Stack direction="row" role="group" aria-label="Text size" sx={{ alignItems: "center" }}>
      <Button
        variant="outlined"
        color="inherit"
        ref={smaller}
        aria-label="Smaller text"
        disabled={size <= PROPOSAL_TEXT.min}
        onClick={() => change("smaller")}
        sx={{ minWidth: 40, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
      >
        A−
      </Button>
      <Typography
        variant="body2"
        role="status"
        aria-label="Text size in px"
        sx={{
          minWidth: 56,
          textAlign: "center",
          alignSelf: "stretch",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderTop: 1,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        {size} px
      </Typography>
      <Button
        variant="outlined"
        color="inherit"
        ref={larger}
        aria-label="Larger text"
        disabled={size >= PROPOSAL_TEXT.max}
        onClick={() => change("larger")}
        sx={{ minWidth: 40, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
      >
        A+
      </Button>
    </Stack>
  );
}

export function ProposalCard(props: ProposalCardProps) {
  const { ws, task } = props;
  const now = useNow(30_000);
  const [size, setSize] = useProposalTextSize();
  const [full, setFull] = useState(false);
  const status = useStatus();
  const answer = useAnswerGate(ws, task.id);
  const [, setNotice] = useGateNotice(ws, task.id);
  const focusMessageBox = useContext(MessageBoxFocus);
  const navigate = useNavigate();
  const text = useProposalText(ws, task.id, props.file, props.gateText);
  const gate = task.gates.find((g) => g.gate === props.gate) ?? null;
  // The task view decides when it has the gate: a resolved gate shows no button.
  const open = props.state === "open" && props.gate !== null && gate?.state !== "resolved";
  const { mine } = gate ? pendingAnswer(gate, status.data?.device.slug ?? null) : { mine: null };
  const canApprove = open && !mine;
  const when = ago(hlcMs(props.hlc), now);
  const title = `Proposal v${props.version}`;

  const approve = () => {
    if (!props.gate) return;
    setNotice(null);
    // The promise settles also after the card unmounts (see AnswerCard of GateCard.tsx).
    answer
      .mutateAsync({
        gate: props.gate,
        body: { answer: APPROVE, comment: null, version: gate?.version ?? 1 },
      })
      .then(
        (reply) => setNotice(answerNotice(reply)),
        (error: unknown) => setNotice(refusedNotice(error)),
      );
  };
  const discuss = () => {
    setFull(false);
    if (focusMessageBox) focusMessageBox();
    else void navigate(`/w/${ws}/tasks/${task.id}`);
  };

  const chip = open ? <Chip size="small" color="warning" label="Waits for your approval" /> : null;

  return (
    <Box
      component="article"
      aria-label={title}
      data-testid="proposal-card"
      {...(open ? { "data-needs-you": "true" } : {})}
      sx={{
        bgcolor: "aw.raised",
        border: 1,
        borderColor: "divider",
        borderRadius: `${radius.lg}px`,
        px: 4,
        py: 3,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Typography variant="subtitle1" component="h3">
          {title}
        </Typography>
        {chip}
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {props.by} · {when}
        </Typography>
        <Tooltip title="Full screen">
          <IconButton
            size="small"
            aria-label="Open the proposal in full screen"
            onClick={() => setFull(true)}
          >
            <OpenInFull fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <GateBody text={text} size={size} />
      {(open || props.state === "approved") && (
        <Stack
          direction="row"
          spacing={2}
          useFlexGap
          sx={{
            alignItems: "center",
            flexWrap: "wrap",
            borderTop: 1,
            borderColor: "divider",
            pt: 2,
          }}
        >
          {props.state === "approved" ? (
            <Typography
              variant="body2"
              color="success.main"
              sx={{ display: "flex", alignItems: "center", gap: 1 }}
            >
              <CheckCircle fontSize="small" />
              Approved by {props.approvedBy}
            </Typography>
          ) : mine ? (
            <Alert severity="info" variant="outlined" sx={{ flex: 1 }}>
              Answer sent: “{mine.answer}”. {task.owner ?? "The session device"} uses it when it
              gets it.
            </Alert>
          ) : (
            <>
              <Button variant="contained" disabled={answer.isPending} onClick={approve}>
                Approve proposal
              </Button>
              <Typography variant="caption" color="text.secondary">
                To change it, write a message.
              </Typography>
            </>
          )}
        </Stack>
      )}
      {answer.isError && refusedNotice(answer.error) === null && (
        <Alert severity="error">{errorText(answer.error)}</Alert>
      )}
      <ProposalFullScreen
        open={full}
        title={title}
        task={task}
        meta={`${props.by} · ${when}`}
        chip={chip}
        text={text}
        size={size}
        onSize={setSize}
        canApprove={canApprove}
        busy={answer.isPending}
        onApprove={() => {
          approve();
          setFull(false);
        }}
        onDiscuss={discuss}
        onClose={() => setFull(false)}
      />
    </Box>
  );
}

/**
 * The proposal over the whole window: the title, the task, the text size control and Close; the
 * proposal with a maximum width of 760 px; "Approve proposal" (while the gate is open) and
 * "Discuss" at the bottom. Esc closes it (the dialog stops its Esc, so the task page stays).
 */
export function ProposalFullScreen(props: {
  open: boolean;
  title: string;
  task: Task;
  meta: string;
  chip: ReactNode;
  text: string;
  size: number;
  onSize: (px: number) => void;
  canApprove: boolean;
  busy: boolean;
  onApprove: () => void;
  onDiscuss: () => void;
  onClose: () => void;
}) {
  const { open, onClose } = props;
  // A+ and A− turn off at a limit, and the browser then moves the focus to the body, out of the
  // dialog: Esc still closes the view.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && document.activeElement === document.body) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <Dialog
      fullScreen
      open={props.open}
      onClose={props.onClose}
      aria-labelledby="proposal-full-title"
    >
      <Stack sx={{ height: "100%", minHeight: 0, bgcolor: "background.default" }}>
        <Stack
          direction="row"
          spacing={3}
          useFlexGap
          sx={{
            alignItems: "center",
            flexWrap: "wrap",
            px: 6,
            py: 3,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Typography variant="subtitle1" component="h2" id="proposal-full-title">
            {props.title}
          </Typography>
          {props.chip}
          <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0, flex: 1 }}>
            {taskLabel(props.task)} · {props.task.title ?? "(no title)"} · {props.meta}
          </Typography>
          <TextSizeControl size={props.size} onChange={props.onSize} />
          <Button variant="outlined" onClick={props.onClose}>
            Close
          </Button>
        </Stack>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 6, py: 8 }}>
          <Box sx={{ maxWidth: 760, mx: "auto" }} data-testid="proposal-full-text">
            <MarkdownText text={props.text} size={props.size} />
          </Box>
        </Box>
        <Box sx={{ px: 6, py: 3, borderTop: 1, borderColor: "divider" }}>
          <Stack
            direction="row"
            spacing={3}
            useFlexGap
            sx={{ maxWidth: 760, mx: "auto", alignItems: "center", flexWrap: "wrap" }}
          >
            {props.canApprove && (
              <Button variant="contained" disabled={props.busy} onClick={props.onApprove}>
                Approve proposal
              </Button>
            )}
            <Button variant="outlined" onClick={props.onDiscuss}>
              Discuss
            </Button>
            <Typography variant="caption" color="text.secondary">
              Discuss closes this view and puts the cursor in the message box.
            </Typography>
          </Stack>
        </Box>
      </Stack>
    </Dialog>
  );
}
