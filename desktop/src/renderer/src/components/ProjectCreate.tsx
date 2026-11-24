// Add a project in one step (openspec create-flows, review 5.3): the checkout folder of this device
// from the native folder picker, the name from the folder, then `addProject` and the binding of
// this device. `FolderField` is also the folder field of Project settings and "Add a workspace".
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { ChosenFolder, FolderPurpose, Project } from "../../../shared/channels.ts";
import { call, errorText } from "../bridge.ts";
import { checkoutProblem, NOT_GIT, SLUG, slugFrom } from "../create-model.ts";
import { useWorkspaces } from "../queries.ts";
import { useAddProject, useBindings, useEditBindings } from "../setup-queries.ts";

/** A picked folder: `path` is set. */
export type PickedFolder = ChosenFolder & { path: string };

/**
 * A folder field with "Choose…" (the native picker of main). With `onChange` the person can also
 * type or paste a path; without it the field only shows the picked folder.
 */
export function FolderField(props: {
  label: string;
  purpose: FolderPurpose;
  value: string;
  onPick: (folder: PickedFolder) => void;
  onChange?: (value: string) => void;
  placeholder?: string;
  helperText?: ReactNode;
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const pick = useMutation({
    mutationFn: () =>
      call("chooseFolder", {
        purpose: props.purpose,
        ...(props.value.startsWith("/") ? { default_path: props.value } : {}),
      }),
    onSuccess: (folder) => {
      if (folder.path !== null) props.onPick({ ...folder, path: folder.path });
    },
  });
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-end" }}>
        <TextField
          label={props.label}
          value={props.value}
          onChange={props.onChange ? (e) => props.onChange?.(e.target.value) : undefined}
          placeholder={props.placeholder}
          error={props.error}
          disabled={props.disabled}
          fullWidth
          slotProps={{
            input: { readOnly: !props.onChange },
            htmlInput: { sx: { fontFamily: "var(--aw-font-mono)" }, spellCheck: false },
          }}
        />
        <Button
          variant="outlined"
          onClick={() => pick.mutate()}
          disabled={props.disabled || pick.isPending}
          autoFocus={props.autoFocus}
          sx={{ flex: "none" }}
        >
          Choose…
        </Button>
      </Stack>
      {props.helperText && (
        <Typography variant="caption" color={props.error ? "error" : "text.secondary"}>
          {props.helperText}
        </Typography>
      )}
      {pick.isError && <Alert severity="error">{errorText(pick.error)}</Alert>}
    </Stack>
  );
}

/**
 * The status line of a dialog footer (docs/design.md 8.8): left of the buttons, and on its own row
 * below 600 px, so it does not squeeze the buttons. Put it in `DialogActions` with `FOOTER_SX`.
 */
export function DialogStatus({ children }: { children: ReactNode }) {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ flex: { xs: "1 1 100%", sm: "1 1 0" }, px: 2, order: { xs: -1, sm: 0 } }}
    >
      {children}
    </Typography>
  );
}

/** The `DialogActions` style for a footer with a `DialogStatus`. */
export const FOOTER_SX = { flexWrap: "wrap", rowGap: 1 } as const;

/** The status line of the footer: what "Add project" does. */
function statusText(input: {
  created: Project | null;
  path: string;
  device: string | null;
  mayRun: boolean;
}): string {
  if (input.created) return `${input.created.name} is added. Save the folder of this device.`;
  if (!input.mayRun) return "This device runs no agent, so it needs no checkout folder.";
  if (!input.path) return "Choose the checkout folder, or add the project and set it later.";
  return `Agents on ${input.device ?? "this device"} work in git worktrees of this folder.`;
}

/**
 * The Add a project dialog. `onAdded` gets the project after the add and the binding; the caller
 * opens the next screen.
 */
export function AddProjectDialog(props: {
  ws: string;
  onClose: () => void;
  onAdded: (project: Project) => void;
}) {
  const workspace = (useWorkspaces().data ?? []).find((w) => w.id === props.ws);
  const bindings = useBindings(props.ws);
  const add = useAddProject(props.ws);
  const bind = useEditBindings(props.ws);
  const [path, setPath] = useState("");
  const [git, setGit] = useState(true);
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [created, setCreated] = useState<Project | null>(null);
  const mayRun = bindings.data?.may_run ?? true;
  const value = created ? created.slug : slugEdited ? slug : slugFrom(name);
  const validSlug = SLUG.test(value);
  const problem = path ? checkoutProblem(path, workspace?.path ?? null) : null;
  const pending = add.isPending || bind.isPending;
  const ready = created ? path.length > 0 && !problem : validSlug && !problem;
  const submit = async () => {
    try {
      const project =
        created ??
        (await add.mutateAsync({ slug: value, ...(name.trim() ? { name: name.trim() } : {}) }));
      setCreated(project);
      if (mayRun && path) {
        await bind.mutateAsync({ checkouts: [{ project: project.slug, path }] });
      }
      props.onClose();
      props.onAdded(project);
    } catch {
      // The mutation keeps the error; the dialog shows it.
    }
  };
  // The dialog stays open while a call runs, so the person sees its result. After the add, the
  // project exists: "Close" opens its next screen too, with no saved folder (cfc-4).
  const close = () => {
    if (pending) return;
    props.onClose();
    if (created) props.onAdded(created);
  };
  const title = `Add a project to ${workspace?.name ?? "the workspace"}`;
  return (
    <Dialog open onClose={close} fullWidth maxWidth="sm" aria-labelledby="project-add-title">
      <DialogTitle id="project-add-title">{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          {mayRun && (
            <FolderField
              label="Checkout folder"
              purpose="checkout"
              value={path}
              placeholder="~/dev/example-org/billing-api"
              autoFocus
              disabled={pending}
              error={problem !== null}
              helperText={
                problem ??
                `The git repository of the project on this device${bindings.data ? ` (${bindings.data.device})` : ""}.`
              }
              onPick={(folder) => {
                setPath(folder.path);
                setGit(folder.git);
                if (!nameEdited && !created && folder.name) setName(folder.name);
              }}
            />
          )}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Name"
              value={created ? created.name : name}
              disabled={created !== null}
              onChange={(e) => {
                setNameEdited(true);
                setName(e.target.value);
              }}
              fullWidth
            />
            <TextField
              label="Slug"
              value={value}
              disabled={created !== null}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value);
              }}
              error={value.length > 0 && !validSlug}
              helperText="Lowercase letters, digits and - between them. It cannot change later."
              fullWidth
              slotProps={{ htmlInput: { sx: { fontFamily: "var(--aw-font-mono)" } } }}
            />
          </Stack>
          {path && !git && !problem && <Alert severity="warning">{NOT_GIT}</Alert>}
          {add.isError && <Alert severity="error">{errorText(add.error)}</Alert>}
          {bind.isError && (
            <Alert severity="error">
              {created?.name ?? "The project"} is added, but the folder is not saved:{" "}
              {errorText(bind.error)}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={FOOTER_SX}>
        <DialogStatus>
          {statusText({ created, path, device: bindings.data?.device ?? null, mayRun })}
        </DialogStatus>
        <Button onClick={close} disabled={pending}>
          {created ? "Close" : "Cancel"}
        </Button>
        <Button variant="contained" disabled={!ready || pending} onClick={() => void submit()}>
          {created ? "Save the folder" : "Add project"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
