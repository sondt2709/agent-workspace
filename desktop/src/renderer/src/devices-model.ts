// The logic of the devices, sync, pairing and recovery phrase screens that does not need React
// (add-desktop-devices-knowledge).
import type {
  DevicePresenceView,
  DeviceRole,
  PairingState,
  Project,
  QueuesReply,
  SessionHostsEntry,
  SessionHostsReply,
  SyncNowReply,
  Task,
} from "../../shared/channels.ts";
import { agentChoices, ago, details, taskLabel } from "./model.ts";

/** "10:42" in local time. */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * "Last heartbeat 12 s ago", "Offline since 10:42", or "No heartbeat yet". Only awd writes
 * heartbeats, so a phone with none gets its own text (verify-journeys finding 23).
 */
export function heartbeatText(
  presence: DevicePresenceView | undefined,
  now: number,
  role: string | null = null,
): string {
  if (!presence || presence.received_at === null) {
    return role === "phone"
      ? "A phone sends no heartbeat. The sync line shows its state."
      : "No heartbeat yet";
  }
  if (!presence.online && presence.offline_since !== null) {
    return `Offline since ${clockTime(Date.parse(presence.offline_since))}`;
  }
  return `Last heartbeat ${ago(Date.parse(presence.received_at), now)}`;
}

/** The lines of a Sync now result: one per device that is not synced, else one line. */
export function syncResultLines(reply: SyncNowReply): string[] {
  if (reply.status.peers.length === 0) return ["This device has no paired device to sync with."];
  if (reply.pending.length === 0) return ["All devices are synced."];
  return reply.pending.map(
    (p) =>
      `${p.items} ${p.items === 1 ? "change" : "changes"} not synced to ${p.device} (${p.reason === "offline" ? "offline" : "time is up"})`,
  );
}

/** The tasks whose session runs on `device`: their sessions stop when the device is revoked. */
export function sessionsOn(tasks: Task[], device: string): string[] {
  return tasks
    .filter((t) => {
      const session = details(t).session;
      return !t.archived && session?.state === "running" && session.device === device;
    })
    .map((t) => `${taskLabel(t)} ${t.title ?? ""}`.trim());
}

/** The `agent@device` choices for a paused task: each choice of its project except its device. */
export function otherDeviceChoices(projects: Project[], task: Task): string[] {
  const current = task.assignee?.split("@")[1] ?? task.owner ?? null;
  return agentChoices(projects, task.project).filter((a) => a.split("@")[1] !== current);
}

export type SessionHostName = "tmux" | "orca";

export interface SessionHostChoice {
  /** The host that the dialog selects first: the checkout host, else Orca when it is turned on. */
  initial: SessionHostName;
  orcaEnabled: boolean;
  orcaLabel: string;
  /** A note under the choice, or null. */
  note: string | null;
}

/**
 * The session host choice of New session and "Assign to another device…" (integrate-ui): Orca only
 * when the device has "Use Orca" in its bindings, and, for this device, when awd found Orca. AW
 * cannot detect Orca on another device; there a session runs in tmux when Orca is missing.
 */
export function sessionHostChoice(
  hosts: SessionHostsReply | undefined,
  device: string,
  project: string | null,
): SessionHostChoice {
  const entry = hosts?.devices.find((e) => e.device === device);
  const off = (label: string, note: string | null = null): SessionHostChoice => ({
    initial: "tmux",
    orcaEnabled: false,
    orcaLabel: label,
    note,
  });
  if (!device) return off("Orca");
  if (!hosts) return off("Orca · checking…");
  if (!entry || !entry.use_orca) return off(`Orca · not turned on on ${device}`);
  if (entry.orca && !entry.orca.available) {
    return off(`Orca · not available on ${device}`, entry.orca.reason);
  }
  const asked = entry.checkouts.find((c) => c.project === project)?.session_host ?? null;
  return {
    initial: asked ?? "orca",
    orcaEnabled: true,
    orcaLabel: entry.orca?.version ? `Orca ${entry.orca.version}` : "Orca",
    note:
      entry.orca === null
        ? `If Orca is missing on ${device}, the session runs in tmux, and the task gets a comment.`
        : null,
  };
}

/** The text of a pairing state for the dialog. */
export const PAIRING_TEXT: Record<PairingState, string> = {
  waiting: "Waiting for the new device. Scan the QR code on the phone, or run aw pair - there.",
  check: "The new device asks to join.",
  approved: "Approved. The new device gets its record.",
  joining: "The new device joins the workspace folders.",
  done: "Paired. The new device syncs now.",
  failed: "The pairing failed.",
  expired: "The code expired. Start a new pairing.",
  cancelled: "The pairing was cancelled.",
};

export function pairingEnded(state: PairingState): boolean {
  return state === "done" || state === "failed" || state === "expired" || state === "cancelled";
}

