// Small parts that many screens use: the state chips of a task, the Markdown view, placeholders.
import HourglassEmpty from "@mui/icons-material/HourglassEmptyOutlined";
import PanTool from "@mui/icons-material/PanToolOutlined";
import Pause from "@mui/icons-material/PauseOutlined";
import { Box, Chip, Skeleton, Stack, Typography, type ChipProps } from "@mui/material";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Task } from "../../../shared/channels.ts";
import { call } from "../bridge.ts";
import { details, gateLabel, pauseLabel, pauseText, stageLabel } from "../model.ts";
import type { TaskQueue } from "../queue-model.ts";
import { QueueChip } from "./QueueChip.tsx";

const STAGE_COLOR: Record<string, ChipProps["color"]> = {
  backlog: "default",
  discuss: "info",
  ready: "info",
  implement: "info",
  review: "info",
  done: "success",
};

export function StageChip({ stage }: { stage: string }) {
  return (
    <Chip label={stageLabel(stage)} color={STAGE_COLOR[stage] ?? "default"} variant="outlined" />
  );
}

export function PausedChip({ task }: { task: Task }) {
  const paused = details(task).paused;
  if (!paused) return null;
  return (
    <Chip
      icon={<Pause />}
      label={`Paused · ${pauseLabel(paused)}`}
      variant="outlined"
      title={paused.next_step}
    />
  );
}

/** The first "Needs you" reason of a task as a chip. */
export function NeedsYouChip({ task }: { task: Task }) {
  const reason = task.needs_you_reasons[0];
  if (!reason) return null;
  let label = "Needs you";
  if (reason.reason === "assign") label = "Needs you: assign";
  else if (reason.reason === "gate" && typeof reason.kind === "string")
    label = gateLabel(reason.kind);
  else if (reason.reason === "paused" && typeof reason.cause === "string") {
    label = `Needs you: ${pauseText(reason.cause)}`;
  }
  return <Chip icon={<PanTool />} label={label} color="warning" />;
}

/** The chips of a task: "Needs you", else the stage, and the Paused chip. */
export function TaskChips({ task, queue }: { task: Task; queue?: TaskQueue | undefined }) {
  const moving = details(task).moving_to;
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
      {task.needs_you_lane ? <NeedsYouChip task={task} /> : <StageChip stage={task.stage} />}
      <PausedChip task={task} />
      {moving && (
        <Chip icon={<HourglassEmpty />} label={`Moving to ${moving}`} variant="outlined" />
      )}
      {queue && <QueueChip queue={queue} />}
    </Stack>
  );
}

/** Markdown with raw HTML off. A link opens in the default browser (https only). */
export function MarkdownText({ text }: { text: string }) {
  return (
    <Box
      sx={{
        overflowWrap: "anywhere",
        "& p": { my: 1 },
        "& p:first-of-type": { mt: 0 },
        "& p:last-of-type": { mb: 0 },
        // Headings stay small inside a card or a message (docs/design.md 3).
        "& h1, & h2": { typography: "subtitle1", mt: 2, mb: 1 },
        "& h3, & h4, & h5, & h6": {
          typography: "body1",
          fontWeight: "fontWeightBold",
          mt: 2,
          mb: 1,
        },
        "& > :first-child": { mt: 0 },
        "& pre": { p: 2, borderRadius: 1, bgcolor: "aw.raised", overflowX: "auto" },
        "& code": { fontFamily: "var(--aw-font-mono)", fontSize: "0.92em" },
        "& ul, & ol": { pl: 5, my: 1 },
      }}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault();
                if (href?.startsWith("https://")) void call("openExternal", { url: href });
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </Box>
  );
}

/** Raw text as written: the thread shows each message as is. */
export function RawText({ text }: { text: string }) {
  return (
    <Typography
      component="div"
      variant="body1"
      sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
    >
      {text}
    </Typography>
  );
}

/** An empty screen: one line that says what is missing, and the next step (docs/design.md 8.13). */
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  /** The button of the next step, for example "Add a project". */
  action?: ReactNode;
}) {
  return (
    <Stack
      spacing={1}
      sx={{ alignItems: "center", textAlign: "center", py: 10, px: 4, color: "text.secondary" }}
    >
      <Typography variant="subtitle1" color="text.primary">
        {title}
      </Typography>
      {children && <Typography variant="body2">{children}</Typography>}
      {action && <Box sx={{ pt: 2 }}>{action}</Box>}
    </Stack>
  );
}

/** The time before a screen shows its skeleton rows (docs/design.md 8.13.2). */
export const LOADING_DELAY_MS = 300;

/**
 * The loading state of a screen: nothing for 300 ms, then skeleton rows of the size of the content
 * (36 px list rows by default), so a fast reply shows no flash.
 */
export function LoadingRows({
  rows = 4,
  height = 36,
  label = "Loading",
}: {
  rows?: number;
  height?: number;
  label?: string;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!shown) return null;
  return (
    <Stack spacing={1} sx={{ p: 2 }} role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: rows }, (_v, i) => (
        <Skeleton key={i} variant="rounded" height={height} />
      ))}
    </Stack>
  );
}

/** The header of a page: the title, an optional description line and the actions on the right. */
export function PageHeader(props: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Typography variant="h2" sx={{ flex: 1, minWidth: 0 }}>
          {props.title}
        </Typography>
        {props.actions}
      </Stack>
      {props.description && (
        <Typography variant="body2" color="text.secondary">
          {props.description}
        </Typography>
      )}
    </Stack>
  );
}

/** A titled group of a settings page (docs/design.md 8.16). */
export function Section(props: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  id?: string;
}) {
  const id = props.id ?? `section-${props.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <Box component="section" aria-labelledby={id}>
      <Typography variant="subtitle1" component="h2" id={id}>
        {props.title}
      </Typography>
      {props.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {props.description}
        </Typography>
      )}
      {props.children && (
        <Stack spacing={4} sx={{ mt: 4 }}>
          {props.children}
        </Stack>
      )}
    </Box>
  );
}

/**
 * One property row: the label in `text3` on the left and the value on the right. Below 600 px the
 * value goes under the label.
 */
export function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box
      role="group"
      aria-label={label}
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "minmax(96px, 128px) minmax(0, 1fr)" },
        columnGap: 3,
        rowGap: 0.5,
        py: 1.5,
        alignItems: "baseline",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ minWidth: 0, overflowWrap: "anywhere", typography: "body1" }}>{children}</Box>
    </Box>
  );
}

/** A read-only block of text in the mono family (a diff, a file, a suggestion). */
export function CodeBlock({
  children,
  maxHeight,
  label,
}: {
  children: ReactNode;
  maxHeight?: number;
  label?: string;
}) {
  return (
    <Typography
      component="pre"
      variant="body2"
      aria-label={label}
      sx={{
        m: 0,
        p: 2,
        fontFamily: "var(--aw-font-mono)",
        bgcolor: "aw.raised",
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        overflow: "auto",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        ...(maxHeight ? { maxHeight } : {}),
      }}
    >
      {children}
    </Typography>
  );
}

/**
 * Up and Down in a list (docs/design.md 8.4.4): the focus moves to the previous or the next row
 * (an element with `data-row`) of the list that has the handler. Enter opens the row (a button).
 */
export function moveRowFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-row]")];
  if (rows.length === 0) return;
  const at = rows.findIndex(
    (r) => r === document.activeElement || r.contains(document.activeElement),
  );
  const next = event.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
  event.preventDefault();
  rows[at === -1 ? 0 : next]?.focus();
}
