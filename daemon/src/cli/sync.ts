// The `aw sync` commands (openspec add-syncthing-sync, aw-cli): Sync now, the status, pause and
// resume, and the peers. They call the local API; awd does the work.
import { AwClient, type SyncNowReply, type SyncStatusReply } from "@aw/client";
import type { Command } from "@commander-js/extra-typings";

export interface SyncCommandContext {
  socketPath: string;
  print(value: unknown, text: () => string): void;
  /** Sets exit code 1: a peer is not synced. */
  notSynced(): void;
  fail(message: string): never;
}

/** The text of `aw sync status`. */
export function formatSyncStatus(status: SyncStatusReply): string {
  const lines = [
    `Sync engine: ${status.engine}${status.paused ? " (paused)" : ""}`,
    `This device: ${status.device}${status.sync_id ? ` ${status.sync_id}` : ""}`,
  ];
  if (status.peers.length === 0) lines.push("No peers.");
  for (const peer of status.peers) {
    const route = peer.route ? `, ${peer.route}` : "";
    lines.push(`${peer.device} (${peer.role ?? "peer"}${route}): ${peer.text}`);
  }
  return lines.join("\n");
}

/** The text of `aw sync now`: one line per peer. */
export function formatSyncNow(reply: SyncNowReply): string {
  if (reply.status.peers.length === 0) return "No peers to sync with.";
  return reply.status.peers
    .map((peer) => {
      const pending = reply.pending.find((p) => p.device === peer.device);
      if (!pending) return `${peer.device}: ${peer.text}`;
      const items = pending.items === 1 ? "1 change" : `${pending.items} changes`;
      return `${peer.device}: ${items} not synced to ${peer.device} (${pending.reason})`;
    })
    .join("\n");
}

const ROLES = ["local", "remote", "mobile"] as const;

export function addSyncCommands(program: Command, client: AwClient, ctx: SyncCommandContext): void {
  const sync = program
    .command("sync")
    .description("Built-in sync between your devices: Sync now, the status and the peers");

  sync
    .command("now")
    .description("Scan each folder, then wait until each peer has each change")
    .option("--timeout <seconds>", "stop after this time", "20")
    .action(async (options) => {
      const seconds = Number(options.timeout);
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) {
        ctx.fail("--timeout must be a number of seconds from 1 to 600");
      }
      const long = new AwClient({ socketPath: ctx.socketPath, timeoutMs: seconds * 1000 + 60_000 });
      const reply = await long.syncNow({ timeout_ms: Math.round(seconds * 1000) });
      if (reply.pending.length > 0) ctx.notSynced();
      ctx.print(reply, () => formatSyncNow(reply));
    });

  sync
    .command("status")
    .description("Show the engine state and the sync state of each peer")
    .action(async () => {
      const status = await client.syncStatus();
      ctx.print(status, () => formatSyncStatus(status));
    });

  sync
    .command("pause")
    .description("Pause the connections to each peer")
    .action(async () => {
      const status = await client.syncPause();
      ctx.print(status, () => formatSyncStatus(status));
    });

  sync
    .command("resume")
    .description("Resume the connections to each peer")
    .action(async () => {
      const status = await client.syncResume();
      ctx.print(status, () => formatSyncStatus(status));
    });

  const peer = sync.command("peer").description("Peers of this device (pairing adds them later)");
  peer
    .command("add")
    .description("Add a peer by its engine device id and its addresses")
    .argument("<device-id>", "the engine device id of the peer (aw sync status on the peer)")
    .argument("<address...>", "addresses to dial, for example tcp://192.0.2.10:22300, or dynamic")
    .option("--name <slug>", "the device slug of the peer, for example ubuntu-01")
    .option("--role <role>", "local, remote or mobile", "remote")
    .action(async (deviceId, addresses, options) => {
      if (!(ROLES as readonly string[]).includes(options.role)) {
        ctx.fail(`--role must be one of ${ROLES.join(", ")}`);
      }
      const status = await client.addPeer({
        device_id: deviceId,
        addresses,
        role: options.role as (typeof ROLES)[number],
        ...(options.name ? { name: options.name } : {}),
      });
      ctx.print(status, () => formatSyncStatus(status));
    });
  peer
    .command("remove")
    .description("Remove a peer")
    .argument("<device>", "the device slug or the engine device id")
    .action(async (device) => {
      const status = await client.removePeer(device);
      ctx.print(status, () => formatSyncStatus(status));
    });
}
