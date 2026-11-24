// The sync check of the ready checks (docs/workflow.md 4.7.3.4, docs/phase-1.md 9.6.6): the
// `knowledge` and `secure` folders of the workspace are in sync with each connected peer.
import type { FolderPeerStatus, PeerStatus } from "@aw/plugin-api";
import type { SyncCheck } from "./ready.ts";

/** The part of the sync service that the check reads. */
export interface SyncSource {
  readonly state: string;
  readonly transport: { status(): Promise<PeerStatus[]> } | null;
}

/** The folder kinds that must be complete before an agent implements. */
const READY_KINDS = new Set(["knowledge", "secure"]);

/**
 * In sync, or the wait text of the first folder that is not ("knowledge 92 %"). With no sync
 * engine binary (a device alone), the check passes; an engine that does not run makes it wait.
 */
export async function syncCheck(sync: SyncSource | null, workspace: string): Promise<SyncCheck> {
  if (sync === null || sync.state === "not_installed") return { ok: true };
  if (sync.state !== "running" || !sync.transport) {
    return { ok: false, text: `the sync engine is ${sync.state}` };
  }
  const peers = await sync.transport.status();
  const waiting: { peer: string; folder: FolderPeerStatus }[] = [];
  for (const peer of peers) {
    if (!peer.connected) continue;
    for (const folder of peer.folders ?? []) {
      if (folder.workspace !== workspace || !READY_KINDS.has(folder.kind)) continue;
      if (!folder.inSync) waiting.push({ peer: peer.device, folder });
    }
  }
  const first = waiting[0];
  if (!first) return { ok: true };
  const percent =
    typeof first.folder.completion === "number"
      ? ` ${Math.min(99, Math.floor(first.folder.completion))} %`
      : "";
  return { ok: false, text: `${first.folder.kind}${percent} with ${first.peer}` };
}
