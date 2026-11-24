// The Knowledge screens (docs/phase-1.md 5; prd.md KB rows): the project and shared trees, the file
// view (Markdown), the history with Undo, the learned entries, the suggestions that wait for
// approval, and the digest card of the Inbox. Editing stays in the CLI and the file editor.
import AutoAwesome from "@mui/icons-material/AutoAwesomeOutlined";
import Gavel from "@mui/icons-material/GavelOutlined";
import MenuBook from "@mui/icons-material/MenuBookOutlined";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Link,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
  type Theme,
} from "@mui/material";
import { useState } from "react";
import { Link as RouterLink, useParams, useSearchParams } from "react-router";
import type {
  ChangeResult,
  KnowledgeChange,
  KnowledgeFile,
  Suggestion,
} from "../../../shared/channels.ts";
import { BridgeCallError, errorText } from "../bridge.ts";
import { useNow } from "../clock.ts";
import {
  bodyOf,
  digestLine,
  fileName,
  groupFiles,
  learnedLabel,
  reasonsText,
  type KbGroup,
} from "../kb-model.ts";
import { ago } from "../model.ts";
import {
  useKbAccept,
  useKbDigest,
  useKbFile,
  useKbHistory,
  useKbList,
  useKbReject,
  useKbSuggestions,
  useKbUndo,
} from "../queries.ts";
import { CodeBlock, Empty, LoadingRows, MarkdownText, PropertyRow } from "./common.tsx";
import { ListDetail } from "./ListDetail.tsx";

const GROUP_ICON: Record<KbGroup, React.ReactNode> = {
  Rules: <Gavel fontSize="small" />,
  Knowledge: <MenuBook fontSize="small" />,
  Learned: <AutoAwesome fontSize="small" />,
};

function undoText(result: ChangeResult): string {
  if (result.suggestion) return "The Undo waits for approval.";
  if (result.unchanged) return "The file already has that version.";
  return "Undone.";
}

