// The Files view (read-only folder tree of a task: task.yaml, log/<device>.jsonl, proposal/v<n>.md
// (approach/v<n>.md before openspec proposal-and-discussion), artifacts/…) and the Inbox card
// "Fix a file" for a document that fails its schema (docs/phase-1.md 6.6.4, docs/workflow.md 3).
import { mainVar, tint } from "@aw/ui";
import Description from "@mui/icons-material/DescriptionOutlined";
import ErrorOutline from "@mui/icons-material/ErrorOutlineOutlined";
import Folder from "@mui/icons-material/FolderOutlined";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import type { Issue } from "../../../shared/channels.ts";
import { call, errorText } from "../bridge.ts";
import { depthOf, sizeText } from "../kb-model.ts";
import { stageLabel, taskLabel } from "../model.ts";
import { useIssues, useRestoreDocument, useTaskFile, useTaskFiles, useTasks } from "../queries.ts";
import { CodeBlock, Empty, LoadingRows, MarkdownText } from "./common.tsx";
import { ListDetail } from "./ListDetail.tsx";

export function FileText({ ws, task, path }: { ws: string; task: string; path: string }) {
  const file = useTaskFile(ws, task, path);
  if (file.isPending) return <LoadingRows rows={6} label="Loading the file" />;
  if (file.isError) {
    return (
      <Alert severity="error" sx={{ m: 4 }}>
        {errorText(file.error)}
      </Alert>
    );
  }
  const { text, reason, size } = file.data;
  return (
    <Stack spacing={2} sx={{ p: 4 }}>
      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
        <Box component="span" sx={{ fontFamily: "var(--aw-font-mono)" }}>
          {path}
        </Box>{" "}
        · {sizeText(size)} · read-only
      </Typography>
      {text === null ? (
        <Alert severity="info">
          {reason === "too_large"
            ? "The file is larger than 1 MB. Open it from the workspace folder."
            : "The file is not text."}
        </Alert>
      ) : path.endsWith(".md") ? (
        <Card>
          <CardContent>
            <MarkdownText text={text} />
          </CardContent>
        </Card>
      ) : (
        <CodeBlock label="File text">{text}</CodeBlock>
      )}
    </Stack>
  );
}

export function TaskTree(props: {
  ws: string;
  task: string;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const files = useTaskFiles(props.ws, props.task);
  if (files.isPending) return <LoadingRows rows={5} height={28} label="Loading the folder" />;
  if (files.isError) {
    return (
      <Alert severity="error" sx={{ m: 4 }}>
        {errorText(files.error)}
      </Alert>
    );
  }
  return (
    <List dense aria-label="Task folder">
      {/* The folder path holds the task id: one line, the full path in the tooltip (F-28). */}
      <Tooltip title={`${files.data.root}/`} placement="bottom-start">
        <ListSubheader
          tabIndex={0}
          aria-label={`Folder ${files.data.root}/`}
          sx={{
            bgcolor: "transparent",
            fontFamily: "var(--aw-font-mono)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {files.data.root}/
        </ListSubheader>
      </Tooltip>
      {files.data.entries.map((entry) =>
        entry.kind === "dir" ? (
          <Stack
            key={entry.path}
            direction="row"
            spacing={1}
            sx={{
              pl: 4 + depthOf(entry) * 3,
              py: 0.5,
              alignItems: "center",
              color: "text.secondary",
            }}
          >
            <Folder fontSize="small" />
            <Typography variant="body2">{entry.name.split("/").at(-1)}/</Typography>
          </Stack>
        ) : (
          <ListItemButton
            key={entry.path}
            selected={props.selected === entry.path}
            onClick={() => props.onSelect(entry.path)}
            sx={{ pl: 4 + depthOf(entry) * 3 }}
          >
            <ListItemIcon sx={{ minWidth: 28 }}>
              <Description fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={entry.name.split("/").at(-1)}
              secondary={sizeText(entry.size)}
              slotProps={{ primary: { noWrap: true } }}
            />
          </ListItemButton>
        ),
      )}
      {files.data.truncated && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 4 }}>
          The folder has more than 5,000 entries; the list stops here.
        </Typography>
      )}
    </List>
  );
}

