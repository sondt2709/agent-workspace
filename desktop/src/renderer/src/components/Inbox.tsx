// The Inbox (openspec inbox-mattermost, spec inbox-cards "Desktop Inbox"): one list of the cards of
// the incoming messages with the filter bar; a card opens in a dialog (CardDialog). The filter and
// the open card are in the route: `?cat=`, `?projects=`, `?unread=1`, `?done=1`, `?sort=newest`,
// `?card=<id>`.
import {
  cardCounts,
  cardRows,
  DEFAULT_CARD_FILTER,
  type CardCategory,
  type CardFilter,
} from "@aw/client/inbox";
import HelpOutline from "@mui/icons-material/HelpOutlineOutlined";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import Sync from "@mui/icons-material/SyncOutlined";
import TaskAlt from "@mui/icons-material/TaskAltOutlined";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { InboxCard } from "../../../shared/channels.ts";
import { call, errorText } from "../bridge.ts";
import { useNow } from "../clock.ts";
import {
  useInboxCards,
  useInboxWrite,
  useProjects,
  useSources,
  useSourceStatus,
} from "../queries.ts";
import { CardDialog } from "./CardDialog.tsx";
import { Empty, LoadingRows } from "./common.tsx";
import { ProjectFilter, useProjectFilter } from "./ProjectFilter.tsx";

const CATEGORY = {
  action: { label: "Action", icon: TaskAlt, color: "aw.run" },
  question: { label: "Question", icon: HelpOutline, color: "warning.main" },
  info: { label: "Info", icon: InfoOutlined, color: "text.secondary" },
} as const;

/** The category icon in a fixed 24 × 24 px box: each title starts at the same place. */
export function CategoryIcon({ category }: { category: CardCategory }) {
  const c = CATEGORY[category];
  const Icon = c.icon;
  return (
    <Box
      role="img"
      aria-label={c.label}
      title={c.label}
      sx={{
        width: 24,
        height: 24,
        flex: "none",
        borderRadius: 1.5,
        display: "grid",
        placeItems: "center",
        color: c.color,
        bgcolor: "aw.selected",
      }}
    >
      <Icon sx={{ fontSize: 15 }} />
    </Box>
  );
}

export function categoryLabel(category: CardCategory): string {
  return CATEGORY[category].label;
}

/** The urgency as 3 bars: high red, normal 2 bars, low 1 bar. */
export function UrgencyBars({ urgency }: { urgency: InboxCard["urgency"] }) {
  const lit = urgency === "high" ? 3 : urgency === "normal" ? 2 : 1;
  const color = urgency === "high" ? "error.main" : "text.secondary";
  return (
    <Stack
      direction="row"
      spacing="2px"
      role="img"
      aria-label={`${urgency} urgency`}
      title={`${urgency} urgency`}
      sx={{ flex: "none" }}
    >
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{ width: 4, height: 12, borderRadius: "1px", bgcolor: i < lit ? color : "divider" }}
        />
      ))}
    </Stack>
  );
}

/** "10:41" today, "Yesterday", else the date. */
export function cardTime(iso: string, now: number): string {
  const date = new Date(iso);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) {
    return date.toTimeString().slice(0, 5);
  }
  const yesterday = new Date(now - 24 * 60 * 60_000);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toISOString().slice(0, 10);
}

/** "1 min ago", "3 h ago". */
export function ago(iso: string | null, now: number): string {
  if (iso === null) return "not read yet";
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

/** The filter of the route. */
export function useCardFilter(): {
  filter: CardFilter;
  set: (key: string, value: string | null) => void;
} {
  const [params, setParams] = useSearchParams();
  const projects = useProjectFilter(true).selected;
  const cat = params.get("cat");
  const filter: CardFilter = {
    ...DEFAULT_CARD_FILTER,
    category: cat === "action" || cat === "question" || cat === "info" ? cat : "all",
    projects,
    unread: params.get("unread") === "1",
    done: params.get("done") === "1",
    sort: params.get("sort") === "newest" ? "newest" : "urgency",
  };
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next);
  };
  return { filter, set };
}

function SourceLine({ ws }: { ws: string }) {
  const sources = useSources(ws).data ?? [];
  const source = sources.find((s) => !s.removed);
  const status = useSourceStatus(ws, source?.source).data;
  const now = useNow(30_000);
  const run = useInboxWrite(ws, () => call("inboxRun", { ws }));
  if (!source) return null;
  const error = status?.health?.error ?? null;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
      <Box
        sx={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          flex: "none",
          bgcolor: error ? "error.main" : source.collector ? "success.main" : "text.disabled",
        }}
      />
      <Typography variant="caption" color="text.secondary" noWrap title={error ?? undefined}>
        {source.name} · {error ? "error" : ago(status?.health?.last_read_at ?? null, now)}
      </Typography>
      <Tooltip title="Run now (⇧⌘R)">
        <span>
          <IconButton
            size="small"
            aria-label="Run now"
            disabled={run.isPending || source.collector === null}
            onClick={() => run.mutate(undefined)}
          >
            <Sync sx={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
}

