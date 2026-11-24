// The Credentials page (names only: a value goes to awd once and the app never reads it), the
// Settings page (New projects of openspec permissions-default, Appearance, Open at login,
// notifications, sync, setup check; openspec screens-align) and the recovery phrase gate of the
// app start.
import Key from "@mui/icons-material/KeyOutlined";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router";
import type { AppSettings, Appearance } from "../../../shared/channels.ts";
import { call, errorText } from "../bridge.ts";
import {
  keys,
  useAddCredential,
  useAppSettings,
  useCredentials,
  useIdentity,
  usePhraseConfirmed,
  useRemoveCredential,
  useWorkspaces,
} from "../queries.ts";
import { Empty, LoadingRows, PageHeader, PropertyRow, Section } from "./common.tsx";
import { CommunityCard } from "./CommunityCard.tsx";
import { NewProjectsCard } from "./NewProjectsCard.tsx";
import { RecoveryPhraseDialog, usePhraseScreenOpen } from "./Pairing.tsx";

const NAME = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;

function AddCredentialDialog({ ws, onClose }: { ws: string; onClose: () => void }) {
  const add = useAddCredential(ws);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const validName = NAME.test(name.trim());
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="credential-title">
      <DialogTitle id="credential-title">Add a credential</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Name"
            placeholder="stripe-test"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={name.length > 0 && !validName}
            helperText="Lowercase letters, digits, and - _ . between them."
          />
          <TextField
            label="Value"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            helperText="AW encrypts it for your computers. No screen shows it again."
          />
          {add.isError && <Alert severity="error">{errorText(add.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!validName || value.length === 0 || add.isPending}
          onClick={() =>
            add.mutate(
              { name: name.trim(), value },
              {
                onSettled: () => setValue(""),
                onSuccess: () => onClose(),
              },
            )
          }
        >
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function CredentialsPage() {
  const { ws = "" } = useParams();
  const credentials = useCredentials(ws);
  const remove = useRemoveCredential(ws);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  return (
    <Box sx={{ overflowY: "auto", height: "100%" }}>
      <Stack spacing={6} sx={{ p: { xs: 4, sm: 6 }, maxWidth: 960, mx: "auto" }}>
        <PageHeader
          title="Credentials"
          description="A task gets the credentials that it names at the session start. The values are encrypted in the secure folder, which only your computers sync."
          actions={
            <Button variant="contained" onClick={() => setAdding(true)}>
              Add
            </Button>
          }
        />
        {credentials.isError && <Alert severity="error">{errorText(credentials.error)}</Alert>}
        {credentials.isPending && <LoadingRows rows={3} label="Loading the credentials" />}
        {credentials.data?.length === 0 && (
          <Empty title="No credentials yet">
            <Button variant="outlined" onClick={() => setAdding(true)} sx={{ mt: 2 }}>
              Add a credential
            </Button>
          </Empty>
        )}
        {(credentials.data ?? []).length > 0 && (
          <List
            aria-label="Credentials"
            disablePadding
            sx={{ border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "aw.raised" }}
          >
            {(credentials.data ?? []).map((c, i) => (
              <ListItem
                key={c.name}
                divider={i < (credentials.data ?? []).length - 1}
                secondaryAction={
                  <Button variant="outlined" color="error" onClick={() => setRemoving(c.name)}>
                    Remove
                  </Button>
                }
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <Key fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={c.name}
                  secondary={
                    [
                      c.added_by ? `Added by ${c.added_by}` : null,
                      c.imported_on.length > 0 ? `Imported on ${c.imported_on.join(", ")}` : null,
                      c.file ? null : "No file on this device yet",
                    ]
                      .filter(Boolean)
                      .join(" · ") || null
                  }
                  slotProps={{ primary: { sx: { fontFamily: "var(--aw-font-mono)" } } }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Stack>
      {adding && <AddCredentialDialog ws={ws} onClose={() => setAdding(false)} />}
      {removing && (
        <Dialog open onClose={() => setRemoving(null)} aria-labelledby="remove-title">
          <DialogTitle id="remove-title">Remove {removing}?</DialogTitle>
          <DialogContent>
            <Typography variant="body2">
              New sessions do not get it. Running sessions keep the value that they have.
            </Typography>
            {remove.isError && <Alert severity="error">{errorText(remove.error)}</Alert>}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button
              color="error"
              variant="contained"
              disabled={remove.isPending}
              onClick={() => remove.mutate(removing, { onSuccess: () => setRemoving(null) })}
            >
              Remove
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}

export function loginText(settings: AppSettings): string {
  const login = settings.login;
  if (!login.supported) return "This system has no login item for the app.";
  if (login.status === "requires-approval") return "Needs approval in System Settings.";
  if (login.status === "not-found") return "The app must be signed and in Applications.";
  return login.open ? "The app opens at login and stays in the menu bar." : "Off.";
}

/** The text of the Notifications card. */
export function notificationText(settings: AppSettings): string {
  if (!settings.notifications) {
    return "This build cannot show notifications (the app is not signed). The Inbox and the menu bar show the gates.";
  }
  if (settings.notification_error) {
    return `macOS did not show the last notification (${settings.notification_error}). Turn on the notifications of Agent Workspace in System Settings > Notifications. An unsigned build cannot show them. The Inbox and the menu bar show the gates.`;
  }
  return "Gates, finished tasks and pauses that need you show as notifications. Closing the window keeps them on; the app stays in the menu bar.";
}

const APPEARANCE_TEXT: Record<Appearance, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export function SettingsPage() {
  const settings = useAppSettings();
  const client = useQueryClient();
  const set = useMutation({
    mutationFn: (open: boolean) => call("setOpenAtLogin", { open }),
    onSuccess: (data) => client.setQueryData(keys.appSettings(), data),
  });
  const appearance = useMutation({
    mutationFn: (value: Appearance) => call("setAppearance", { appearance: value }),
    onSuccess: (data) => client.setQueryData(keys.appSettings(), data),
  });
  const data = settings.data;
  // The Stack puts a divider after each child that is not empty, so the page leaves out the card
  // when it shows nothing (sa-4).
  const phrase = usePhraseState();
  const workspaces = useWorkspaces();
  return (
    <Box sx={{ overflowY: "auto", height: "100%" }}>
      <Stack spacing={6} sx={{ p: { xs: 4, sm: 6 }, maxWidth: 960, mx: "auto" }}>
        <PageHeader title="Settings" />
        {settings.isError && <Alert severity="error">{errorText(settings.error)}</Alert>}
        <Stack spacing={6} divider={<Divider flexItem />}>
          {phrase.user && phrase.state && <RecoveryPhraseCard />}
          {(workspaces.data?.length ?? 0) > 0 && <NewProjectsCard />}
          {data && (
            <Section
              title="Appearance"
              id="settings-appearance"
              description="System follows the light or dark setting of macOS."
            >
              <RadioGroup
                row
                aria-labelledby="settings-appearance"
                value={appearance.isPending ? appearance.variables : data.appearance}
                onChange={(e) => appearance.mutate(e.target.value as Appearance)}
              >
                {(["system", "light", "dark"] as const).map((value) => (
                  <FormControlLabel
                    key={value}
                    value={value}
                    control={<Radio />}
                    label={APPEARANCE_TEXT[value]}
                    disabled={appearance.isPending}
                  />
                ))}
              </RadioGroup>
              {appearance.isError && <Alert severity="error">{errorText(appearance.error)}</Alert>}
            </Section>
          )}
          {data && (
            <Section title="Startup" description={loginText(data)}>
              <FormControlLabel
                control={
                  <Switch
                    checked={data.login.open}
                    disabled={!data.login.supported || set.isPending}
                    onChange={(e) => set.mutate(e.target.checked)}
                  />
                }
                label="Open at login"
              />
              {set.isError && <Alert severity="error">{errorText(set.error)}</Alert>}
            </Section>
          )}
          {data && <Section title="Notifications" description={notificationText(data)} />}
          <CommunityCard />
          <WorkspaceFolders />
          <Section
            title="Setup check"
            description="Check the service, the session host, the Claude sign-in, the disk, the clock, the sync engine and the other devices. Each failed check shows its fix."
          >
            <Box>
              <Button component={RouterLink} to="/settings/setup" variant="outlined">
                Open setup check
              </Button>
            </Box>
          </Section>
        </Stack>
      </Stack>
    </Box>
  );
}

/**
 * "Workspaces on this computer" (openspec workspace-folder): the folder of each workspace on this
 * device. The folder stays on this computer: awd does not sync it.
 */
function WorkspaceFolders() {
  const workspaces = useWorkspaces();
  const list = workspaces.data ?? [];
  return (
    <Section
      title="Workspaces on this computer"
      description="Each workspace has its own folder on this computer. Other devices keep their own folders."
    >
      {workspaces.isError && <Alert severity="error">{errorText(workspaces.error)}</Alert>}
      {workspaces.data && list.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No workspace on this computer yet.
        </Typography>
      )}
      {list.length > 0 && (
        <Box>
          {list.map((w) => (
            <PropertyRow key={w.id} label={w.name ?? w.id}>
              <Box
                component="span"
                sx={{ fontFamily: "var(--aw-font-mono)", wordBreak: "break-all" }}
              >
                {w.path}
              </Box>
            </PropertyRow>
          ))}
        </Box>
      )}
    </Section>
  );
}

/** The phrase state of the user of this device with the master key, or null. */
function usePhraseState() {
  const identity = useIdentity();
  const user = identity.data?.has_master_key ? identity.data.user : null;
  const state = usePhraseConfirmed(user);
  return { user, state: user ? (state.data ?? null) : null };
}

/**
 * Shows the recovery phrase screen by itself one time on the device with the master key (owner
 * decision Q10, fix list 0-34). The screen stays open after the app records the first show.
 */
export function RecoveryPhraseGate() {
  const { user, state } = usePhraseState();
  const client = useQueryClient();
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    if (open !== null || !state) return;
    setOpen(!state.confirmed && !state.shown);
  }, [open, state]);
  if (!user || open !== true) return null;
  return (
    <RecoveryPhraseDialog
      user={user}
      onShown={() => {
        void call("phraseShown", { user }).then(() =>
          client.invalidateQueries({ queryKey: keys.phraseConfirmed(user) }),
        );
      }}
      onLater={() => setOpen(false)}
      onDone={() => setOpen(false)}
    />
  );
}

const REMINDER_TEXT =
  "Your recovery phrase is not confirmed. Write down the 24 words: without them, you cannot make your master key again.";

/**
 * The "Recovery phrase" card of Settings on the device with the master key: the reminder before the
 * confirmation, and "Show recovery phrase" also after it, to copy or save the words again
 * (openspec keys-backup).
 */
export function RecoveryPhraseCard() {
  const { user, state } = usePhraseState();
  const client = useQueryClient();
  const screenOpen = usePhraseScreenOpen();
  const [open, setOpen] = useState(false);
  if (!user || !state) return null;
  return (
    <Section
      title="Recovery phrase"
      description={
        state.confirmed
          ? "You confirmed your 24 words. Show them again to copy them or to save them to a file."
          : undefined
      }
    >
      {/* The line hides while a phrase screen is open, so that it does not repeat the screen. */}
      {!state.confirmed && !screenOpen && <Alert severity="warning">{REMINDER_TEXT}</Alert>}
      <Box>
        <Button variant="outlined" onClick={() => setOpen(true)}>
          Show recovery phrase
        </Button>
      </Box>
      {open && (
        <RecoveryPhraseDialog
          user={user}
          confirmed={state.confirmed}
          // A first show from Settings counts too, so the gate does not show the words again.
          onShown={
            state.shown
              ? undefined
              : () => {
                  void call("phraseShown", { user }).then(() =>
                    client.invalidateQueries({ queryKey: keys.phraseConfirmed(user) }),
                  );
                }
          }
          onLater={() => setOpen(false)}
          onDone={() => setOpen(false)}
        />
      )}
    </Section>
  );
}

/** The reminder line of the Inbox while the phrase is not confirmed (fix list 0-34). */
export function PhraseReminder() {
  const { user, state } = usePhraseState();
  const screenOpen = usePhraseScreenOpen();
  const [open, setOpen] = useState(false);
  if (!user || !state || state.confirmed || !state.shown) return null;
  return (
    <>
      {/* The line hides while a phrase screen is open, so that it does not repeat the screen. */}
      {!screenOpen && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={() => setOpen(true)}>
              Show recovery phrase
            </Button>
          }
        >
          {REMINDER_TEXT}
        </Alert>
      )}
      {open && (
        <RecoveryPhraseDialog
          user={user}
          onLater={() => setOpen(false)}
          onDone={() => setOpen(false)}
        />
      )}
    </>
  );
}
