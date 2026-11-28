// Projects (openspec nav-tasks-needs-you, spec tasks-view "Projects page"): each project of the
// workspace with its repository, its devices and its counts. A row opens Tasks › All with the
// filter of the project; the buttons open its knowledge, files and settings.
import {
  Alert,
  Box,
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useNavigate, useParams } from "react-router";
import { errorText } from "../bridge.ts";
import { projectCounts } from "../nav-model.ts";
import { useProjects, useTasks } from "../queries.ts";
import { Empty, LoadingRows } from "./common.tsx";
import { useDialogs } from "./dialogs.tsx";

export function ProjectsPage() {
  const { ws = "" } = useParams();
  const navigate = useNavigate();
  const dialogs = useDialogs();
  const projects = useProjects(ws);
  const tasks = useTasks(ws).data ?? [];
  if (projects.isPending) return <LoadingRows rows={4} label="Loading the projects" />;
  if (projects.isError) {
    return (
      <Alert severity="error" sx={{ m: 4 }}>
        {errorText(projects.error)}
      </Alert>
    );
  }
  const add = (
    <Button variant="contained" onClick={() => dialogs.addProject(ws)}>
      Add a project
    </Button>
  );
  return (
    <Box sx={{ overflowY: "auto", height: "100%" }}>
      <Stack spacing={3} sx={{ p: { xs: 4, sm: 6 }, maxWidth: 1100 }}>
        <Stack direction="row" sx={{ alignItems: "center" }}>
          <Typography variant="h1" component="h1" sx={{ flex: 1 }}>
            Projects
          </Typography>
          {projects.data.length > 0 && add}
        </Stack>
        {projects.data.length === 0 ? (
          <Empty title="No projects yet" action={add}>
            Add a project with its checkout folder.
          </Empty>
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Projects">
              <TableHead>
                <TableRow>
                  <TableCell>Project</TableCell>
                  <TableCell>Repository</TableCell>
                  <TableCell>Devices</TableCell>
                  <TableCell>Tasks</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {projects.data.map((p) => {
                  const counts = projectCounts(tasks, p.slug);
                  const open = () =>
                    void navigate(`/w/${ws}/tasks?tab=all&projects=${encodeURIComponent(p.slug)}`);
                  return (
                    <TableRow key={p.slug} hover sx={{ cursor: "pointer" }} onClick={open}>
                      <TableCell>
                        <Typography variant="body1">
                          {p.name}
                          {p.archived ? " · archived" : ""}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontFamily: "var(--aw-font-mono)" }}
                        >
                          {p.slug}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ fontFamily: "var(--aw-font-mono)" }}>
                        {p.main_repo ?? "—"}
                      </TableCell>
                      <TableCell>{p.devices.length > 0 ? p.devices.join(", ") : "—"}</TableCell>
                      <TableCell>
                        <Box
                          component="span"
                          sx={{ color: counts.you > 0 ? "warning.main" : undefined }}
                        >
                          {counts.you} need you
                        </Box>
                        {` · ${counts.working} working`}
                      </TableCell>
                      <TableCell align="right" onClick={(event) => event.stopPropagation()}>
                        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                          {(["knowledge", "files", "settings"] as const).map((tab) => (
                            <Button
                              key={tab}
                              size="small"
                              onClick={() => void navigate(`/w/${ws}/p/${p.slug}/${tab}`)}
                            >
                              {tab[0]!.toUpperCase() + tab.slice(1)}
                            </Button>
                          ))}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Stack>
    </Box>
  );
}
