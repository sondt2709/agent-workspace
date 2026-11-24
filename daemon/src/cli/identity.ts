// The identity, device, pair and credential commands of the aw CLI (openspec
// add-identity-and-pairing, aw-cli). They call the local API through IdentityClient. No command
// takes a credential value or a key as an argument.
import type { AwClient } from "@aw/client";
import {
  IdentityClient,
  type CredentialView,
  type DeviceEntryView,
  type PairingView,
} from "@aw/client/identity";
import { systemClock, type Clock } from "@aw/core";
import type { Command } from "@commander-js/extra-typings";
import { encodeQR } from "qr";

export interface IdentityCommandContext {
  client: AwClient;
  wsName: () => string;
  print: (value: unknown, text: () => string) => void;
  /** Writes a progress line to stderr. */
  note: (text: string) => void;
  /** Reads a file, or stdin for `-`. */
  readText: (path: string) => Promise<string>;
  /** Makes a path absolute against the working folder of the command. */
  resolvePath: (path: string) => string;
  /** Sets exit code 1. */
  refused: () => void;
  /** An error for a wrong argument (exit code 2). */
  inputError: (message: string) => Error;
  /** The wait between 2 status reads. Tests give a fake clock. */
  clock?: Clock;
}

const TERMINAL = ["done", "failed", "expired", "cancelled"];
const POLL_MS = 1000;

function formatDevices(list: DeviceEntryView[]): string {
  if (list.length === 0) return "No signed device records";
  return list
    .map(
      (d) =>
        `${d.slug}${d.this_device ? " (this device)" : ""}  ${d.role}  ${d.state}  seq ${d.seq}  ${d.sync_device_id}${d.revoked_at ? `  revoked at ${d.revoked_at}` : ""}`,
    )
    .join("\n");
}

function formatCredentials(list: CredentialView[]): string {
  if (list.length === 0) return "No credentials";
  return list
    .map((c) => {
      const from = c.added_by ? `added on ${c.added_by}` : "";
      const imported = c.imported_on.length > 0 ? `imported on ${c.imported_on.join(", ")}` : "";
      const file = c.file ? "" : "  (file not on this device yet)";
      return `${c.name}  ${[from, imported].filter(Boolean).join(", ")}${file}`;
    })
    .join("\n");
}

/** The revoked device did not confirm its record: it does not know of the revoke. */
export function notDelivered(device: string): string {
  return `${device} did not get the revoke, so its agent sessions continue. Stop them on that device, or turn it off.`;
}

function approveLine(p: PairingView): string {
  return `aw device approve ${p.id} <check code>`;
}

