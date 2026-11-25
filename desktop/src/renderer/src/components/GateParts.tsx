// The parts of the full context of a gate (openspec gate-full-context, prd TSK-09 to TSK-12): the
// artifacts of a result with "Open", the proposal versions with their full text, and the notice of
// an answer that awd did not use. A gate shows no decisions (openspec proposal-and-discussion).
import { questionAnswer, type GateQuestion } from "@aw/client/gates";
import { mainVar, tint } from "@aw/ui";
import Check from "@mui/icons-material/CheckOutlined";
import ExpandLess from "@mui/icons-material/ExpandLessOutlined";
import ExpandMore from "@mui/icons-material/ExpandMoreOutlined";
import InsertDriveFile from "@mui/icons-material/InsertDriveFileOutlined";
import { Alert, Box, Button, Chip, Collapse, Stack, Typography } from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { EventRow, Gate } from "../../../shared/channels.ts";
import { clampText } from "../activity-model.ts";
import { BridgeCallError, call, errorText } from "../bridge.ts";
import { sizeText } from "../kb-model.ts";
import { proposalChip, resultArtifacts, type ProposalVersion } from "../model.ts";
import { useGateNotice, useTaskFile } from "../queries.ts";
import { MarkdownText } from "./common.tsx";

/** The artifacts of the result of an "Approve result" gate, each with "Open". */
export function ResultArtifacts(props: {
  ws: string;
  task: string;
  gate: Gate;
  rows: readonly EventRow[];
}) {
  const artifacts = resultArtifacts(props.rows, props.gate);
  const open = useMutation({
    mutationFn: (path: string) =>
      call("openTaskArtifact", { ws: props.ws, task: props.task, path }),
  });
  if (artifacts.length === 0) return null;
  return (
    <Stack spacing={1} data-testid="result-artifacts">
      <Typography variant="overline" color="text.secondary">
        Artifacts
      </Typography>
      {artifacts.map((a) => (
        <Stack key={a.path} direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <InsertDriveFile fontSize="small" color="action" />
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
            {a.name}{" "}
            <Typography component="span" variant="caption" color="text.secondary">
              · {a.size === null ? "size not known" : sizeText(a.size)}
            </Typography>
          </Typography>
          <Button size="small" disabled={open.isPending} onClick={() => open.mutate(a.path)}>
            Open
          </Button>
        </Stack>
      ))}
      {open.data?.opened === "folder" && (
        <Alert severity="info" variant="outlined">
          AW opens only images, PDF and text files. It shows {open.data.path.split("/").at(-1)} in
          Finder.
        </Alert>
      )}
      {open.isError && <Alert severity="error">{errorText(open.error)}</Alert>}
    </Stack>
  );
}