/** `/w/:ws/p/:project/files`: the tasks of the project, then the folder of the selected task. */
export function FilesPage() {
  const { ws = "", project = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const task = params.get("task");
  const file = params.get("file");
  const tasks = useTasks(ws, { project });
  const list = (
    <List aria-label="Tasks" sx={{ py: 2 }}>
      {tasks.isError && <Alert severity="error">{errorText(tasks.error)}</Alert>}
      {tasks.isPending && <LoadingRows rows={5} label="Loading the tasks" />}
      {(tasks.data ?? [])
        .filter((t) => !t.archived)
        .map((t) => (
          <ListItemButton
            key={t.id}
            selected={task === t.id}
            onClick={() => setParams({ task: t.id })}
          >
            <ListItemText
              primary={`${taskLabel(t)} · ${t.title ?? "No title"}`}
              secondary={stageLabel(t.stage)}
              slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
            />
          </ListItemButton>
        ))}
      {tasks.data?.length === 0 && <Empty title="No task in this project" />}
    </List>
  );
  const detail = !task ? (
    <Empty title="Select a task">The files of a task are read-only here.</Empty>
  ) : (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", lg: "280px minmax(0, 1fr)" },
        minHeight: "100%",
      }}
    >
      <Box sx={{ borderRight: { lg: 1 }, borderColor: { lg: "divider" } }}>
        <TaskTree
          ws={ws}
          task={task}
          selected={file}
          onSelect={(f) => setParams({ task, file: f })}
        />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        {file ? (
          <FileText key={file} ws={ws} task={task} path={file} />
        ) : (
          <Empty title="Select a file" />
        )}
      </Box>
    </Box>
  );
  return <ListDetail list={list} detail={detail} selected={!!task} onBack={() => setParams({})} />;
}

export function FixFileCard({ ws, issue }: { ws: string; issue: Issue }) {
  const restore = useRestoreDocument(ws);
  const open = useMutation({
    mutationFn: () => call("openWorkspaceFile", { ws, path: issue.path }),
  });
  return (
    <Card
      aria-label={`Fix a file ${issue.path}`}
      sx={{ borderColor: tint(mainVar("warning"), 40) }}
    >
      <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <ErrorOutline color="warning" fontSize="small" />
          <Typography variant="subtitle1">Fix a file</Typography>
        </Stack>
        <Typography
          variant="body2"
          sx={{ fontFamily: "var(--aw-font-mono)", overflowWrap: "anywhere" }}
        >
          {issue.path}
          {issue.line !== null ? `:${issue.line}` : ""}
        </Typography>
        <Typography variant="body2">{issue.message}</Typography>
        <Typography variant="caption" color="text.secondary">
          AW uses the last valid version of this file until it is fixed.
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button disabled={open.isPending} onClick={() => open.mutate()}>
            Open file
          </Button>
          <Button
            variant="contained"
            disabled={restore.isPending}
            onClick={() => restore.mutate(issue.path)}
          >
            Restore last valid version
          </Button>
        </Stack>
        {open.isError && <Alert severity="error">{errorText(open.error)}</Alert>}
        {restore.isError && <Alert severity="error">{errorText(restore.error)}</Alert>}
      </CardContent>
    </Card>
  );
}

/** The "Fix a file" cards of the Inbox: one per document that fails its schema. */
export function FixFileCards({ ws }: { ws: string }) {
  const issues = useIssues(ws);
  const bad = (issues.data ?? []).filter((i) => i.code === "bad_document");
  if (bad.length === 0) return null;
  return (
    <Stack spacing={2}>
      {bad.map((issue) => (
        <FixFileCard key={issue.path} ws={ws} issue={issue} />
      ))}
    </Stack>
  );
}
