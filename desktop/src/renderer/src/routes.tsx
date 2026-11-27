// The routes (docs/tech-stack.md 2.4 `react-router`): the route holds the selection and the view.
import { Alert, Box } from "@mui/material";
import { createHashRouter, useRouteError, type RouteObject } from "react-router";
import { AppShell, Home } from "./components/AppShell.tsx";
import { DevicesPage } from "./components/Devices.tsx";
import { FilesPage } from "./components/Files.tsx";
import { Inbox } from "./components/Inbox.tsx";
import { KnowledgePage } from "./components/Knowledge.tsx";
import { ProjectFrame } from "./components/ProjectFrame.tsx";
import { ProjectsPage } from "./components/Projects.tsx";
import { ProjectSettingsPage } from "./components/ProjectSettings.tsx";
import { CredentialsPage, SettingsPage } from "./components/Settings.tsx";
import { SetupCheckPage } from "./components/SetupCheck.tsx";
import { SourcesPage } from "./components/Sources.tsx";
import { TasksPage } from "./components/Tasks.tsx";
import { ProjectTasks, TaskPage } from "./components/TaskViews.tsx";
import { isMac, TITLE_ROW } from "./platform.ts";

function RouteError() {
  const error = useRouteError();
  return (
    <Alert severity="error" sx={{ m: 4 }}>
      {error instanceof Error ? error.message : "This page does not exist."}
    </Alert>
  );
}

/**
 * The error screen of the root route: it replaces the whole shell. On macOS it keeps the drag row
 * of the title area, so the window moves and the error is below the traffic lights.
 */
export function RootError() {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", color: "text.primary" }}>
      {isMac() && <Box className="aw-drag" sx={{ height: TITLE_ROW }} />}
      <RouteError />
    </Box>
  );
}

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RootError />,
    children: [
      { index: true, element: <Home /> },
      { path: "w/:ws/inbox", element: <Inbox /> },
      {
        // The project frame: the header with the tabs (openspec navigation-prototype).
        path: "w/:ws/p/:project",
        element: <ProjectFrame />,
        children: [
          // A project URL with no tab, the Board or the List: Tasks with the filter of the project
          // (openspec nav-tasks-needs-you).
          { index: true, element: <ProjectTasks view="board" /> },
          { path: "board", element: <ProjectTasks view="board" /> },
          { path: "list", element: <ProjectTasks view="list" /> },
          { path: "knowledge", element: <KnowledgePage scope="project" /> },
          { path: "files", element: <FilesPage /> },
          { path: "settings", element: <ProjectSettingsPage /> },
        ],
      },
      { path: "w/:ws/tasks", element: <TasksPage /> },
      { path: "w/:ws/projects", element: <ProjectsPage /> },
      { path: "w/:ws/sources", element: <SourcesPage /> },
      { path: "w/:ws/knowledge", element: <KnowledgePage scope="shared" /> },
      { path: "w/:ws/devices", element: <DevicesPage /> },
      { path: "w/:ws/credentials", element: <CredentialsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "settings/setup", element: <SetupCheckPage /> },
      { path: "w/:ws/tasks/:task", element: <TaskPage /> },
      { path: "*", element: <RouteError /> },
    ],
  },
];

export function createAppRouter() {
  return createHashRouter(routes);
}