/** A change line with its Undo button. */
export function ChangeRow({
  ws,
  change,
  canUndo,
}: {
  ws: string;
  change: KnowledgeChange;
  canUndo: boolean;
}) {
  const undo = useKbUndo(ws);
  const now = useNow(60_000);
  return (
    <Stack spacing={0.5} sx={{ py: 1.5, borderBottom: 1, borderColor: "divider" }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
          {change.label}
        </Typography>
        {canUndo && (
          <Button
            size="small"
            disabled={undo.isPending || undo.isSuccess}
            onClick={() => undo.mutate(change.id)}
          >
            Undo
          </Button>
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {change.path} · {change.kind} · {change.author} · on {change.dev} ·{" "}
        {ago(Date.parse(change.at), now)}
      </Typography>
      {undo.data && <Alert severity="info">{undoText(undo.data)}</Alert>}
      {undo.isError && <Alert severity="error">{errorText(undo.error)}</Alert>}
    </Stack>
  );
}

function FileView({ ws, path }: { ws: string; path: string }) {
  const file = useKbFile(ws, path);
  const history = useKbHistory(ws, path);
  const [tab, setTab] = useState<"content" | "history">("content");
  const now = useNow(60_000);
  if (file.isPending) return <LoadingRows rows={6} label="Loading the file" />;
  if (file.isError) {
    return (
      <Alert severity="error" sx={{ m: 4 }}>
        {errorText(file.error)}
      </Alert>
    );
  }
  const fm = file.data.front_matter;
  // The history route gives the changes oldest first; the view shows the newest first.
  const changes = [...(history.data ?? [])].reverse();
  const learned = learnedLabel(changes);
  const last = changes[0];
  return (
    <Stack spacing={4} sx={{ p: { xs: 4, sm: 6 } }}>
      <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Typography
          variant="body1"
          sx={{ fontFamily: "var(--aw-font-mono)", overflowWrap: "anywhere", flex: 1, minWidth: 0 }}
        >
          {path}
        </Typography>
        <Chip label={`Apply: ${fm.apply}`} />
        {fm.locked && <Chip label="Locked" />}
      </Stack>
      <Box>
        <PropertyRow label="Last change">
          {last
            ? `${last.author} · on ${last.dev} · ${ago(Date.parse(last.at), now)}`
            : history.isPending
              ? "…"
              : "No change recorded on this device"}
        </PropertyRow>
        <PropertyRow label="On devices">All your devices · folder knowledge</PropertyRow>
      </Box>
      {learned && (
        <Chip
          icon={<AutoAwesome />}
          label={learned}
          color="info"
          sx={{ alignSelf: "flex-start" }}
        />
      )}
      {fm.description && (
        <Typography variant="body2" color="text.secondary">
          {fm.description}
        </Typography>
      )}
      {file.data.front_matter_error && (
        <Alert severity="warning">
          The front matter is not used: {file.data.front_matter_error}
        </Alert>
      )}
      <Tabs value={tab} onChange={(_e, v: "content" | "history") => setTab(v)}>
        <Tab value="content" label="Content" />
        <Tab value="history" label={`History · ${history.data?.length ?? "…"}`} />
      </Tabs>
      {tab === "content" ? (
        <Card>
          <CardContent>
            <MarkdownText text={bodyOf(file.data.content)} />
          </CardContent>
        </Card>
      ) : (
        <Box>
          {history.isError && <Alert severity="error">{errorText(history.error)}</Alert>}
          {changes.map((entry, i) => (
            <Box key={entry.id}>
              <ChangeRow ws={ws} change={entry} canUndo={entry.base_available} />
              {i === 0 && (
                <Typography variant="caption" color="text.secondary">
                  Current version
                </Typography>
              )}
              {entry.diff && (
                <Box sx={{ my: 2 }}>
                  <CodeBlock maxHeight={240} label="Diff">
                    {entry.diff}
                  </CodeBlock>
                </Box>
              )}
            </Box>
          ))}
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2 }}>
            AW copies each version to the history store of this device (~/.aw/history). Undo writes
            the version before the change as a new change.
          </Typography>
        </Box>
      )}
    </Stack>
  );
}

export function SuggestionCard({ ws, suggestion }: { ws: string; suggestion: Suggestion }) {
  const accept = useKbAccept(ws);
  const reject = useKbReject(ws);
  const [comment, setComment] = useState("");
  const conflict = accept.error instanceof BridgeCallError && accept.error.code === "conflict";
  const body = comment.trim() ? { comment: comment.trim() } : {};
  const busy = accept.isPending || reject.isPending;
  return (
    <Card aria-label={`Suggestion for ${suggestion.path}`}>
      <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: "center", flexWrap: "wrap" }}
        >
          <Typography variant="subtitle1">Approve knowledge change</Typography>
          <Chip label={suggestion.kind} variant="outlined" />
          {suggestion.task_key && <Chip label={suggestion.task_key} variant="outlined" />}
        </Stack>
        <Typography
          variant="body2"
          sx={{ fontFamily: "var(--aw-font-mono)", overflowWrap: "anywhere" }}
        >
          {suggestion.path}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          By {suggestion.author} on {suggestion.dev}. {reasonsText(suggestion.reasons)}
        </Typography>
        {suggestion.content !== null ? (
          <CodeBlock maxHeight={240} label="Suggested content">
            {suggestion.content}
          </CodeBlock>
        ) : (
          <Typography variant="body2">The change removes the file.</Typography>
        )}
        <TextField
          label="Comment (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => accept.mutate({ suggestion: suggestion.id, ...body })}
          >
            Accept
          </Button>
          <Button
            disabled={busy}
            onClick={() => reject.mutate({ suggestion: suggestion.id, ...body })}
          >
            Reject
          </Button>
        </Stack>
        {conflict ? (
          <Alert
            severity="warning"
            action={
              <Button
                color="inherit"
                disabled={busy}
                onClick={() => accept.mutate({ suggestion: suggestion.id, force: true, ...body })}
              >
                Accept anyway
              </Button>
            }
          >
            The file changed after the suggestion.
          </Alert>
        ) : (
          accept.isError && <Alert severity="error">{errorText(accept.error)}</Alert>
        )}
        {reject.isError && <Alert severity="error">{errorText(reject.error)}</Alert>}
      </CardContent>
    </Card>
  );
}

/**
 * One tree of the files of a page, in the groups Rules, Knowledge and Learned (prototype). On the
 * project page a shared file has the tag "shared", so no group label shows twice.
 */
function FileTree(props: {
  files: KnowledgeFile[];
  tagShared: boolean;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const groups = groupFiles(props.files);
  if (groups.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ px: 4, py: 2 }}>
        No knowledge files yet.
      </Typography>
    );
  }
  return (
    <>
      {groups.map(({ group, files }) => (
        <Box key={group} component="li" sx={{ listStyle: "none" }}>
          <ListSubheader component="div" sx={{ bgcolor: "transparent", lineHeight: "32px" }}>
            {group} · {files.length}
          </ListSubheader>
          <List disablePadding>
            {files.map((file) => (
              <ListItemButton
                key={file.path}
                selected={props.selected === file.path}
                onClick={() => props.onSelect(file.path)}
                sx={{ pl: 4 }}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>{GROUP_ICON[group]}</ListItemIcon>
                <ListItemText
                  primary={file.title ?? fileName(file.path)}
                  secondary={file.title ? fileName(file.path) : null}
                  slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                />
                {props.tagShared && file.scope === "shared" && (
                  <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
                    shared
                  </Typography>
                )}
              </ListItemButton>
            ))}
          </List>
        </Box>
      ))}
    </>
  );
}