/** One proposal version: a row with its chip, and its full file text when the person opens it. */
function VersionRow(props: {
  ws: string;
  task: string;
  version: number;
  /** The file of the version in the task folder, for example `proposal/v2.md`. */
  file: string;
  line: string;
  chip: "approved" | "waits" | "replaced";
}) {
  const [open, setOpen] = useState(false);
  const path = `tasks/${props.task}/${props.file}`;
  const file = useTaskFile(props.ws, open ? props.task : null, open ? path : null);
  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Button
          size="small"
          aria-expanded={open}
          aria-label={`v${props.version}`}
          onClick={() => setOpen((v) => !v)}
          startIcon={open ? <ExpandLess /> : <ExpandMore />}
          sx={{ fontFamily: "var(--aw-font-mono)", minWidth: 0 }}
        >
          v{props.version}
        </Button>
        <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }} color="text.secondary">
          {props.line}
        </Typography>
        {props.chip === "approved" ? (
          <Chip label="Approved" color="success" variant="outlined" />
        ) : props.chip === "waits" ? (
          <Chip label="Waits for you" color="warning" variant="outlined" />
        ) : (
          <Chip label="Replaced" variant="outlined" />
        )}
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ p: 2, mt: 1, borderRadius: 1, bgcolor: "action.hover" }}>
          {file.isPending ? (
            <Typography variant="body2">Loading proposal v{props.version}…</Typography>
          ) : file.isError &&
            file.error instanceof BridgeCallError &&
            file.error.code === "not_found" ? (
            <Alert severity="info">
              The file of proposal v{props.version} is not on this device yet.
            </Alert>
          ) : file.isError ? (
            <Alert severity="error">{errorText(file.error)}</Alert>
          ) : file.data.text === null ? (
            <Alert severity="info">
              {file.data.reason === "too_large"
                ? `The file of proposal v${props.version} is larger than 1 MB. Open it from the workspace folder.`
                : `The file of proposal v${props.version} is not text.`}
            </Alert>
          ) : (
            <MarkdownText text={file.data.text} />
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

/** The proposal versions of a task, each with its chip and its full text (fix list 0-8). */
export function ProposalVersions(props: {
  ws: string;
  task: string;
  versions: readonly ProposalVersion[];
  proposal: { latest: number; approved: number | null };
}) {
  return (
    <Stack spacing={0.5}>
      {props.versions.map((v) => (
        <VersionRow
          key={v.version}
          ws={props.ws}
          task={props.task}
          version={v.version}
          file={v.file}
          line={(v.text.split("\n").find((l) => l.trim()) ?? "").replace(/^#+\s*/, "")}
          chip={proposalChip(v.version, props.proposal)}
        />
      ))}
    </Stack>
  );
}

/** The notice of the last answer of this person to a gate of the task, until the person closes it. */
export function GateNotice({ ws, task }: { ws: string; task: string }) {
  const [notice, setNotice] = useGateNotice(ws, task);
  if (!notice) return null;
  return (
    <Alert severity="warning" variant="outlined" onClose={() => setNotice(null)}>
      {notice}
    </Alert>
  );
}

// ---- Question details, context and questions (openspec gate-context) ----

/** A body longer than this shows its start and "Show more" (design decision 7). */
export const BODY_LINES = 12;
const BODY_CHARS = 1200;

/** True when a gate body is long: the card shows its start and "Show more". */
export function longBody(text: string): boolean {
  return text.split("\n").length > BODY_LINES || text.length > BODY_CHARS;
}

/**
 * The gate body as Markdown above the choices; a long body shows its first 240 px and "Show more".
 * `size` (px) is the text size of a proposal.
 */
export function GateBody({ text, size }: { text: string; size?: number }) {
  const [all, setAll] = useState(false);
  const long = longBody(text);
  const shut = long && !all;
  return (
    <Box>
      <Box
        data-testid="gate-text"
        sx={{
          position: "relative",
          // "Show more" shows the full text in the page, with no scroll box of its own: the plan is
          // the content that the person reads (openspec task-review-layout, design decision 6).
          ...(shut && {
            maxHeight: 240,
            overflowY: "hidden",
            maskImage: "linear-gradient(to bottom, black 70%, transparent)",
          }),
        }}
      >
        <MarkdownText text={text} {...(size === undefined ? {} : { size })} />
      </Box>
      {long && (
        <Button size="small" onClick={() => setAll((v) => !v)} sx={{ mt: 0.5 }}>
          {all ? "Show less" : "Show more"}
        </Button>
      )}
    </Box>
  );
}

/** One message of the context, clamped to 6 lines with "Show more". */
function ContextMessage({ row }: { row: EventRow }) {
  const [all, setAll] = useState(false);
  const text = typeof row.event.data.text === "string" ? row.event.data.text : "";
  const { head, cut } = clampText(text);
  return (
    <Box sx={{ borderLeft: 2, borderColor: "info.main", pl: 2, py: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        <b>{row.event.by ?? row.dev}</b>
      </Typography>
      {/* The text of the agent as Markdown, as in Activity. */}
      <MarkdownText text={cut && !all ? head : text} />
      {cut && (
        <Button size="small" onClick={() => setAll((v) => !v)} sx={{ mt: 0.5 }}>
          {all ? "Show less" : "Show more"}
        </Button>
      )}
    </Box>
  );
}

/**
 * "Context": the agent messages before a gate with no body (design decision 3), so the person sees
 * the analysis that a question like "Which option? (see the message above)" points at.
 */
export function GateContext({ rows }: { rows: readonly EventRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Stack spacing={1} data-testid="gate-context">
      <Typography variant="overline" color="text.secondary">
        Context
      </Typography>
      {rows.map((row) => (
        <ContextMessage key={row.id} row={row} />
      ))}
    </Stack>
  );
}

/** The label of an option button, with its description under it. */
export function OptionLabel({ label, description }: { label: string; description: string }) {
  if (!description) return <>{label}</>;
  return (
    <Stack sx={{ alignItems: "flex-start", textAlign: "left", py: 0.25 }}>
      <span>{label}</span>
      <Typography variant="caption" sx={{ opacity: 0.8, textTransform: "none" }}>
        {description}
      </Typography>
    </Stack>
  );
}

/**
 * One option of a question gate: a full-width button with the label and its description under it
 * (openspec polish-prototype-style). The recommended option is filled with the accent; the others
 * are outlined. With `checked`, the button is a toggle of a question list: outlined, with a check
 * mark and the accent border when picked.
 */
export function OptionButton(props: {
  label: string;
  description: string;
  filled?: boolean;
  checked?: boolean;
  role?: "checkbox" | "radio";
  disabled?: boolean;
  onClick: () => void;
}) {
  const toggle = props.checked !== undefined;
  return (
    <Button
      fullWidth
      variant={props.filled ? "contained" : "outlined"}
      role={props.role}
      aria-checked={toggle ? props.checked : undefined}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      endIcon={toggle && props.checked ? <Check fontSize="small" /> : undefined}
      sx={{
        justifyContent: "space-between",
        textAlign: "left",
        py: 1.5,
        px: 3,
        ...(toggle &&
          props.checked && {
            borderColor: mainVar("primary"),
            backgroundColor: tint(mainVar("primary"), 12),
            "&:hover": {
              borderColor: mainVar("primary"),
              backgroundColor: tint(mainVar("primary"), 18),
            },
          }),
      }}
    >
      <OptionLabel label={props.label} description={props.description} />
    </Button>
  );
}

/**
 * The questions of a gate with several questions or a multi-select one (design decision 6): each
 * question with its header and its options as choices, and "Send answers". The answer is one text
 * in the format of the AskUserQuestion result of Claude Code (`questionAnswer`).
 */
export function QuestionList(props: {
  questions: readonly GateQuestion[];
  disabled: boolean;
  onSend: (answer: string) => void;
}) {
  const [picks, setPicks] = useState<string[][]>(() => props.questions.map(() => []));
  const toggle = (i: number, label: string, multi: boolean) =>
    setPicks((all) =>
      all.map((p, j) => {
        if (j !== i) return p;
        if (!multi) return [label];
        return p.includes(label) ? p.filter((l) => l !== label) : [...p, label];
      }),
    );
  const none = picks.every((p) => p.length === 0);
  return (
    <Stack spacing={2} data-testid="gate-questions">
      {props.questions.map((q, i) => (
        <Stack key={`${i}-${q.question}`} spacing={1} role="group" aria-label={q.question}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            {q.header && <Chip size="small" variant="outlined" label={q.header} />}
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {q.question}
            </Typography>
          </Stack>
          {q.multi_select && (
            <Typography variant="caption" color="text.secondary">
              Select one or more.
            </Typography>
          )}
          <Stack spacing={1}>
            {q.options.map((o) => (
              <OptionButton
                key={o.label}
                label={o.label}
                description={o.description}
                role={q.multi_select ? "checkbox" : "radio"}
                checked={picks[i]?.includes(o.label) ?? false}
                disabled={props.disabled}
                onClick={() => toggle(i, o.label, q.multi_select)}
              />
            ))}
          </Stack>
        </Stack>
      ))}
      <Box>
        <Button
          variant="contained"
          disabled={props.disabled || none}
          onClick={() => props.onSend(questionAnswer(props.questions, picks))}
        >
          Send answers
        </Button>
      </Box>
    </Stack>
  );
}
