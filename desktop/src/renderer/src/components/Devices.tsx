// The Devices & sync page (docs/phase-1.md 6.4, 6.5, 6.8; openspec screens-align): a card for each
// device with its role, presence, sync state per folder and route, agent and sessions, session
// hosts and test slots; the sync engine and the folders; "Sync", "Add device" and "Revoke".
import Computer from "@mui/icons-material/ComputerOutlined";
import PhoneAndroid from "@mui/icons-material/PhoneAndroidOutlined";
import Sync from "@mui/icons-material/SyncOutlined";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { Link as RouterLink, useParams } from "react-router";
import type {
  DeviceEntryView,
  DevicePresenceView,
  SyncPeerStatus,
} from "../../../shared/channels.ts";
import { errorText } from "../bridge.ts";
import { useNow } from "../clock.ts";
import {
  agentLines,
  heartbeatText,
  hostSummary,
  roleText,
  sessionsOn,
  testSlotsText,
  type HostSummary,
} from "../devices-model.ts";
import {
  useDevices,
  usePresence,
  useProjects,
  useQueueAgents,
  useRevokeDevice,
  useSessionHosts,
  useSyncStatus,
  useTasks,
  useWorkspaces,
} from "../queries.ts";
import { useBindings } from "../setup-queries.ts";
import { Empty, LoadingRows, PageHeader, PropertyRow, Section } from "./common.tsx";
import { useDialogs } from "./dialogs.tsx";

const ROUTE_TEXT: Record<string, string> = {
  lan: "LAN",
  tailscale: "Tailscale",
  relay: "Community relay",
  internet: "Internet",
  storage: "Storage",
};

const FOLDER_TEXT: Record<string, string> = {
  tasks: "Tasks",
  knowledge: "Knowledge",
  secure: "Secure",
};

