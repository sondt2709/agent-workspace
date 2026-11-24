// The command menu and the navigation shortcuts (openspec navigation-prototype, docs/design.md 8.9
// and 9): ⌘K opens a search of the actions, the screens, the projects and the tasks; ⌘1 to ⌘4 open
// Inbox, All tasks, Devices & sync and Settings. Ctrl takes the place of ⌘ on other systems. The
// keys are read in the renderer: the app menu keeps ⌘N and ⌘R.
import { Autocomplete, Box, Dialog, TextField, Typography, type PopperProps } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  commandOptions,
  filterCommands,
  isShortcut,
  screenPath,
  type CommandOption,
} from "../nav-model.ts";
import { isMac } from "../platform.ts";
import { useProjects, useTasks } from "../queries.ts";
import { useDialogs } from "./dialogs.tsx";

/** The list of the menu shows in the dialog, under the field, not in a floating popper. */
function InlinePopper(props: PopperProps) {
  const { children, className, role } = props;
  // An inline style: the Autocomplete styles make the popper `absolute` with `disablePortal`.
  return (
    <div className={className} role={role} style={{ position: "static", width: "100%" }}>
      {typeof children === "function" ? null : children}
    </div>
  );
}

function KeyHint({ children }: { children: string }) {
  return (
    <Box
      component="kbd"
      sx={{
        px: 1,
        minWidth: 16,
        height: 16,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 1,
        border: 1,
        borderColor: "aw.lineStrong",
        color: "text.secondary",
        typography: "caption",
        lineHeight: 1,
        fontFamily: "var(--aw-font-mono)",
      }}
    >
      {children}
    </Box>
  );
}

function CommandDialog(props: {
  ws: string | undefined;
  project: string | null;
  task: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const dialogs = useDialogs();
  const projects = useProjects(props.ws).data;
  const tasks = useTasks(props.ws).data;
  const options = useMemo(
    () => commandOptions({ ws: props.ws, projects: projects ?? [], tasks: tasks ?? [] }),
    [props.ws, projects, tasks],
  );
  const run = (option: CommandOption) => {
    props.onClose();
    if ("go" in option.run) {
      void navigate(option.run.go);
      return;
    }
    const action = option.run.action;
    if (action === "new-task") dialogs.newTask(props.project);
    else if (action === "new-session") dialogs.newSession(props.task);
    else if (action === "sync-now") dialogs.sync();
    else dialogs.addProject(props.ws);
  };
  return (
    <Dialog
      open
      onClose={props.onClose}
      maxWidth={false}
      sx={{ "& .MuiDialog-container": { alignItems: "flex-start" } }}
      slotProps={{
        paper: {
          "aria-label": "Command menu",
          // The window keys skip only this dialog (see CommandMenu). A spread: TypeScript checks
          // the names of an object literal, and a data attribute is not a Paper prop.
          ...{ "data-command-menu": "" },
          sx: { width: 640, maxWidth: "calc(100% - 32px)", mt: "15vh", p: 0 },
        },
      }}
    >
      <Autocomplete<CommandOption, false, false, false>
        open
        // The list stays open; Esc in the field closes the whole menu.
        onClose={(_e, reason) => {
          if (reason === "escape") props.onClose();
        }}
        disablePortal
        autoHighlight
        forcePopupIcon={false}
        options={options}
        filterOptions={(all, state) => filterCommands(all, state.inputValue)}
        groupBy={(o) => o.group}
        getOptionLabel={(o) => (o.key ? `${o.key} ${o.label}` : o.label)}
        // The label is not unique (2 projects can have one name): the row key is the id (npc-4).
        getOptionKey={(o) => o.id}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        onChange={(_e, option) => {
          if (option) run(option);
        }}
        noOptionsText="No command, screen or task matches."
        slots={{ popper: InlinePopper }}
        slotProps={{
          paper: { elevation: 0, sx: { bgcolor: "transparent", boxShadow: "none" } },
          listbox: { sx: { maxHeight: "50vh", py: 1 } },
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            autoFocus
            placeholder="Type a command, a task key or a title"
            slotProps={{
              ...params.slotProps,
              htmlInput: { ...params.slotProps.htmlInput, "aria-label": "Search commands" },
            }}
            sx={{ p: 3, pb: 1 }}
          />
        )}
        renderOption={(props, option) => {
          const { key, ...rest } = props;
          return (
            <Box
              component="li"
              key={key}
              {...rest}
              sx={{ minHeight: 36, gap: 2, display: "flex", alignItems: "center" }}
            >
              {option.key && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontFamily: "var(--aw-font-mono)", width: 56, flex: "none" }}
                >
                  {option.key}
                </Typography>
              )}
              <Typography variant="body1" noWrap sx={{ flex: 1, minWidth: 0 }}>
                {option.label}
              </Typography>
              {option.hint && (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {option.hint}
                </Typography>
              )}
              {option.shortcut && <KeyHint>{option.shortcut}</KeyHint>}
            </Box>
          );
        }}
      />
    </Dialog>
  );
}

/** Mounts the shortcuts of the window and the command menu. */
export function CommandMenu(props: {
  ws: string | undefined;
  project: string | null;
  task: string | null;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { ws } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcut(event, isMac())) return;
      const menu = event.key.toLowerCase() === "k";
      const path = menu ? null : screenPath(ws, event.key);
      if (!menu && !path) return;
      // Another dialog (New task, a confirmation, the recovery phrase) keeps the keys: a key never
      // changes the screen under it or opens the menu on top of it (fix list npc-2).
      if (document.querySelector('[role="dialog"]:not([data-command-menu])')) return;
      if (menu) {
        event.preventDefault();
        setOpen((now) => !now);
        return;
      }
      if (path) {
        event.preventDefault();
        setOpen(false);
        void navigate(path);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws, navigate]);
  if (!open) return null;
  return (
    <CommandDialog
      ws={ws}
      project={props.project}
      task={props.task}
      onClose={() => setOpen(false)}
    />
  );
}
