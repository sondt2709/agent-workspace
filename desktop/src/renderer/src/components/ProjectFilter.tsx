// The project filter of Tasks and the Inbox (openspec nav-tasks-needs-you, spec tasks-view "Project
// filter"): a chip that opens a list with a search field and one check row per project. The
// selection is the search param `projects` (`none` is "No project", in the Inbox only).
import { parseProjectFilter, projectFilterLabel, projectFilterRows } from "@aw/client/inbox";
import Check from "@mui/icons-material/CheckOutlined";
import Close from "@mui/icons-material/CloseOutlined";
import Folder from "@mui/icons-material/FolderOpenOutlined";
import {
  Box,
  Chip,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
} from "@mui/material";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useProjects } from "../queries.ts";

/** The selected projects of the route. */
export function useProjectFilter(allowNone: boolean): {
  selected: string[];
  set: (next: string[]) => void;
} {
  const { ws = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const known = (useProjects(ws).data ?? []).map((p) => p.slug);
  const selected = parseProjectFilter(params.get("projects"), known, allowNone);
  const set = (next: string[]) => {
    const copy = new URLSearchParams(params);
    if (next.length === 0) copy.delete("projects");
    else copy.set("projects", next.join(","));
    // The selected row of a list may leave it: the list selects again.
    copy.delete("item");
    setParams(copy);
  };
  return { selected, set };
}

export function ProjectFilter({ allowNone }: { allowNone: boolean }) {
  const { ws = "" } = useParams();
  const projects = useProjects(ws).data ?? [];
  const { selected, set } = useProjectFilter(allowNone);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState("");
  const name = (slug: string) => projects.find((p) => p.slug === slug)?.name ?? slug;
  const rows = projectFilterRows(
    projects.map((p) => ({ slug: p.slug, name: p.name })),
    search,
    allowNone,
  );
  const toggle = (slug: string) =>
    set(selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug]);
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      <Chip
        icon={<Folder sx={{ fontSize: 16 }} />}
        label={projectFilterLabel(selected, name)}
        variant={selected.length > 0 ? "filled" : "outlined"}
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        size="small"
      />
      {selected.length > 0 && (
        <Tooltip title="Clear the project filter">
          <IconButton size="small" aria-label="Clear the project filter" onClick={() => set([])}>
            <Close sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => {
          setAnchor(null);
          setSearch("");
        }}
        slotProps={{ list: { "aria-label": "Projects", dense: true } }}
      >
        <Box sx={{ px: 2, pb: 1 }} onKeyDown={(event) => event.stopPropagation()}>
          <TextField
            size="small"
            autoFocus
            placeholder="Find a project"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            slotProps={{ htmlInput: { "aria-label": "Find a project" } }}
          />
        </Box>
        {rows.map((row) => (
          <MenuItem
            key={row.slug}
            role="menuitemcheckbox"
            aria-checked={selected.includes(row.slug)}
            onClick={() => toggle(row.slug)}
          >
            <ListItemIcon>
              {selected.includes(row.slug) ? <Check fontSize="small" /> : null}
            </ListItemIcon>
            <ListItemText>{row.name}</ListItemText>
          </MenuItem>
        ))}
        {rows.length === 0 && <MenuItem disabled>No match</MenuItem>}
      </Menu>
    </Stack>
  );
}
