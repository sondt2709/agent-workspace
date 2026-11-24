// Pair a device (docs/phase-1.md 7) and the recovery phrase screen of the device with the master
// key (docs/prd.md journey 3). The pairing dialog shows the QR code and the code as text, waits for
// the new device, and approves with the check code that the new device shows. It does not show the
// check code of this device before the approval: the person must compare, not copy.
import ContentCopy from "@mui/icons-material/ContentCopyOutlined";
import FileDownload from "@mui/icons-material/FileDownloadOutlined";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PairingState } from "../../../shared/channels.ts";
import { call, errorText } from "../bridge.ts";
import { useNow } from "../clock.ts";
import { BAD_LOCATION, LOCATION_HELP } from "../create-model.ts";
import {
  normalizeCheckCode,
  PAIRING_TEXT,
  pairingEnded,
  phraseCheckPasses,
  pickPositions,
  svgDataUrl,
} from "../devices-model.ts";
import { keys } from "../queries.ts";
import { FolderField } from "./ProjectCreate.tsx";

export function PairDialog({ ws, onClose }: { ws: string; onClose: () => void }) {
  const client = useQueryClient();
  const start = useMutation({ mutationFn: () => call("startPairing", { ws }) });
  const started = useRef(false);
  const { mutate: startPairing } = start;
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startPairing();
  }, [startPairing]);
  const id = start.data?.id ?? null;
  const pairing = useQuery({
    queryKey: ["aw", "pairing", id ?? ""],
    queryFn: () => call("pairing", { id: id! }),
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data && pairingEnded(query.state.data.state) ? false : 1000,
    // The person often types the code on the other device while this window is hidden
    // (verify-journeys finding 11).
    refetchIntervalInBackground: true,
  });
  const view = pairing.data ?? start.data ?? null;
  const [code, setCode] = useState("");
  const approve = useMutation({
    mutationFn: (checkCode: string) => call("approvePairing", { id: id!, check_code: checkCode }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["aw", "pairing", id ?? ""] }),
  });
  const cancel = useMutation({ mutationFn: () => call("cancelPairing", { id: id! }) });
  const now = useNow(1000, !!view && view.state === "waiting");
  const ended = view ? pairingEnded(view.state) : false;
  useEffect(() => {
    if (view?.state === "done") {
      void client.invalidateQueries({ queryKey: keys.devices(ws) });
      void client.invalidateQueries({ queryKey: keys.sync() });
    }
  }, [view?.state, client, ws]);
  const close = () => {
    if (id && view && !ended && view.state !== "approved" && view.state !== "joining") {
      cancel.mutate(undefined, { onSettled: onClose });
    } else {
      onClose();
    }
  };
  const left = view ? Math.max(0, Math.ceil((Date.parse(view.expires_at) - now) / 1000)) : 0;
  const normalized = normalizeCheckCode(code);
  return (
    <Dialog open onClose={close} fullWidth maxWidth="sm" aria-labelledby="pair-title">
      <DialogTitle id="pair-title">Add a device</DialogTitle>
      <DialogContent>
        <Stack spacing={3}>
          {start.isPending && <Typography>Starting the pairing…</Typography>}
          {start.isError && <Alert severity="error">{errorText(start.error)}</Alert>}
          {view && (
            <Alert severity={view.state === "done" ? "success" : ended ? "error" : "info"}>
              {PAIRING_TEXT[view.state]}
              {view.error ? ` ${view.error}` : ""}
            </Alert>
          )}
          {view?.state === "waiting" && (
            <Stack spacing={2} sx={{ alignItems: "center" }}>
              {view.qr_svg && (
                <Box
                  component="img"
                  src={svgDataUrl(view.qr_svg)}
                  alt="Pairing QR code"
                  sx={{ width: 220, height: 220, bgcolor: "#fff", p: 1, borderRadius: 1 }}
                />
              )}
              {view.code && (
                <Stack direction="row" spacing={1} sx={{ width: "100%", alignItems: "flex-end" }}>
                  <TextField
                    label="Pairing code"
                    value={view.code}
                    slotProps={{
                      htmlInput: { readOnly: true, style: { fontFamily: "var(--aw-font-mono)" } },
                    }}
                    sx={{ flex: 1 }}
                  />
                  <Button onClick={() => void navigator.clipboard?.writeText(view.code ?? "")}>
                    Copy
                  </Button>
                </Stack>
              )}
              <Typography variant="body2" color="text.secondary">
                Phone: scan the QR code in the AW app. Remote computer: run <code>aw pair -</code>{" "}
                and paste the code. The code is used once and expires in {Math.floor(left / 60)}:
                {String(left % 60).padStart(2, "0")}.
              </Typography>
            </Stack>
          )}
          {view?.state === "check" && (
            <Stack spacing={2}>
              {view.new_device && (
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Typography variant="subtitle1">{view.new_device.name}</Typography>
                  <Chip label={view.new_device.slug} variant="outlined" />
                  <Chip label={view.new_device.role} variant="outlined" />
                </Stack>
              )}
              <TextField
                label="Check code on the new device"
                placeholder="123 456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                helperText="Type the 6 digits that the new device shows. Approve only when it is your device."
                slotProps={{ htmlInput: { inputMode: "numeric", autoComplete: "off" } }}
              />
              {approve.isError && <Alert severity="error">{errorText(approve.error)}</Alert>}
            </Stack>
          )}
          {view?.state === "done" && view.check_code && (
            <Typography variant="body2" color="text.secondary">
              Check code {view.check_code} matched.
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{ended ? "Close" : "Cancel"}</Button>
        {view?.state === "check" && (
          <Button
            variant="contained"
            disabled={!normalized || approve.isPending}
            onClick={() => normalized && approve.mutate(normalized)}
          >
            Approve device
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** The text of a pairing state on the joining device. */
const JOIN_TEXT: Record<PairingState, string> = {
  waiting: "Sending the request to the other computer.",
  check: "Compare the check code.",
  approved: "Approved. This device gets its record.",
  joining: "This device joins the workspace folders.",
  done: "Joined. The workspace syncs now.",
  failed: "The pairing failed.",
  expired: "The code expired. Show a new code on the other computer.",
  cancelled: "The pairing was cancelled.",
};

/**
 * "Join with a pairing code" of the first run (owner decision Q7, fix list 0-16): this device joins
 * the workspace of another computer, as `aw pair` does. It makes no master key. The person compares
 * the check code here with the code that the other computer asks for.
 */
export function JoinWorkspaceDialog(props: {
  onClose: () => void;
  onJoined: (workspace: string) => void;
}) {
  const client = useQueryClient();
  const [code, setCode] = useState("");
  const [location, setLocation] = useState("");
  const parent = location.trim();
  const badLocation = parent.length > 0 && !parent.startsWith("/");
  const join = useMutation({
    mutationFn: (text: string) =>
      call("joinPairing", { code: text, ...(parent ? { parent } : {}) }),
  });
  const id = join.data?.id ?? null;
  const pairing = useQuery({
    queryKey: ["aw", "pairing", id ?? ""],
    queryFn: () => call("pairing", { id: id! }),
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data && pairingEnded(query.state.data.state) ? false : 1000,
    refetchIntervalInBackground: true,
  });
  const cancel = useMutation({ mutationFn: () => call("cancelPairing", { id: id! }) });
  const view = pairing.data ?? join.data ?? null;
  const ended = view ? pairingEnded(view.state) : false;
  const { onJoined } = props;
  useEffect(() => {
    if (view?.state !== "done") return;
    void client.invalidateQueries({ queryKey: ["aw"] }).then(() => onJoined(view.workspace.id));
  }, [view?.state, view?.workspace.id, client, onJoined]);
  const close = () => {
    if (id && view && !ended && view.state !== "approved" && view.state !== "joining") {
      cancel.mutate(undefined, { onSettled: props.onClose });
    } else {
      props.onClose();
    }
  };
  const text = code.trim();
  return (
    <Dialog open onClose={close} fullWidth maxWidth="sm" aria-labelledby="join-title">
      <DialogTitle id="join-title">Join with a pairing code</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          {!view && (
            <>
              <Typography variant="body2" color="text.secondary">
                On the computer that has the workspace, select Devices &amp; sync, then &quot;Add
                device&quot;. Copy its pairing code and paste it here. This device then gets the
                workspace and its devices. It makes no master key.
              </Typography>
              <TextField
                label="Pairing code"
                placeholder="aw1:…"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                slotProps={{
                  htmlInput: {
                    autoComplete: "off",
                    spellCheck: false,
                    style: { fontFamily: "var(--aw-font-mono)" },
                  },
                }}
              />
              <FolderField
                label="Location"
                purpose="workspace"
                placeholder="~/AW"
                value={location}
                onChange={setLocation}
                onPick={(folder) => setLocation(folder.path)}
                error={badLocation}
                helperText={badLocation ? BAD_LOCATION : LOCATION_HELP}
              />
              {join.isError && <Alert severity="error">{errorText(join.error)}</Alert>}
            </>
          )}
          {view && (
            <Alert severity={view.state === "done" ? "success" : ended ? "error" : "info"}>
              {view.state === "waiting" && view.check_code
                ? `Waiting for the approval on ${view.device}.`
                : JOIN_TEXT[view.state]}
              {view.error ? ` ${view.error}` : ""}
            </Alert>
          )}
          {view?.folder && (
            <Stack spacing={0.5}>
              <Typography variant="body2" color="text.secondary">
                Folder:{" "}
                <Box
                  component="span"
                  sx={{ fontFamily: "var(--aw-font-mono)", wordBreak: "break-all" }}
                >
                  {view.folder}
                </Box>
              </Typography>
              {view.folder_note && (
                <Typography variant="caption" color="text.secondary">
                  {view.folder_note}
                </Typography>
              )}
            </Stack>
          )}
          {view && !ended && view.check_code && (
            <Stack spacing={1} sx={{ alignItems: "center" }}>
              <Typography variant="overline" color="text.secondary">
                Check code
              </Typography>
              <Typography variant="h1" component="p" sx={{ fontFamily: "var(--aw-font-mono)" }}>
                {view.check_code}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
                On {view.device}, type this check code in &quot;Add device&quot; and select
                &quot;Approve device&quot;. Approve only when the codes are the same.
              </Typography>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{ended ? "Close" : "Cancel"}</Button>
        {!view && (
          <Button
            variant="contained"
            disabled={text.length < 8 || badLocation || join.isPending}
            onClick={() => join.mutate(text)}
          >
            Join
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

// The count of open phrase screens: the reminder line hides while one is open (review F-37).
let openPhraseScreens = 0;
const phraseScreenListeners = new Set<() => void>();
function changeOpenPhraseScreens(delta: number) {
  openPhraseScreens += delta;
  for (const listener of phraseScreenListeners) listener();
}
function subscribePhraseScreens(listener: () => void) {
  phraseScreenListeners.add(listener);
  return () => phraseScreenListeners.delete(listener);
}

/** True while a recovery phrase screen is open. */
export function usePhraseScreenOpen(): boolean {
  return useSyncExternalStore(subscribePhraseScreens, () => openPhraseScreens > 0);
}

/**
 * "Copy" and "Save to a file…" of the phrase (openspec keys-backup). The main process reads the
 * phrase from awd for each action: these calls send no words.
 */
function PhraseBackupActions() {
  const copy = useMutation({ mutationFn: () => call("copyPhrase", {}) });
  const save = useMutation({ mutationFn: () => call("savePhrase", {}) });
  const saved = save.data?.saved ? save.data.path : null;
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Button
          variant="outlined"
          startIcon={<ContentCopy />}
          disabled={copy.isPending}
          onClick={() => {
            save.reset();
            copy.mutate();
          }}
        >
          Copy
        </Button>
        <Button
          variant="outlined"
          startIcon={<FileDownload />}
          disabled={save.isPending}
          onClick={() => {
            copy.reset();
            save.mutate();
          }}
        >
          Save to a file…
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        A copy on the clipboard or in a file is less safe than paper. Clipboard history apps and
        devices that share the clipboard can keep the words. AW clears the clipboard after 60
        seconds.
      </Typography>
      {copy.isSuccess && (
        <Alert severity="success">Copied. AW clears the clipboard in 60 seconds.</Alert>
      )}
      {saved && (
        <Alert severity="success">
          Saved to {saved}. Only your user account can read the file. Keep it offline, for example
          on a USB drive, and not in a synced folder.
        </Alert>
      )}
      {copy.isError && <Alert severity="error">{errorText(copy.error)}</Alert>}
      {save.isError && <Alert severity="error">{errorText(save.error)}</Alert>}
    </Stack>
  );
}

/**
 * The recovery phrase: the 24 words with Copy and Save, then 3 words at random positions confirm
 * the copy. `onShown` runs one time when the words show; `onDone` runs after a correct check.
 * `confirmed`: the person confirmed the words before, so the screen has "Close" and no check.
 */
export function RecoveryPhraseDialog(props: {
  user: string;
  onLater: () => void;
  onShown?: () => void;
  onDone?: () => void;
  confirmed?: boolean;
  random?: () => number;
}) {
  useEffect(() => {
    changeOpenPhraseScreens(1);
    return () => changeOpenPhraseScreens(-1);
  }, []);
  const client = useQueryClient();
  const phrase = useQuery({
    queryKey: ["aw", "phrase"],
    queryFn: () => call("phrase", {}),
    gcTime: 0,
  });
  const words = (phrase.data?.phrase ?? "").split(/\s+/).filter(Boolean);
  const [step, setStep] = useState<"show" | "check">("show");
  const [positions] = useState(() => pickPositions(24, props.random));
  const [answers, setAnswers] = useState(["", "", ""]);
  const [wrong, setWrong] = useState(false);
  const confirm = useMutation({
    mutationFn: () => call("confirmPhrase", { user: props.user }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.phraseConfirmed(props.user) });
      props.onDone?.();
    },
  });
  const shown = words.length > 0;
  const onShown = useRef(props.onShown);
  useEffect(() => {
    if (!shown || !onShown.current) return;
    const run = onShown.current;
    onShown.current = undefined;
    run();
  }, [shown]);
  return (
    <Dialog open fullWidth maxWidth="sm" aria-labelledby="phrase-title">
      <DialogTitle id="phrase-title">Your recovery phrase</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">
            These 24 words make your master key again. Write them on paper and keep the paper in a
            safe place. Anyone with the words can add devices to your workspaces.
            {!props.confirmed &&
              ' AW shows this screen by itself only one time. Until you confirm the words, Settings and the Inbox show "Show recovery phrase".'}
          </Typography>
          {phrase.isError && <Alert severity="error">{errorText(phrase.error)}</Alert>}
          {step === "show" && words.length > 0 && (
            <Box
              component="ol"
              aria-label="Recovery phrase"
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                gap: 1,
                pl: 6,
                fontFamily: "var(--aw-font-mono)",
              }}
            >
              {words.map((word, i) => (
                <li key={i}>{word}</li>
              ))}
            </Box>
          )}
          {step === "show" && words.length > 0 && <PhraseBackupActions />}
          {step === "check" && (
            <Stack spacing={2}>
              <Typography variant="body2">Type these words from your copy.</Typography>
              {positions.map((p, i) => (
                <TextField
                  key={p}
                  label={`Word ${p + 1}`}
                  value={answers[i]}
                  autoComplete="off"
                  onChange={(e) => {
                    setWrong(false);
                    setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)));
                  }}
                />
              ))}
              {wrong && (
                <Alert severity="error">
                  A word does not match. Check your copy of the phrase.
                </Alert>
              )}
              {confirm.isError && <Alert severity="error">{errorText(confirm.error)}</Alert>}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {props.confirmed ? (
          <Button variant="contained" onClick={props.onLater}>
            Close
          </Button>
        ) : (
          <>
            <Button onClick={props.onLater}>Later</Button>
            {step === "check" && <Button onClick={() => setStep("show")}>Show the words</Button>}
            {step === "show" ? (
              <Button
                variant="contained"
                disabled={words.length === 0}
                onClick={() => setStep("check")}
              >
                I wrote it down
              </Button>
            ) : (
              <Button
                variant="contained"
                disabled={confirm.isPending}
                onClick={() => {
                  if (phraseCheckPasses(words, positions, answers)) confirm.mutate();
                  else setWrong(true);
                }}
              >
                Confirm
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