function CardRow(props: {
  card: InboxCard;
  project: string | null;
  now: number;
  onOpen: () => void;
}) {
  const { card } = props;
  const where = [props.project, card.conversation.name].filter(Boolean).join(" · ");
  return (
    <ButtonBase
      data-row
      onClick={props.onOpen}
      aria-label={`${categoryLabel(card.category)}: ${card.title}${card.read ? "" : ", unread"}`}
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "8px 24px minmax(0,1fr) 56px",
          md: "8px 24px minmax(0,1fr) auto 24px 64px",
        },
        columnGap: 2.5,
        alignItems: "center",
        px: 4,
        minHeight: 44,
        width: "100%",
        textAlign: "left",
        borderBottom: 1,
        borderColor: "divider",
        opacity: card.done ? 0.55 : 1,
        "&:hover": { bgcolor: "aw.hover" },
        "&:focus-visible": { bgcolor: "aw.selected" },
      }}
    >
      <Box
        sx={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          bgcolor: card.read ? "transparent" : "primary.main",
        }}
      />
      <CategoryIcon category={card.category} />
      <Typography
        noWrap
        sx={{
          fontWeight: card.read ? "fontWeightRegular" : "fontWeightBold",
          color: card.read ? "aw.text2" : "text.primary",
        }}
      >
        {card.title}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        noWrap
        sx={{ display: { xs: "none", md: "block" }, maxWidth: 260 }}
      >
        {where}
      </Typography>
      <Box sx={{ display: { xs: "none", md: "flex" }, justifyContent: "flex-end" }}>
        <UrgencyBars urgency={card.urgency} />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ textAlign: "right" }}>
        {cardTime(card.last_message_at, props.now)}
      </Typography>
    </ButtonBase>
  );
}

export function Inbox() {
  const { ws = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const cards = useInboxCards(ws);
  const sources = useSources(ws);
  const projects = useProjects(ws).data ?? [];
  const now = useNow(60_000);
  const { filter, set } = useCardFilter();
  const run = useInboxWrite(ws, () => call("inboxRun", { ws }));
  const collecting = (sources.data ?? []).some((s) => !s.removed && s.collector !== null);
  // ⇧⌘R (Shift+Ctrl+R): Run now (spec inbox-cards "Desktop Inbox"). ⌘R stays "Sync now" of the
  // app menu. Only when a device collects and no card or other dialog is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "r" || event.defaultPrevented) return;
      if (!collecting || document.querySelector("[role='dialog']")) return;
      event.preventDefault();
      run.mutate(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, collecting]);
  if (cards.isPending || sources.isPending)
    return <LoadingRows rows={6} label="Loading the Inbox" />;
  if (cards.isError) {
    return (
      <Alert severity="error" sx={{ m: 4 }}>
        {errorText(cards.error)}
      </Alert>
    );
  }
  const live = (sources.data ?? []).filter((s) => !s.removed);
  const rows = cardRows(cards.data, filter);
  const counts = cardCounts(cards.data);
  const open = params.get("card");
  const name = (slug: string | null) =>
    slug === null ? null : (projects.find((p) => p.slug === slug)?.name ?? slug);
  const select = (card: string | null) => {
    const next = new URLSearchParams(params);
    if (card === null) next.delete("card");
    else next.set("card", card);
    setParams(next);
  };
  const chip = (value: CardFilter["category"], label: string, count?: number) => (
    <Chip
      key={value}
      size="small"
      label={count === undefined ? label : `${label} ${count}`}
      variant={filter.category === value ? "filled" : "outlined"}
      onClick={() => set("cat", value === "all" ? null : value)}
      aria-pressed={filter.category === value}
    />
  );
  return (
    <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{
          flex: "none",
          px: 4,
          py: 1.5,
          borderBottom: 1,
          borderColor: "divider",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {chip("all", "All")}
        {chip("action", "Action", counts.action)}
        {chip("question", "Question", counts.question)}
        {chip("info", "Info", counts.info)}
        <Box sx={{ flex: 1 }} />
        <ProjectFilter allowNone />
        <Chip
          size="small"
          label="Unread"
          variant={filter.unread ? "filled" : "outlined"}
          onClick={() => set("unread", filter.unread ? null : "1")}
          aria-pressed={filter.unread}
        />
        <Chip
          size="small"
          label="Done"
          variant={filter.done ? "filled" : "outlined"}
          onClick={() => set("done", filter.done ? null : "1")}
          aria-pressed={filter.done}
        />
        <Chip
          size="small"
          label={filter.sort === "urgency" ? "Urgency ↓" : "Newest ↓"}
          variant="outlined"
          onClick={() => set("sort", filter.sort === "urgency" ? "newest" : null)}
        />
        <SourceLine ws={ws} />
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {live.length === 0 && cards.data.length === 0 ? (
          <Empty
            title="No source yet"
            action={
              <Button variant="contained" onClick={() => void navigate(`/w/${ws}/sources`)}>
                Add a source
              </Button>
            }
          >
            Connect Mattermost. An agent sorts the new messages into cards here.
          </Empty>
        ) : rows.length === 0 ? (
          <Empty title="No cards">New messages show here after the next batch.</Empty>
        ) : (
          rows.map((card) => (
            <CardRow
              key={card.card}
              card={card}
              project={name(card.project)}
              now={now}
              onOpen={() => select(card.card)}
            />
          ))
        )}
      </Box>
      {open && (
        <CardDialog
          ws={ws}
          cardId={open}
          rows={rows}
          onSelect={select}
          onClose={() => select(null)}
        />
      )}
    </Box>
  );
}
