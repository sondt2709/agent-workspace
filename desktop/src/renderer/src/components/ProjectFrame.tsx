// The frame of the project pages and of All tasks (openspec navigation-prototype, docs/design.md
// 8.2.2): a header with the name and the tabs, then the page of the route. The tabs are links, so
// the URLs of the project pages stay the same.
import { Box, Chip, Stack, Tab, Tabs, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Outlet, Link as RouterLink, useLocation, useParams } from "react-router";
import { PROJECT_TABS } from "../nav-model.ts";
import { useProjects } from "../queries.ts";
import { LetterTile } from "./WorkspaceMenu.tsx";

/** A page header: the title on one row, the tabs under it. */
export function FrameHeader(props: {
  title: string;
  tile?: string;
  meta?: ReactNode;
  tabs: { label: string; to: string; value: string }[];
  value: string | false;
  label: string;
}) {
  return (
    <Box
      sx={{ flex: "none", px: { xs: 4, sm: 6 }, pt: 3, borderBottom: 1, borderColor: "divider" }}
    >
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
        {props.tile && <LetterTile name={props.tile} />}
        <Typography variant="h2" noWrap sx={{ minWidth: 0 }}>
          {props.title}
        </Typography>
        {props.meta}
      </Stack>
      <Tabs
        value={props.value}
        aria-label={props.label}
        variant="scrollable"
        scrollButtons={false}
        sx={{ mt: 1, minHeight: 32 }}
      >
        {props.tabs.map((t) => (
          <Tab
            key={t.value}
            value={t.value}
            label={t.label}
            component={RouterLink}
            to={t.to}
            sx={{ minHeight: 32 }}
          />
        ))}
      </Tabs>
    </Box>
  );
}

/** The project pages: the header with Board, List, Knowledge, Files and Settings. */
export function ProjectFrame() {
  const { ws = "", project = "" } = useParams();
  const { pathname } = useLocation();
  const info = useProjects(ws).data?.find((p) => p.slug === project);
  const name = info?.name ?? project;
  const tab = pathname.split("/").at(-1) ?? "";
  const value = PROJECT_TABS.some((t) => t.tab === tab) ? tab : false;
  const devices = info?.devices ?? [];
  return (
    <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <FrameHeader
        title={name}
        tile={name}
        label={`${name} pages`}
        value={value}
        tabs={PROJECT_TABS.map((t) => ({
          label: t.label,
          value: t.tab,
          to: `/w/${ws}/p/${project}/${t.tab}`,
        }))}
        meta={
          <>
            {info?.archived && <Chip label="Archived" />}
            {devices.length > 0 && (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
                Runs on {devices.join(", then ")}
              </Typography>
            )}
          </>
        }
      />
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Outlet />
      </Box>
    </Box>
  );
}
