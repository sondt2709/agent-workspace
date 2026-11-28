// Sources (openspec inbox-mattermost, spec inbox-sources "Sources page"): the Mattermost connection
// and the collecting device, the triage session, and the conversations with their projects and read
// level. Each change writes the whole configuration (`source.configured`).
import Search from "@mui/icons-material/SearchOutlined";
import {
  Alert,
  Box,
  Button,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import type { InboxSource } from "../../../shared/channels.ts";
import { errorText } from "../bridge.ts";
import { useNow } from "../clock.ts";
import {
  useCredentials,
  useDevices,
  useProjects,
  useSourceConversations,
  useSources,
  useSourceSave,
  useSourceStatus,
} from "../queries.ts";
import { LoadingRows } from "./common.tsx";
import { ago } from "./Inbox.tsx";

const SOURCE = "mattermost";
const MODELS = ["haiku", "sonnet", "opus"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_EVERY_MIN = 1440;

type ReadLevel = "all" | "tagged" | "off";
type Conversation = { id: string; name: string; kind: string };

/** Minutes from a text like `15`, `15m`, `2h` or `1h30m`; null when the text is not valid. */
export function parseEvery(text: string): number | null {
  const match = /^\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:m|min)?)?\s*$/i.exec(text);
  if (!match || (match[1] === undefined && match[2] === undefined)) return null;
  const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  return minutes >= 1 && minutes <= MAX_EVERY_MIN ? minutes : null;
}

