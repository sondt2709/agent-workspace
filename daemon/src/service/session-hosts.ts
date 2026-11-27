// The session hosts of each computer for the desktop dialogs New session and "Assign to another
// device…" (integrate-ui, host-orca open issue 1): "Use Orca on this device" (`use_orca`) and the
// `session_host` of each checkout come from the synced bindings. Only this device can detect Orca;
// the state of another computer is not known (null). Its session runs in tmux, with one comment,
// when Orca is missing there (docs/phase-1.md 9.9.6).
import type { HealthDocument } from "@aw/schema";
import type { SessionService } from "../sessions/service.ts";
import type { WorkspaceService } from "./workspace.ts";

export interface OrcaState {
  available: boolean;
  version: string | null;
  reason: string | null;
}

export interface SessionHostsEntry {
  device: string;
  may_run: boolean;
  use_orca: boolean;
  /**
   * The project, its `session_host` and `has_commit` from the health of the device (no checkout
   * path: the path stays on its device). `has_commit` is null when not known.
   */
  checkouts: {
    project: string;
    session_host: "tmux" | "orca" | null;
    has_commit: boolean | null;
  }[];
  /** The Orca detection of this device; null for another device (not known). */
  orca: OrcaState | null;
}

/** Each computer with bindings: no phone and no revoked device. */
export async function sessionHosts(
  ws: WorkspaceService,
  sessions: SessionService | null,
): Promise<{ device: string; devices: SessionHostsEntry[] }> {
  const me = ws.device.slug;
  const views = new Map(ws.view.devices.map((d) => [d.slug, d]));
  let local: OrcaState | null = null;
  if (ws.bindings().some((b) => b.device === me)) {
    local = sessions
      ? ((await sessions.orcaState(ws.id)) ?? {
          available: false,
          version: null,
          reason: "the sessions of this device are not ready",
        })
      : { available: false, version: null, reason: "the sessions are off on this device" };
  }
  const devices = ws
    .bindings()
    .filter((b) => {
      const view = views.get(b.device);
      return view?.role !== "mobile" && view?.revoked !== true;
    })
    .map((b) => {
      const doc = ws.lastValidDocument(`tasks/devices/${b.device}/health.yaml`);
      const health = doc?.kind === "health" ? (doc.value as HealthDocument) : null;
      return {
        device: b.device,
        may_run: b.may_run,
        use_orca: b.use_orca,
        checkouts: b.checkouts.map((c) => ({
          project: c.project,
          session_host: c.session_host ?? null,
          has_commit: health?.checkouts?.find((h) => h.project === c.project)?.has_commit ?? null,
        })),
        orca: b.device === me ? local : null,
      };
    });
  return { device: me, devices };
}
