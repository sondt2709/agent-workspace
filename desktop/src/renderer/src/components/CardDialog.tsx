// The card dialog of the Inbox (openspec inbox-mattermost, spec inbox-cards): the title, the
// category, the urgency, the summary, the suggestion (a task for an action, an answer for a
// question), the original messages, the asks of the person and the answers of the triage agent.
// Keys: ↑ ↓ j k (previous, next), r (reply), t (ask), d (done), u (unread), Esc (close).
import type { CardCategory } from "@aw/client/inbox";
import Check from "@mui/icons-material/CheckOutlined";
import Close from "@mui/icons-material/CloseOutlined";
import ContentCopy from "@mui/icons-material/ContentCopyOutlined";
import ArrowDownward from "@mui/icons-material/KeyboardArrowDownOutlined";
import ArrowUpward from "@mui/icons-material/KeyboardArrowUpOutlined";
import OpenInNew from "@mui/icons-material/OpenInNewOutlined";
import Send from "@mui/icons-material/SendOutlined";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  type Theme,
} from "@mui/material";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import type { InboxCard } from "../../../shared/channels.ts";
import { call, errorText } from "../bridge.ts";
import { useNow } from "../clock.ts";
import {
  useDevices,
  useInboxCards,
  useInboxWrite,
  useProjects,
  useSources,
  useTask,
} from "../queries.ts";
import { cardTime, CategoryIcon, categoryLabel, UrgencyBars } from "./Inbox.tsx";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={1.5}>
      <Typography variant="overline" color="text.secondary" component="h3">
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