/** The text of an interval: `15m`, `2h`, `1h30m`. */
export function everyText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h${m}m`;
}

/** The read level of a conversation: its own, else the default of its kind and the channel mode. */
export function levelOf(source: InboxSource, c: Conversation): ReadLevel {
  const own = source.conversations.find((x) => x.id === c.id)?.read;
  if (own) return own;
  if (c.kind !== "channel") return "tagged";
  return source.channels === "all" ? "tagged" : "off";
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack
      spacing={2}
      sx={{ p: 3, border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "aw.raised" }}
    >
      <Typography variant="overline" color="text.secondary" component="h2">
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "center", minHeight: 32 }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 120, flex: "none" }}>
        {label}
      </Typography>
      <Box sx={{ minWidth: 0, flex: 1 }}>{children}</Box>
    </Stack>
  );
}

/** The connection form: the server, the credential and the collecting device. */
function Connection({ ws, source }: { ws: string; source: InboxSource | undefined }) {
  const navigate = useNavigate();
  const credentials = useCredentials(ws).data ?? [];
  const computers = (useDevices(ws).data ?? []).filter(
    (d) => d.state === "valid" && d.role !== "mobile",
  );
  const status = useSourceStatus(ws, source?.source).data;
  const now = useNow(30_000);
  const [form, setForm] = useState({
    server_url: source?.server_url ?? "https://",
    credential: source?.credential ?? "",
    // null: not chosen yet, so the default below applies when the devices have loaded.
    collector: source ? (source.collector ?? "") : (null as string | null),
  });
  const collector = form.collector ?? computers.find((d) => d.this_device)?.slug ?? "";
  const save = useSourceSave(ws, SOURCE);
  const write = () =>
    save.mutate((input) => ({
      ...(input ?? { name: "Mattermost" }),
      server_url: form.server_url,
      credential: form.credential,
      collector: collector === "" ? null : collector,
    }));
  const changed =
    !source ||
    source.server_url !== form.server_url ||
    source.credential !== form.credential ||
    (source.collector ?? "") !== collector;
  const health = status?.health ?? null;
  return (
    <Panel title="Mattermost">
      <TextField
        size="small"
        label="Server"
        value={form.server_url}
        onChange={(e) => setForm({ ...form, server_url: e.target.value })}
        placeholder="https://chat.example.com"
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          select
          size="small"
          label="Token (credential)"
          value={form.credential}
          onChange={(e) => setForm({ ...form, credential: e.target.value })}
          sx={{ flex: 1 }}
          helperText="A personal access token of Mattermost, kept as an encrypted credential"
        >
          {credentials.map((c) => (
            <MenuItem key={c.name} value={c.name}>
              {c.name}
            </MenuItem>
          ))}
          <MenuItem value="" onClick={() => void navigate(`/w/${ws}/credentials`)}>
            Add a credential…
          </MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label="Collects on"
          value={collector}
          onChange={(e) => setForm({ ...form, collector: e.target.value })}
          sx={{ flex: 1 }}
          helperText="One computer at a time. The phone never reads Mattermost."
        >
          {computers.map((d) => (
            <MenuItem key={d.slug} value={d.slug}>
              {d.name}
            </MenuItem>
          ))}
          {/* The collecting device of the configuration, also when this device has no record of it. */}
          {collector !== "" && !computers.some((d) => d.slug === collector) && (
            <MenuItem value={collector}>{collector}</MenuItem>
          )}
        </TextField>
      </Stack>
      {source && (
        <>
          <Row label="Connection">
            <Typography variant="body2">
              {status?.user
                ? `Connected as @${status.user.username}`
                : ((status as { error?: string } | undefined)?.error ?? "Checking…")}
            </Typography>
          </Row>
          <Row label="Last read">
            <Typography variant="body2">
              {ago(health?.last_read_at ?? null, now)}
              {health && health.waiting > 0 ? ` · ${health.waiting} messages wait` : ""}
            </Typography>
          </Row>
          {health?.error && <Alert severity="error">{health.error}</Alert>}
        </>
      )}
      {save.isError && <Alert severity="error">{errorText(save.error)}</Alert>}
      <Box>
        <Button
          variant="contained"
          disabled={!changed || form.credential === "" || collector === "" || save.isPending}
          onClick={write}
        >
          {source ? "Save" : "Connect"}
        </Button>
      </Box>
    </Panel>
  );
}

function Triage({ ws, source }: { ws: string; source: InboxSource }) {
  const status = useSourceStatus(ws, source.source).data;
  const now = useNow(30_000);
  const [triage, setTriage] = useState(source.triage);
  const [every, setEvery] = useState(everyText(source.triage.every_min));
  const save = useSourceSave(ws, source.source);
  const write = (next: InboxSource["triage"]) =>
    save.mutate((input) => ({ ...input!, triage: { ...next } }));
  return (
    <Panel title="Triage agent">
      <Row label="Agent">
        <Typography variant="body2">claude@{source.collector ?? "—"}</Typography>
      </Row>
      <Row label="Model">
        <TextField
          select
          size="small"
          value={triage.model}
          onChange={(e) => setTriage({ ...triage, model: e.target.value })}
        >
          {MODELS.map((m) => (
            <MenuItem key={m} value={m}>
              {m}
            </MenuItem>
          ))}
        </TextField>
      </Row>
      <Row label="Every">
        <TextField
          size="small"
          value={every}
          onChange={(e) => {
            setEvery(e.target.value);
            const minutes = parseEvery(e.target.value);
            if (minutes !== null) setTriage({ ...triage, every_min: minutes });
          }}
          error={parseEvery(every) === null}
          helperText={
            parseEvery(every) === null ? "1m to 24h, for example 15m or 1h30m" : undefined
          }
          slotProps={{ htmlInput: { "aria-label": "Every" } }}
          sx={{ width: 120 }}
        />
      </Row>
      <Row label="Hours">
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <TextField
            size="small"
            type="time"
            value={triage.from ?? ""}
            onChange={(e) => setTriage({ ...triage, from: e.target.value || null })}
            slotProps={{ htmlInput: { "aria-label": "From" } }}
          />
          <Typography variant="body2" color="text.secondary">
            to
          </Typography>
          <TextField
            size="small"
            type="time"
            value={triage.to ?? ""}
            onChange={(e) => setTriage({ ...triage, to: e.target.value || null })}
            slotProps={{ htmlInput: { "aria-label": "To" } }}
          />
        </Stack>
      </Row>
      <Row label="Days">
        <ToggleButtonGroup
          size="small"
          value={triage.days}
          onChange={(_e, days: number[]) =>
            setTriage({ ...triage, days: [...days].sort((x, y) => x - y) })
          }
          aria-label="Days"
        >
          {DAYS.map((d, i) => (
            <ToggleButton key={d} value={i + 1}>
              {d}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Row>
      <Row label="Last batch">
        <Typography variant="body2">
          {ago(status?.health?.last_batch_at ?? null, now)} · {status?.health?.triage ?? "stopped"}
        </Typography>
      </Row>
      <TextField
        size="small"
        label="Instruction"
        multiline
        minRows={3}
        value={triage.instruction}
        onChange={(e) => setTriage({ ...triage, instruction: e.target.value })}
      />
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Button
          variant="contained"
          disabled={
            save.isPending ||
            parseEvery(every) === null ||
            JSON.stringify(triage) === JSON.stringify(source.triage)
          }
          onClick={() => write(triage)}
        >
          Save
        </Button>
        <Box sx={{ flex: 1 }} />
        <Typography variant="body2">Paused</Typography>
        <Switch
          checked={source.triage.paused}
          onChange={(e) => {
            const next = { ...triage, paused: e.target.checked };
            setTriage(next);
            write(next);
          }}
          slotProps={{ input: { "aria-label": "Pause the triage" } }}
        />
      </Stack>
      {save.isError && <Alert severity="error">{errorText(save.error)}</Alert>}
    </Panel>
  );
}

function Conversations({ ws, source }: { ws: string; source: InboxSource }) {
  const list = useSourceConversations(ws, source.source);
  const projects = useProjects(ws).data ?? [];
  const save = useSourceSave(ws, source.source);
  const [query, setQuery] = useState("");
  // The selected conversations of the page start come first. A change does not move a row.
  const [first] = useState(
    () => new Set(source.conversations.filter((c) => c.read !== "off").map((c) => c.id)),
  );
  const rows = useMemo(() => {
    const rank = (c: Conversation) => (first.has(c.id) ? 0 : c.kind === "channel" ? 1 : 2);
    const words = query.trim().toLowerCase();
    return (list.data ?? [])
      .filter((c) => words === "" || c.name.toLowerCase().includes(words))
      .sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name));
  }, [list.data, query, first]);
  const change = (c: Conversation, patch: { read?: ReadLevel; projects?: string[] }) =>
    save.mutate((current) => {
      // The newest configuration when the save runs: an earlier quick change is in it.
      const input = current!;
      const old = input.conversations?.find((x) => x.id === c.id);
      const others = (input.conversations ?? []).filter((x) => x.id !== c.id);
      others.push({
        id: c.id,
        name: c.name,
        kind: c.kind as "direct" | "group" | "channel",
        read: patch.read ?? old?.read ?? levelOf(source, c),
        projects: patch.projects ?? old?.projects ?? [],
      });
      return { ...input, conversations: others };
    });
  const projectName = (slug: string) => projects.find((p) => p.slug === slug)?.name ?? slug;
  return (
    <Stack spacing={1}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: { sm: "center" } }}
      >
        <Typography variant="h2" component="h2" sx={{ flex: 1 }}>
          Conversations
        </Typography>
        <TextField
          size="small"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{
            htmlInput: { "aria-label": "Search the conversations" },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={source.channels}
          onChange={(_e, value: "selected" | "all" | null) => {
            if (value) save.mutate((input) => ({ ...input!, channels: value }));
          }}
          aria-label="Channels"
        >
          <ToggleButton value="selected">Selected channels</ToggleButton>
          <ToggleButton value="all">All channels</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Tagged: direct messages, groups, mentions of you and replies in your threads.
      </Typography>
      {save.isError && <Alert severity="error">{errorText(save.error)}</Alert>}
      {list.isPending ? (
        <LoadingRows rows={4} label="Loading the conversations" />
      ) : list.isError ? (
        <Alert severity="error">{errorText(list.error)}</Alert>
      ) : (
        <TableContainer>
          <Table size="small" aria-label="Conversations">
            <TableHead>
              <TableRow>
                <TableCell>Conversation</TableCell>
                <TableCell>Kind</TableCell>
                <TableCell>Projects</TableCell>
                <TableCell>Read</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((c) => {
                const own = source.conversations.find((x) => x.id === c.id);
                return (
                  <TableRow key={c.id}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell sx={{ color: "text.secondary" }}>{c.kind}</TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        value={own?.projects ?? []}
                        onChange={(e) => {
                          const value = e.target.value as unknown as string[] | string;
                          change(c, {
                            projects: typeof value === "string" ? value.split(",") : value,
                          });
                        }}
                        sx={{ minWidth: 160, maxWidth: 280 }}
                        slotProps={{
                          htmlInput: { "aria-label": `Projects of ${c.name}` },
                          select: {
                            multiple: true,
                            displayEmpty: true,
                            renderValue: (value) => {
                              const slugs = value as string[];
                              return slugs.length === 0
                                ? "No project"
                                : slugs.map(projectName).join(", ");
                            },
                          },
                        }}
                      >
                        {projects.map((p) => (
                          <MenuItem key={p.slug} value={p.slug}>
                            {p.name}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                    <TableCell>
                      <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={levelOf(source, c)}
                        onChange={(_e, value: ReadLevel | null) => {
                          if (value) change(c, { read: value });
                        }}
                        aria-label={`Read level of ${c.name}`}
                      >
                        <ToggleButton value="all">All</ToggleButton>
                        <ToggleButton value="tagged">Tagged</ToggleButton>
                        <ToggleButton value="off">Off</ToggleButton>
                      </ToggleButtonGroup>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}

export function SourcesPage() {
  const { ws = "" } = useParams();
  const sources = useSources(ws);
  if (sources.isPending) return <LoadingRows rows={4} label="Loading the sources" />;
  if (sources.isError) {
    return (
      <Alert severity="error" sx={{ m: 4 }}>
        {errorText(sources.error)}
      </Alert>
    );
  }
  const source = sources.data.find((s) => s.source === SOURCE && !s.removed);
  return (
    <Box sx={{ overflowY: "auto", height: "100%" }}>
      <Stack spacing={3} sx={{ p: { xs: 4, sm: 6 }, maxWidth: 1100 }}>
        <Typography variant="h1" component="h1">
          Sources
        </Typography>
        <Box
          sx={{
            display: "grid",
            gap: 3,
            gridTemplateColumns: { xs: "1fr", md: source ? "1fr 1fr" : "1fr" },
            alignItems: "start",
          }}
        >
          {/* Each box has its own key: one key for 2 siblings showed a box twice after a save. */}
          <Connection
            key={`connection-${source?.configured.event ?? "new"}`}
            ws={ws}
            source={source}
          />
          {source && <Triage key={`triage-${source.configured.event}`} ws={ws} source={source} />}
        </Box>
        {source && <Conversations ws={ws} source={source} />}
      </Stack>
    </Box>
  );
}