export function addIdentityCommands(program: Command, ctx: IdentityCommandContext): void {
  const api = new IdentityClient(ctx.client);
  const clock = ctx.clock ?? systemClock;

  /** Reads the pairing state until `until` is true or the pairing ends. */
  async function follow(id: string, until: (p: PairingView) => boolean): Promise<PairingView> {
    let last = "";
    for (;;) {
      const p = await api.pairing(id);
      if (p.state !== last) {
        last = p.state;
        ctx.note(`Pairing ${p.state}${p.error ? `: ${p.error}` : ""}`);
      }
      if (until(p) || TERMINAL.includes(p.state)) return p;
      await clock.sleep(POLL_MS);
    }
  }

  // ---- identity ----
  const identity = program.command("identity").description("The identity of this device");
  identity
    .command("show")
    .description("Show the user id, this device and its public keys")
    .action(async () => {
      const value = await api.identity();
      ctx.print(value, () =>
        [
          `User: ${value.user ?? "none yet (create a workspace, or pair this device)"}`,
          `Device: ${value.device.slug} (${value.device.role})`,
          `Master key on this device: ${value.has_master_key ? "yes" : "no"}`,
          `Keystore: ${value.keystore}`,
          `Ed25519: ${value.keys.ed25519}`,
          `X25519: ${value.keys.x25519}`,
        ].join("\n"),
      );
    });
  identity
    .command("phrase")
    .description("Print the recovery phrase (only on the device with the master key)")
    .action(async () => {
      const { phrase } = await api.phrase();
      ctx.print({ phrase }, () => `${phrase}\nWrite these 24 words down. Keep them offline.`);
    });

  // ---- device ----
  const device = program.command("device").description("Devices: list, add (pair), revoke");
  device
    .command("list")
    .description("List the devices of the workspace from the signed device records")
    .action(async () => {
      const list = await api.devices(ctx.wsName());
      ctx.print(list, () => formatDevices(list));
    });
  device
    .command("add")
    .description("Show a one-time pairing code (10 min) for a new device")
    .option("--qr", "also print the code as a QR code")
    .option("--no-wait", "print the code and exit; do not wait for a request")
    .action(async (options) => {
      const started = await api.startPairing(ctx.wsName());
      ctx.print(started, () =>
        [
          `Pairing code (valid until ${started.expires_at}):`,
          started.code ?? "",
          options.qr ? encodeQR(started.code ?? "", "ascii") : "",
          "On the new device, run 'aw pair -', paste the code and press Ctrl-D (the code stays out of the shell history)",
        ]
          .filter((line) => line !== "")
          .join("\n"),
      );
      if (!options.wait) return;
      const p = await follow(started.id, (x) => x.state === "check");
      if (p.state !== "check") {
        ctx.refused();
        return;
      }
      ctx.note(
        `${p.new_device?.slug ?? "A device"} asks to pair. Check code: ${p.check_code}\nCompare it with the code on ${p.new_device?.slug ?? "the new device"}, then run: ${approveLine(p)}`,
      );
    });
  device
    .command("approve")
    .description("Approve a pairing request with the check code that the new device shows")
    .argument("<pairing>", "the pairing id")
    // Variadic: the code prints as `482 913`, and a human types it with the space.
    .argument("<check-code...>", "the 6-digit check code, with or without the space")
    .action(async (id, parts) => {
      const p = await api.approve(id, parts.join(""));
      ctx.print(p, () => `Approved ${p.new_device?.slug ?? "the device"}: its record is signed`);
    });
  device
    .command("cancel")
    .description("Cancel a pairing")
    .argument("<pairing>", "the pairing id")
    .action(async (id) => {
      const p = await api.cancelPairing(id);
      ctx.print(p, () => `Pairing ${p.id} ${p.state}`);
    });
  device
    .command("revoke")
    .description("Revoke a device: it gets no more changes, and its later events do not count")
    .argument("<device>", "the device slug")
    .action(async (slug) => {
      const result = await api.revoke(ctx.wsName(), slug);
      ctx.print(result, () =>
        [
          `Revoked ${result.device} (seq ${result.seq}). ${result.credentials} ${result.credentials === 1 ? "credential uses" : "credentials use"} a new key; rotate the values that ${result.device} had.`,
          result.closed.length > 0
            ? `Not opened on this device, so they keep the old key: ${result.closed.join(", ")}. Add them again with 'aw credential add'.`
            : "",
          result.delivered === false ? notDelivered(result.device) : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    });

  // ---- pair ----
  program
    .command("pair")
    .description("Pair this device with the code of 'aw device add'")
    .argument("<code>", "the pairing code aw1:…, or - to read it from stdin")
    .option("--path <folder>", "the workspace folder itself (missing or empty)")
    .option(
      "--in <folder>",
      "the folder that holds the workspace folder: <folder>/<workspace name>, or <name>-aw1 when that name is in use (default ~/AW)",
    )
    .option("--slug <name>", "the name of this device (default the current name)")
    .option("--name <text>", "the display name of this device")
    .option("--no-wait", "send the request and exit")
    .action(async (code, options) => {
      // `-` keeps the code (it holds the one-time secret) out of argv and the shell history.
      if (options.path && options.in) throw ctx.inputError("Give --path or --in, not both");
      const text = code === "-" ? (await ctx.readText("-")).trim() : code;
      const p = await api.join({
        code: text,
        ...(options.path ? { path: ctx.resolvePath(options.path) } : {}),
        ...(options.in ? { parent: ctx.resolvePath(options.in) } : {}),
        ...(options.slug ? { slug: options.slug } : {}),
        ...(options.name ? { name: options.name } : {}),
      });
      if (p.folder_note) ctx.note(p.folder_note);
      ctx.note(
        `Folder: ${p.folder ?? "-"}\nCheck code: ${p.check_code}\nOn ${p.device}, compare the code and run: ${approveLine(p)}`,
      );
      if (!options.wait) {
        ctx.print(p, () => `Pairing ${p.id} ${p.state}`);
        return;
      }
      const end = await follow(p.id, () => false);
      ctx.print(end, () =>
        end.state === "done"
          ? `Paired with ${end.device}: workspace ${end.workspace.name} at ${end.folder ?? p.folder ?? "-"}`
          : `Pairing ${end.state}${end.error ? `: ${end.error}` : ""}`,
      );
      if (end.state !== "done") ctx.refused();
    });

  // ---- credential ----
  const credential = program
    .command("credential")
    .description("Credentials: encrypted values for sessions (never in arguments)");
  credential
    .command("add")
    .description("Add or replace a credential; the value comes from stdin or --file")
    .argument("<name>", "the credential name, for example stripe-test")
    .option("--file <path>", "a file with the value; - reads stdin (the default)", "-")
    .action(async (name, options) => {
      const value = await ctx.readText(options.file);
      const entry = await api.addCredential(ctx.wsName(), name, value);
      ctx.print(entry, () => `Credential ${entry.name} saved (encrypted)`);
    });
  credential
    .command("list")
    .description("List the credential names")
    .action(async () => {
      const list = await api.credentials(ctx.wsName());
      ctx.print(list, () => formatCredentials(list));
    });
  credential
    .command("remove")
    .description("Remove a credential")
    .argument("<name>", "the credential name")
    .action(async (name) => {
      const reply = await api.removeCredential(ctx.wsName(), name);
      ctx.print(reply, () => `Credential ${name} removed`);
    });
  credential
    .command("get")
    .description("Print the value of a credential (for the session start)")
    .argument("<name>", "the credential name")
    .action(async (name) => {
      const reply = await api.credentialValue(ctx.wsName(), name);
      ctx.print(reply, () => reply.value);
    });
}