function SuggestionsPanel({ ws, suggestions }: { ws: string; suggestions: Suggestion[] }) {
  return (
    <Stack spacing={4} sx={{ p: { xs: 4, sm: 6 } }}>
      <Typography variant="subtitle1">Waits for approval · {suggestions.length}</Typography>
      {suggestions.length === 0 && <Empty title="Nothing waits for approval" />}
      {suggestions.map((s) => (
        <SuggestionCard key={s.id} ws={ws} suggestion={s} />
      ))}
    </Stack>
  );
}

/** `/w/:ws/p/:project/knowledge` (project and shared) and `/w/:ws/knowledge` (shared only). */
export function KnowledgePage({ scope }: { scope: "project" | "shared" }) {
  const { ws = "", project = null } = useParams();
  const [params, setParams] = useSearchParams();
  const wide = useMediaQuery((theme: Theme) => theme.breakpoints.up("md"));
  const selected = params.get("path");
  const view = params.get("view");
  const projectFiles = useKbList(ws, "project", project, scope === "project" && !!project);
  const sharedFiles = useKbList(ws, "shared", null);
  const suggestions = useKbSuggestions(ws);
  const digest = useKbDigest(ws);
  const pending = (suggestions.data ?? []).filter(
    (s) =>
      scope === "shared" ||
      !project ||
      s.path.startsWith(`projects/${project}/`) ||
      s.path.startsWith("shared/"),
  );
  const learnedToday = (digest.data?.learned ?? []).filter(
    (c) =>
      scope === "shared" ||
      !project ||
      c.path.startsWith(`projects/${project}/`) ||
      c.path.startsWith("shared/"),
  );
  const select = (next: Record<string, string> | null) => setParams(next ?? {}, { replace: false });
  const error = projectFiles.error ?? sharedFiles.error;
  const files = [
    ...(scope === "project" ? (projectFiles.data ?? []).filter((f) => f.scope === "project") : []),
    ...(sharedFiles.data ?? []).filter((f) => f.scope === "shared"),
  ];
  const loading = (scope === "project" && projectFiles.isPending) || sharedFiles.isPending;
  // From 840 px the first file opens when nothing is selected (prototype; docs/design.md 8.16).
  const first = groupFiles(files)[0]?.files[0]?.path ?? null;
  const shown = selected ?? (wide && view !== "suggestions" && pending.length === 0 ? first : null);
  const list = (
    <List aria-label="Knowledge files" sx={{ py: 2 }}>
      <ListItemButton
        selected={view === "suggestions"}
        onClick={() => select({ view: "suggestions" })}
      >
        <ListItemText primary={`Waits for approval · ${pending.length}`} />
      </ListItemButton>
      {error && (
        <Alert severity="error" sx={{ m: 2 }}>
          {errorText(error)}
        </Alert>
      )}
      {loading ? (
        <LoadingRows rows={4} height={28} label="Loading the files" />
      ) : (
        <FileTree
          files={files}
          tagShared={scope === "project"}
          selected={shown}
          onSelect={(path) => select({ path })}
        />
      )}
      <ListSubheader sx={{ bgcolor: "transparent", lineHeight: "32px", mt: 2 }}>
        Learned today · {learnedToday.length}
      </ListSubheader>
      <Box sx={{ px: 4 }}>
        {learnedToday.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nothing learned today.
          </Typography>
        ) : (
          learnedToday.map((c) => <ChangeRow key={c.id} ws={ws} change={c} canUndo />)
        )}
      </Box>
    </List>
  );
  let detail;
  if (shown) detail = <FileView key={shown} ws={ws} path={shown} />;
  else if (view === "suggestions" || pending.length > 0)
    detail = <SuggestionsPanel ws={ws} suggestions={pending} />;
  else if (!loading && files.length === 0)
    detail = (
      <Empty title="No knowledge files yet">
        Agents add learned files when a task ends. A person adds a file with aw kb write.
      </Empty>
    );
  else
    detail = <Empty title="Select a file">Rules, knowledge and learned files of this scope.</Empty>;
  return (
    <ListDetail
      list={list}
      detail={detail}
      selected={!!selected || view === "suggestions"}
      onBack={() => select(null)}
      listWidth={320}
    />
  );
}

/** The daily digest in the Inbox: what agents learned today, with Undo, and what waits. */
export function DigestCard({ ws }: { ws: string }) {
  const digest = useKbDigest(ws);
  const data = digest.data;
  if (!data) return null;
  const counts = {
    learned: data.learned.length,
    changes: data.changes.length,
    pending: data.pending.length,
  };
  if (counts.learned + counts.changes + counts.pending === 0) return null;
  return (
    <Card aria-label="Knowledge today">
      <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <AutoAwesome fontSize="small" color="info" />
          <Typography variant="subtitle1" sx={{ flex: 1 }}>
            Knowledge today
          </Typography>
          <Link component={RouterLink} to={`/w/${ws}/knowledge?view=suggestions`}>
            Open Knowledge
          </Link>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {digestLine(counts)}
        </Typography>
        {data.learned.map((c) => (
          <ChangeRow key={c.id} ws={ws} change={c} canUndo />
        ))}
      </CardContent>
    </Card>
  );
}
