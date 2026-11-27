// Sources (openspec inbox-mattermost, spec inbox-sources "Sources page"): the Mattermost connection
// and the collecting device, the triage session, and the conversations with their project and read
// level. Each change writes the whole configuration (`source.configured`).
import {
  Alert,
  Box,
  Button,
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
import { useState, type ReactNode } from "react";
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
          select
          size="small"
          value={triage.every_min}
          onChange={(e) => setTriage({ ...triage, every_min: Number(e.target.value) })}
        >
          {[5, 15, 30, 60].map((m) => (
            <MenuItem key={m} value={m}>
              {m} min · {triage.from ?? "00:00"}–{triage.to ?? "24:00"}
            </MenuItem>
          ))}
        </TextField>
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
          disabled={save.isPending || JSON.stringify(triage) === JSON.stringify(source.triage)}
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
  const change = (
    c: { id: string; name: string; kind: string },
    patch: { read?: "all" | "mentions" | "off"; project?: string | null },
  ) =>
    save.mutate((current) => {
      // The newest configuration when the save runs: an earlier quick change is in it.
      const input = current!;
      const old = input.conversations?.find((x) => x.id === c.id);
      const rows = (input.conversations ?? []).filter((x) => x.id !== c.id);
      rows.push({
        id: c.id,
        name: c.name,
        kind: c.kind as "direct" | "group" | "channel",
        read: patch.read ?? old?.read ?? input.default_read ?? source.default_read,
        project: patch.project !== undefined ? patch.project : (old?.project ?? null),
      });
      return { ...input, conversations: rows };
    });
  if (list.isPending) return <LoadingRows rows={4} label="Loading the conversations" />;
  if (list.isError) return <Alert severity="error">{errorText(list.error)}</Alert>;
  return (
    <Stack spacing={1}>
      <Typography variant="h2" component="h2">
        Conversations
      </Typography>
      <TableContainer>
        <Table size="small" aria-label="Conversations">
          <TableHead>
            <TableRow>
              <TableCell>Conversation</TableCell>
              <TableCell>Kind</TableCell>
              <TableCell>Project</TableCell>
              <TableCell>Read</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {list.data.map((c) => {
              const row = source.conversations.find((x) => x.id === c.id);
              const read = row?.read ?? source.default_read;
              return (
                <TableRow key={c.id}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell sx={{ color: "text.secondary" }}>{c.kind}</TableCell>
                  <TableCell>
                    <TextField
                      select
                      size="small"
                      value={row?.project ?? ""}
                      onChange={(e) => change(c, { project: e.target.value || null })}
                      slotProps={{
                        htmlInput: { "aria-label": `Project of ${c.name}` },
                        select: { displayEmpty: true },
                      }}
                    >
                      <MenuItem value="">No project</MenuItem>
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
                      value={read}
                      onChange={(_e, value: "all" | "mentions" | "off" | null) => {
                        if (value) change(c, { read: value });
                      }}
                      aria-label={`Read level of ${c.name}`}
                    >
                      <ToggleButton value="all">All</ToggleButton>
                      <ToggleButton value="mentions">For me</ToggleButton>
                      <ToggleButton value="off">Off</ToggleButton>
                    </ToggleButtonGroup>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary">
        For me: each message of a direct message or a group, a mention, and replies in your threads.
      </Typography>
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
          <Connection key={source?.configured.event ?? "new"} ws={ws} source={source} />
          {source && <Triage key={source.configured.event} ws={ws} source={source} />}
        </Box>
        {source && <Conversations ws={ws} source={source} />}
      </Stack>
    </Box>
  );
}