/** The SVG of awd as an image URL. An <img> runs no script of the SVG. */
export function svgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/** Normalizes a typed check code to "123 456", or null when it does not have 6 digits. */
export function normalizeCheckCode(text: string): string | null {
  const digits = text.replace(/\s+/g, "");
  return /^\d{6}$/.test(digits) ? `${digits.slice(0, 3)} ${digits.slice(3)}` : null;
}

/** 3 different word positions (0-based) of a phrase of `count` words. */
export function pickPositions(count: number, random: () => number = Math.random): number[] {
  const positions = new Set<number>();
  while (positions.size < Math.min(3, count)) positions.add(Math.floor(random() * count));
  return [...positions].sort((a, b) => a - b);
}

/** True when each answer is the word at its position (case and spaces do not count). */
export function phraseCheckPasses(
  words: string[],
  positions: number[],
  answers: string[],
): boolean {
  return positions.every(
    (p, i) => (answers[i] ?? "").trim().toLowerCase() === (words[p] ?? "").toLowerCase(),
  );
}

// ---- The device cards of Devices & sync (openspec screens-align) ----

/** The role line of a device card. */
export function roleText(role: DeviceRole, thisDevice: boolean): string {
  const text =
    role === "local"
      ? "Local computer"
      : role === "remote"
        ? "Remote computer"
        : "Phone · remote control";
  return thisDevice ? `${text} · this device` : text;
}

/**
 * The agents of one computer with "1 working of 2 · queue 0". The queues route lists only the agents
 * with a queued task, so the agents also come from the default agent of each project that has the
 * device in its order. With no queue entry, "working" counts the running sessions of the agent on
 * the device of an open task that the device claims, that wait for no gate and are not paused (the
 * rule of the queues route), and the maximum is not known.
 */
export function agentLines(
  queues: QueuesReply | undefined,
  device: string,
  projects: Project[] = [],
  tasks: Task[] = [],
): { agent: string; sessions: string }[] {
  const queued = new Map(
    (queues?.agents ?? []).filter((a) => a.device === device).map((a) => [a.agent, a]),
  );
  const agents = new Set(queued.keys());
  for (const p of projects) {
    if (!p.archived && p.devices.includes(device)) agents.add(`${p.default_agent}@${device}`);
  }
  return [...agents].sort().map((agent) => {
    const queue = queued.get(agent);
    const working =
      queue?.working ??
      tasks.filter((t) => {
        const { session, claim } = details(t);
        return (
          !t.archived &&
          t.stage !== "done" &&
          t.assignee === agent &&
          claim?.device === device &&
          session?.device === device &&
          session.state === "running" &&
          !details(t).paused &&
          !t.needs_you_reasons.some((r) => r.reason === "gate")
        );
      }).length;
    const max = queue ? ` of ${queue.max_working}` : "";
    return { agent, sessions: `${working} working${max} · queue ${queue?.tasks.length ?? 0}` };
  });
}

/** "k3d · 1 slot, browser · 2 slots", or "None". */
export function testSlotsText(resources: Record<string, number> | undefined): string {
  const entries = Object.entries(resources ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "None";
  return entries.map(([name, n]) => `${name} · ${n} ${n === 1 ? "slot" : "slots"}`).join(", ");
}

export interface HostSummary {
  /** The host lines: "tmux · default", then the Orca state. */
  hosts: string[];
  /** "On" or "Off" for "Use Orca on this device". */
  useOrca: string;
  /** Each checkout of the bindings with the host of its new sessions. */
  checkouts: { project: string; host: string }[];
}

/**
 * The session hosts of a computer from the session-hosts route. AW detects Orca only on this
 * device (`orca` is null for another device). A checkout with no host uses Orca when "Use Orca" is
 * on and Orca is not known to be missing, else tmux (the rule of `sessionHostChoice`).
 */
export function hostSummary(entry: SessionHostsEntry | undefined): HostSummary | null {
  if (!entry || !entry.may_run) return null;
  const hosts = ["tmux · default"];
  if (entry.orca?.available)
    hosts.push(entry.orca.version ? `Orca ${entry.orca.version} found` : "Orca found");
  else if (entry.orca) hosts.push("Orca not available");
  // With Orca on but not available on this device, awd starts a session in tmux.
  const fallback = !entry.use_orca
    ? "tmux (default)"
    : entry.orca && !entry.orca.available
      ? "tmux (default; Orca not available)"
      : "Orca (default)";
  return {
    hosts,
    useOrca: entry.use_orca ? "On" : "Off",
    checkouts: entry.checkouts
      .map((c) => ({
        project: c.project,
        host: c.session_host === "orca" ? "Orca" : c.session_host === "tmux" ? "tmux" : fallback,
      }))
      .sort((a, b) => a.project.localeCompare(b.project)),
  };
}