function DeviceCard(props: {
  device: DeviceEntryView;
  presence: DevicePresenceView | undefined;
  peer: SyncPeerStatus | undefined;
  agents: { agent: string; sessions: string }[];
  hosts: HostSummary | null;
  /** The test slots of this device; null for another device (only its own bindings are read). */
  slots: string | null;
  /** The workspace folder on this device; null for another device (awd does not sync it). */
  folder: string | null;
  now: number;
  onRevoke: () => void;
}) {
  const { device, peer } = props;
  const Icon = device.role === "mobile" ? PhoneAndroid : Computer;
  const valid = device.state === "valid";
  const other = !device.this_device && valid;
  const online = device.this_device || props.presence?.online === true;
  return (
    <Card aria-label={`Device ${device.name}`}>
      <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Stack direction="row" spacing={3} sx={{ alignItems: "center" }}>
          <Box sx={{ position: "relative", display: "flex", color: "text.secondary" }}>
            <Icon />
            <Box
              aria-hidden
              sx={{
                position: "absolute",
                right: -2,
                bottom: -2,
                width: 8,
                height: 8,
                borderRadius: "50%",
                border: 1,
                borderColor: "aw.raised",
                bgcolor: online ? "success.main" : "aw.wait",
              }}
            />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap>
              {device.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {roleText(device.role, device.this_device)} ·{" "}
              <Box component="span" sx={{ fontFamily: "var(--aw-font-mono)" }}>
                {device.slug}
              </Box>
            </Typography>
          </Box>
          {other && (
            <Button variant="outlined" color="error" onClick={props.onRevoke}>
              Revoke
            </Button>
          )}
        </Stack>
        {!valid && (
          <Box>
            <Chip label={device.state === "revoked" ? "Revoked" : "Bad signature"} color="error" />
          </Box>
        )}
        <Box>
          <PropertyRow label="Presence">
            {heartbeatText(props.presence, props.now, device.role)}
          </PropertyRow>
          {props.folder !== null && (
            <PropertyRow label="Workspace folder">
              <Box
                component="span"
                sx={{ fontFamily: "var(--aw-font-mono)", wordBreak: "break-all" }}
              >
                {props.folder}
              </Box>
            </PropertyRow>
          )}
          {other && (
            <>
              <PropertyRow label="Sync">
                {peer ? peer.text : "Not in the sync engine yet"}
              </PropertyRow>
              <PropertyRow label="Route">
                {peer?.route ? (ROUTE_TEXT[peer.route] ?? peer.route) : "None"}
              </PropertyRow>
              {peer?.folders && peer.folders.length > 0 && (
                <PropertyRow label="Folders">
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                    {peer.folders.map((f) => (
                      <Chip
                        key={f.folder}
                        color={f.inSync ? "success" : "warning"}
                        label={`${FOLDER_TEXT[f.kind] ?? f.kind} · ${
                          f.inSync ? "synced" : `${f.needItems} not synced`
                        }`}
                      />
                    ))}
                  </Stack>
                </PropertyRow>
              )}
            </>
          )}
          {device.role === "mobile" ? (
            <PropertyRow label="Agents">None. A phone is a remote control.</PropertyRow>
          ) : (
            <>
              {props.agents.length === 0 ? (
                <PropertyRow label="Agent">None yet</PropertyRow>
              ) : (
                props.agents.map((a) => (
                  <Box key={a.agent}>
                    <PropertyRow label="Agent">
                      <Box component="span" sx={{ fontFamily: "var(--aw-font-mono)" }}>
                        {a.agent}
                      </Box>
                    </PropertyRow>
                    <PropertyRow label="Sessions">{a.sessions}</PropertyRow>
                  </Box>
                ))
              )}
              {props.slots !== null && <PropertyRow label="Test slots">{props.slots}</PropertyRow>}
              {props.hosts && (
                <>
                  <PropertyRow label="Session hosts">{props.hosts.hosts.join(" · ")}</PropertyRow>
                  <PropertyRow label="Use Orca">{props.hosts.useOrca}</PropertyRow>
                  {props.hosts.checkouts.length > 0 && (
                    <PropertyRow label="Projects">
                      <Stack spacing={0.5}>
                        {props.hosts.checkouts.map((c) => (
                          <span key={c.project}>
                            {c.project} · {c.host}
                          </span>
                        ))}
                      </Stack>
                    </PropertyRow>
                  )}
                </>
              )}
            </>
          )}
        </Box>
        {device.this_device && device.role !== "mobile" && (
          <Box>
            <Button component={RouterLink} to="/settings/setup" variant="outlined">
              Open setup check
            </Button>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

const FOLDER_ROWS: { folder: string; devices: string; content: string }[] = [
  { folder: "tasks", devices: "All devices", content: "Workspace files and one folder per task" },
  { folder: "knowledge", devices: "All devices", content: "Rules, knowledge and learned files" },
  {
    folder: "secure",
    devices: "Computers only",
    content: "Test server settings and encrypted credentials",
  },
];

export function RevokeDialog(props: { ws: string; device: DeviceEntryView; onClose: () => void }) {
  const tasks = useTasks(props.ws);
  const revoke = useRevokeDevice(props.ws);
  const stops = sessionsOn(tasks.data ?? [], props.device.slug);
  const result = revoke.data;
  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="sm" aria-labelledby="revoke-title">
      <DialogTitle id="revoke-title">Revoke {props.device.name}?</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {!result && (
            <>
              <Typography variant="body2">
                {props.device.slug} stops syncing with your devices, and its later changes do not
                count. It keeps its copy of the files. A revoke is final: this device name and key
                never pair again.
              </Typography>
              {stops.length > 0 ? (
                <Alert severity="warning">
                  These sessions stop: {stops.join(", ")}. Their tasks pause with &quot;device
                  revoked&quot;, and you can assign them to another device.
                </Alert>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No session runs on {props.device.slug}.
                </Typography>
              )}
              <Typography variant="body2" color="text.secondary">
                AW makes a new credential key and encrypts the credentials again.
              </Typography>
            </>
          )}
          {result && (
            <Alert
              severity={
                result.closed.length > 0 || result.delivered === false ? "warning" : "success"
              }
            >
              {props.device.slug} is revoked. {result.credentials}{" "}
              {result.credentials === 1 ? "credential uses" : "credentials use"} the new key.
              {result.closed.length > 0 &&
                ` Add these credentials again: ${result.closed.join(", ")}.`}
              {result.delivered === false &&
                ` ${props.device.slug} did not get the revoke, so its agent sessions continue. Stop them on that device, or turn it off.`}
            </Alert>
          )}
          {revoke.isError && <Alert severity="error">{errorText(revoke.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>{result ? "Close" : "Cancel"}</Button>
        {!result && (
          <Button
            color="error"
            variant="contained"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate(props.device.slug)}
          >
            Revoke device
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

const ENGINE_TEXT: Record<string, string> = {
  running: "Running",
  starting: "Starting",
  restarting: "Restarting",
  stopped: "Stopped",
  failed: "Failed",
  not_installed: "Not installed",
  not_configured: "Not set up",
};

export function DevicesPage() {
  const { ws = "" } = useParams();
  const devices = useDevices(ws);
  const presence = usePresence(ws);
  const sync = useSyncStatus(5000);
  const queues = useQueueAgents(ws);
  const projects = useProjects(ws);
  const tasks = useTasks(ws);
  const hosts = useSessionHosts(ws);
  const bindings = useBindings(ws);
  const workspaces = useWorkspaces();
  const folder = workspaces.data?.find((w) => w.id === ws)?.path ?? null;
  const dialogs = useDialogs();
  const now = useNow(5000);
  const [revoking, setRevoking] = useState<DeviceEntryView | null>(null);
  const peers = new Map((sync.data?.peers ?? []).map((p) => [p.device, p]));
  const seen = new Map((presence.data?.devices ?? []).map((p) => [p.device, p]));
  const engine = sync.data?.engine;
  // This device first, then the other devices by name.
  const list = [...(devices.data ?? [])].sort(
    (a, b) => Number(b.this_device) - Number(a.this_device) || a.name.localeCompare(b.name),
  );
  return (
    <Box sx={{ overflowY: "auto", height: "100%" }}>
      <Stack spacing={6} sx={{ p: { xs: 4, sm: 6 } }}>
        <PageHeader
          title="Devices & sync"
          description="A remote computer keeps the agents working while the laptop is closed. A phone is a remote control."
          actions={
            <>
              <Button variant="outlined" startIcon={<Sync />} onClick={() => dialogs.sync()}>
                Sync
              </Button>
              <Button variant="contained" onClick={() => dialogs.pair()}>
                Add device
              </Button>
            </>
          }
        />
        {devices.isError && <Alert severity="error">{errorText(devices.error)}</Alert>}
        {devices.isPending && <LoadingRows rows={3} height={160} label="Loading the devices" />}
        {devices.data?.length === 0 && (
          <Empty title="No device record yet">
            The device with the master key writes the records. Add a device to pair it.
          </Empty>
        )}
        {list.length > 0 && (
          <Box
            sx={{
              display: "grid",
              gap: 4,
              gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 360px), 1fr))",
              alignItems: "start",
            }}
          >
            {list.map((device) => (
              <DeviceCard
                key={device.slug}
                device={device}
                presence={seen.get(device.slug)}
                peer={peers.get(device.slug)}
                agents={
                  device.role === "mobile"
                    ? []
                    : agentLines(queues.data, device.slug, projects.data, tasks.data)
                }
                hosts={hostSummary(hosts.data?.devices.find((e) => e.device === device.slug))}
                slots={
                  device.this_device && bindings.data?.may_run
                    ? testSlotsText(bindings.data.resources)
                    : null
                }
                folder={device.this_device ? folder : null}
                now={now}
                onRevoke={() => setRevoking(device)}
              />
            ))}
          </Box>
        )}
        <Section
          title="Sync between your devices"
          description="The sync engine is built into awd and into the phone app. AW starts, configures and updates it."
        >
          <Box>
            <PropertyRow label="Sync engine">
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ alignItems: "center", flexWrap: "wrap" }}
              >
                <Chip
                  label={engine ? (ENGINE_TEXT[engine] ?? engine) : sync.isError ? "Unknown" : "…"}
                  color={engine === "running" ? "success" : engine ? "warning" : "default"}
                />
                {sync.data?.paused && <Chip label="Paused" color="warning" />}
                {sync.isError && (
                  <Typography variant="body2" color="error.main">
                    {errorText(sync.error)}
                  </Typography>
                )}
              </Stack>
            </PropertyRow>
            {FOLDER_ROWS.map((f) => (
              <PropertyRow key={f.folder} label={`Folder ${f.folder}`}>
                {f.devices} · {f.content}
              </PropertyRow>
            ))}
          </Box>
        </Section>
      </Stack>
      {revoking && <RevokeDialog ws={ws} device={revoking} onClose={() => setRevoking(null)} />}
    </Box>
  );
}