function Box2({
  title,
  accent,
  children,
}: {
  title: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <Stack
      spacing={1.5}
      sx={{
        p: 3,
        borderRadius: 2,
        border: 1,
        borderColor: accent ? "primary.main" : "divider",
        bgcolor: "aw.raised",
      }}
    >
      <Typography variant="overline" color="text.secondary" component="h3">
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

/** One task of a card: "<key> created" and "Open task" (spec inbox-cards). */
function CreatedTask({ ws, task }: { ws: string; task: string }) {
  const navigate = useNavigate();
  const key = useTask(ws, task).data?.key ?? null;
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
      <Typography sx={{ flex: 1 }}>{key ? `${key} created` : "Task created"}</Typography>
      <Button size="small" onClick={() => void navigate(`/w/${ws}/tasks/${task}`)}>
        Open task
      </Button>
    </Stack>
  );
}

/** The suggested task: the form of "Create task…" (a task always has a project). */
function TaskBox({ ws, card }: { ws: string; card: InboxCard }) {
  const projects = (useProjects(ws).data ?? []).filter((p) => !p.archived);
  const devices = (useDevices(ws).data ?? []).filter(
    (d) => d.state === "valid" && d.role !== "mobile",
  );
  const [form, setForm] = useState<null | {
    title: string;
    project: string;
    assignee: string;
    first_message: string;
  }>(null);
  const create = useInboxWrite(ws, (body: NonNullable<typeof form>) =>
    call("cardTask", {
      ws,
      card: card.card,
      body: {
        title: body.title,
        project: body.project,
        first_message: body.first_message,
        assignee: body.assignee === "" ? null : body.assignee,
      },
    }),
  );
  const made = card.chat.filter((c) => c.kind === "task");
  if (made.length > 0 && form === null) {
    return (
      <Box2 title="Task">
        {made.map((m) => (
          <CreatedTask key={m.id} ws={ws} task={m.id} />
        ))}
      </Box2>
    );
  }
  const suggestion = card.task;
  if (!suggestion) return null;
  if (form === null) {
    const project = suggestion.project ?? card.project;
    return (
      <Box2 title="Suggested task" accent>
        <Typography>{suggestion.title}</Typography>
        <Typography variant="caption" color={project ? "text.secondary" : "warning.main"}>
          {project
            ? (projects.find((p) => p.slug === project)?.name ?? project)
            : "Choose a project"}
        </Typography>
        <Box>
          <Button
            variant="contained"
            size="small"
            onClick={() =>
              setForm({
                title: suggestion.title,
                project: project ?? "",
                assignee: "",
                first_message: suggestion.first_message,
              })
            }
          >
            Create task…
          </Button>
        </Box>
      </Box2>
    );
  }
  const missing = form.project === "";
  return (
    <Box2 title="New task" accent>
      <TextField
        label="Title"
        size="small"
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          select
          label="Project"
          size="small"
          required
          error={missing}
          helperText={missing ? "Choose a project" : undefined}
          value={form.project}
          onChange={(e) => setForm({ ...form, project: e.target.value })}
          sx={{ flex: 1 }}
        >
          {projects.map((p) => (
            <MenuItem key={p.slug} value={p.slug}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Assignee"
          size="small"
          value={form.assignee}
          onChange={(e) => setForm({ ...form, assignee: e.target.value })}
          sx={{ flex: 1 }}
        >
          <MenuItem value="">None</MenuItem>
          {devices.map((d) => (
            <MenuItem key={d.slug} value={`claude@${d.slug}`}>
              claude@{d.slug}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <TextField
        label="First message"
        size="small"
        multiline
        minRows={4}
        value={form.first_message}
        onChange={(e) => setForm({ ...form, first_message: e.target.value })}
      />
      {create.isError && <Alert severity="error">{errorText(create.error)}</Alert>}
      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          size="small"
          disabled={missing || form.title.trim() === "" || create.isPending}
          onClick={() => create.mutate(form, { onSuccess: () => setForm(null) })}
        >
          Create task
        </Button>
        <Button size="small" onClick={() => setForm(null)}>
          Cancel
        </Button>
      </Stack>
    </Box2>
  );
}

/** The suggested answer and "Reply…": the reply goes to the thread through the collecting device. */
function AnswerBox(props: {
  ws: string;
  card: InboxCard;
  replying: boolean;
  setReplying: (on: boolean) => void;
}) {
  const { ws, card } = props;
  const source = (useSources(ws).data ?? []).find((s) => s.source === card.source);
  const now = useNow(60_000);
  const [text, setText] = useState(card.answer?.text ?? "");
  // Each start of a reply (the button or r) loads the current answer of this card.
  useEffect(() => {
    if (props.replying) setText(card.answer?.text ?? "");
  }, [props.replying]);
  const reply = useInboxWrite(ws, (body: string) =>
    call("replyCard", { ws, card: card.card, text: body, in_thread: true }),
  );
  if (!card.answer && card.replies.length === 0 && !props.replying) return null;
  const sent = card.replies.at(-1);
  return (
    <Box2 title={props.replying ? "Reply" : "Suggested answer"} accent>
      {props.replying ? (
        <>
          <TextField
            multiline
            minRows={4}
            size="small"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            slotProps={{ htmlInput: { "aria-label": "Reply" } }}
          />
          <Typography variant="caption" color="text.secondary">
            As @{source?.username ?? "you"} · {card.conversation.name} · in the thread
          </Typography>
          {reply.isError && <Alert severity="error">{errorText(reply.error)}</Alert>}
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="small"
              startIcon={<Send />}
              disabled={text.trim() === "" || reply.isPending}
              onClick={() => reply.mutate(text, { onSuccess: () => props.setReplying(false) })}
            >
              Send
            </Button>
            <Button size="small" onClick={() => props.setReplying(false)}>
              Cancel
            </Button>
          </Stack>
        </>
      ) : (
        <>
          {card.answer && (
            <Typography sx={{ whiteSpace: "pre-wrap" }}>
              {card.answer.text}
              {card.answer.from && (
                <Typography component="span" variant="caption" color="text.secondary">
                  {` · ${card.answer.from}`}
                </Typography>
              )}
            </Typography>
          )}
          {sent && (
            <Typography
              variant="caption"
              color={
                sent.state === "failed"
                  ? "error.main"
                  : sent.state === "sent"
                    ? "success.main"
                    : "text.secondary"
              }
            >
              {sent.state === "sent"
                ? `Sent ${sent.result_hlc ? cardTime(sent.result_hlc.slice(0, 24), now) : ""}`
                : sent.state === "failed"
                  ? `Not sent: ${sent.error ?? "error"}`
                  : "Not synced: the collecting device sends it"}
            </Typography>
          )}
          <Stack direction="row" spacing={1}>
            <Button variant="contained" size="small" onClick={() => props.setReplying(true)}>
              Reply…{" "}
              <Box component="kbd" sx={{ ml: 1, opacity: 0.7 }}>
                r
              </Box>
            </Button>
            {card.answer && (
              <Button
                size="small"
                startIcon={<ContentCopy />}
                onClick={() => void navigator.clipboard?.writeText(card.answer!.text)}
              >
                Copy
              </Button>
            )}
          </Stack>
        </>
      )}
    </Box2>
  );
}

function Ask({
  ws,
  card,
  inputRef,
}: {
  ws: string;
  card: InboxCard;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [text, setText] = useState("");
  const ask = useInboxWrite(ws, (body: string) =>
    call("askCard", { ws, card: card.card, text: body }),
  );
  const waiting = card.chat.some((c) => c.kind === "ask" && c.answered === false);
  const send = () => {
    if (text.trim() === "") return;
    ask.mutate(text.trim(), { onSuccess: () => setText("") });
  };
  return (
    <Section title="Ask the agent">
      {card.chat
        .filter((c) => c.kind !== "task")
        .map((c) => (
          <Stack key={`${c.kind}-${c.id}`} spacing={0.25}>
            <Typography
              variant="caption"
              color={c.kind === "ask" ? "primary.main" : "text.secondary"}
            >
              {c.kind === "ask" ? "You" : "Agent"}
            </Typography>
            <Typography sx={{ whiteSpace: "pre-wrap" }}>{c.text}</Typography>
          </Stack>
        ))}
      {waiting && (
        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
          The agent works on it…
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-end" }}>
        <TextField
          multiline
          size="small"
          fullWidth
          placeholder="Ask about this card"
          value={text}
          inputRef={inputRef}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          slotProps={{ htmlInput: { "aria-label": "Ask the agent" } }}
        />
        <Tooltip title="Send (⌘↵)">
          <span>
            <IconButton
              aria-label="Send the question"
              color="primary"
              disabled={text.trim() === "" || ask.isPending}
              onClick={send}
            >
              <Send />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      {ask.isError && <Alert severity="error">{errorText(ask.error)}</Alert>}
    </Section>
  );
}

export function CardDialog(props: {
  ws: string;
  cardId: string;
  /** The rows of the list, in its order: Previous and Next. */
  rows: InboxCard[];
  onSelect: (card: string) => void;
  onClose: () => void;
}) {
  const { ws } = props;
  const narrow = useMediaQuery((theme: Theme) => theme.breakpoints.down("sm"));
  const cards = useInboxCards(ws).data ?? [];
  const projects = useProjects(ws).data ?? [];
  const now = useNow(60_000);
  const card = cards.find((c) => c.card === props.cardId);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [replying, setReplying] = useState(false);
  const askRef = useRef<HTMLTextAreaElement | null>(null);
  const [projectMenu, setProjectMenu] = useState<HTMLElement | null>(null);
  // Each write names its card: a write never changes a card that the dialog shows later.
  const setState = useInboxWrite(
    ws,
    ({
      card: id,
      ...body
    }: {
      card: string;
      read?: boolean;
      done?: boolean;
      category?: CardCategory;
      project?: string | null;
    }) => call("setCardState", { ws, card: id, body }),
  );
  // Opening a card marks it read (spec inbox-cards "Card actions").
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (card && !card.read && marked.current !== card.card) {
      marked.current = card.card;
      setState.mutate({ card: card.card, read: true });
    }
    setReplying(false);
  }, [card?.card]);
  // Previous and Next keep the order of the list from when the card was in it: a card that leaves
  // the list (done, or read with "Unread" on) still has its neighbours.
  const order = useRef<string[]>([]);
  if (props.rows.some((c) => c.card === props.cardId))
    order.current = props.rows.map((c) => c.card);
  const index = order.current.indexOf(props.cardId);
  const neighbour = (delta: number): string | null => {
    if (index < 0) return null;
    for (let i = index + delta; i >= 0 && i < order.current.length; i += delta) {
      const id = order.current[i]!;
      if (cards.some((c) => c.card === id)) return id;
    }
    return null;
  };
  const step = (delta: number) => {
    const next = neighbour(delta);
    if (next) props.onSelect(next);
  };
  const toggleDone = () => {
    if (!card) return;
    const done = !card.done;
    // Done goes on to the next card, as the list does.
    setState.mutate({ card: card.card, done }, { onSuccess: () => done && step(1) });
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    // A menu or a select handles its own keys (React passes the keys of its portal to the dialog).
    if (event.defaultPrevented || menu !== null || projectMenu !== null) return;
    if (
      target.closest("input, textarea, [contenteditable='true'], [role='menu'], [role='listbox']")
    ) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    if (key === "j" || key === "ArrowDown") step(1);
    else if (key === "k" || key === "ArrowUp") step(-1);
    else if (key === "r" && card?.category === "question") setReplying(true);
    else if (key === "t") askRef.current?.focus();
    else if (key === "d" && card) toggleDone();
    else if (key === "u" && card) setState.mutate({ card: card.card, read: !card.read });
    else return;
    event.preventDefault();
  };
  const project = card?.project
    ? (projects.find((p) => p.slug === card.project)?.name ?? card.project)
    : "No project";
  const link = card?.messages.find((m) => m.url)?.url ?? null;
  return (
    <Dialog
      open
      onClose={props.onClose}
      fullScreen={narrow}
      maxWidth="md"
      fullWidth
      onKeyDown={onKeyDown}
      aria-labelledby="card-title"
    >
      {!card ? (
        <Stack sx={{ p: 4 }} spacing={2}>
          <Typography>This card is not here any more.</Typography>
          <Box>
            <Button onClick={props.onClose}>Close</Button>
          </Box>
        </Stack>
      ) : (
        <>
          <Stack spacing={1} sx={{ px: 4, pt: 3, pb: 2, borderBottom: 1, borderColor: "divider" }}>
            <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
              <CategoryIcon category={card.category} />
              <Typography
                id="card-title"
                variant="h2"
                component="h2"
                sx={{ flex: 1, textWrap: "balance" }}
              >
                {card.title}
              </Typography>
              <IconButton
                aria-label="Previous (k)"
                disabled={neighbour(-1) === null}
                onClick={() => step(-1)}
                size="small"
              >
                <ArrowUpward />
              </IconButton>
              <IconButton
                aria-label="Next (j)"
                disabled={neighbour(1) === null}
                onClick={() => step(1)}
                size="small"
              >
                <ArrowDownward />
              </IconButton>
              <IconButton aria-label="Close (Esc)" onClick={props.onClose} size="small" autoFocus>
                <Close />
              </IconButton>
            </Stack>
            <Stack
              direction="row"
              spacing={1.5}
              useFlexGap
              sx={{ alignItems: "center", flexWrap: "wrap", pl: "40px", color: "text.secondary" }}
            >
              <Chip
                size="small"
                variant="outlined"
                label={`${categoryLabel(card.category)} ▾`}
                aria-haspopup="menu"
                onClick={(e) => setMenu(e.currentTarget)}
              />
              <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
                {(["action", "question", "info"] as const).map((c) => (
                  <MenuItem
                    key={c}
                    selected={c === card.category}
                    onClick={() => {
                      setMenu(null);
                      if (c !== card.category) setState.mutate({ card: card.card, category: c });
                    }}
                  >
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                      <CategoryIcon category={c} />
                      <span>{categoryLabel(c)}</span>
                      {c === card.category && <Check fontSize="small" />}
                    </Stack>
                  </MenuItem>
                ))}
              </Menu>
              <UrgencyBars urgency={card.urgency} />
              <Chip
                size="small"
                variant="outlined"
                label={`Project: ${project} ▾`}
                aria-haspopup="menu"
                onClick={(e) => setProjectMenu(e.currentTarget)}
              />
              <Menu
                anchorEl={projectMenu}
                open={projectMenu !== null}
                onClose={() => setProjectMenu(null)}
              >
                {[{ slug: null, name: "No project" }, ...projects.filter((p) => !p.archived)].map(
                  (p) => (
                    <MenuItem
                      key={p.slug ?? "none"}
                      selected={p.slug === card.project}
                      onClick={() => {
                        setProjectMenu(null);
                        if (p.slug !== card.project) {
                          setState.mutate({ card: card.card, project: p.slug });
                        }
                      }}
                    >
                      {p.name}
                    </MenuItem>
                  ),
                )}
              </Menu>
              <Typography variant="caption">·</Typography>
              <Typography variant="caption">{card.conversation.name}</Typography>
              <Typography variant="caption">·</Typography>
              <Typography variant="caption">{cardTime(card.last_message_at, now)}</Typography>
            </Stack>
          </Stack>
          <Stack spacing={3} sx={{ px: 4, py: 3, overflowY: "auto" }}>
            {card.summary && (
              <Typography sx={{ color: "aw.text2", maxWidth: "68ch" }}>{card.summary}</Typography>
            )}
            {card.category === "action" && (
              <TaskBox key={`task-${card.card}`} ws={ws} card={card} />
            )}
            {card.category === "question" && (
              <AnswerBox
                key={`answer-${card.card}`}
                ws={ws}
                card={card}
                replying={replying}
                setReplying={setReplying}
              />
            )}
            <Section title="Messages">
              {card.messages.map((m) => (
                <Stack key={m.id} spacing={0.25}>
                  <Typography variant="body2">
                    <Box component="span" sx={{ fontWeight: "fontWeightMedium" }}>
                      {m.author}
                    </Box>
                    <Typography component="span" variant="caption" color="text.secondary">
                      {`  ${cardTime(m.at, now)}`}
                    </Typography>
                  </Typography>
                  {m.quote && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ borderLeft: 2, borderColor: "divider", pl: 1 }}
                    >
                      {m.quote}
                    </Typography>
                  )}
                  <Typography sx={{ whiteSpace: "pre-wrap", color: "aw.text2", maxWidth: "68ch" }}>
                    {m.text}
                  </Typography>
                </Stack>
              ))}
            </Section>
            <Ask key={`ask-${card.card}`} ws={ws} card={card} inputRef={askRef} />
          </Stack>
          <Divider />
          <Stack direction="row" spacing={1} sx={{ px: 3, py: 1.5, alignItems: "center" }}>
            <Button size="small" variant="outlined" startIcon={<Check />} onClick={toggleDone}>
              {card.done ? "Not done" : "Done"}
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setState.mutate({ card: card.card, read: !card.read })}
            >
              {card.read ? "Mark unread" : "Mark read"}
            </Button>
            <Box sx={{ flex: 1 }} />
            {link?.startsWith("https://") && (
              <Button
                size="small"
                startIcon={<OpenInNew />}
                onClick={() => void call("openExternal", { url: link })}
              >
                Open in Mattermost
              </Button>
            )}
          </Stack>
        </>
      )}
    </Dialog>
  );
}
