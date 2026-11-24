// The identity, device, pairing and credential routes of the local API (openspec
// add-identity-and-pairing): their zod schemas (awd checks each request with them and generates
// contracts/openapi.yaml from them) and IdentityClient on AwClient.request. A credential value is
// only in a request body or in the reply of the value route, never in a path or a query.
import { z } from "zod";
import type { AwClient } from "./index.ts";

const selector = z.string().min(1).max(128);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const credentialName = z.string().regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/);
const role = z.enum(["local", "remote", "mobile"]);

// ---- Inputs -------------------------------------------------------------------------------

export const idWsParams = z.object({
  ws: selector.describe("The workspace id or name. `-` selects the only workspace."),
});
export const deviceParams = idWsParams.extend({ device: slug });
export const pairingParams = z.object({
  id: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .describe("The pairing id: the nonce of the code"),
});
export const approveBody = z.object({
  check_code: z
    .string()
    .regex(/^\s*\d{3}\s*\d{3}\s*$/)
    .describe("The 6-digit check code that the new device shows"),
});
export const joinBody = z.object({
  code: z.string().min(8).max(4096).describe("The pairing code aw1:…"),
  path: z.string().min(1).optional().describe("The workspace folder itself"),
  parent: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The location that holds the workspace folder: <parent>/<name>, or <name>-aw1 when that name is in use; default ~/AW",
    ),
  slug: slug.optional().describe("The name of this device; default the current name"),
  name: z.string().min(1).max(200).optional(),
});
export const credentialParams = idWsParams.extend({ name: credentialName });
export const addCredentialBody = z.object({
  name: credentialName,
  value: z
    .string()
    .min(1)
    .max(64 * 1024),
});

// ---- Replies ------------------------------------------------------------------------------

export const identityView = z.looseObject({
  user: z.string().nullable(),
  master_public: z.string().nullable(),
  has_master_key: z.boolean(),
  keystore: z.enum(["os", "file"]),
  device: z.looseObject({ slug, name: z.string(), role }),
  keys: z.looseObject({ ed25519: z.string(), x25519: z.string() }),
});
export type IdentityView = z.infer<typeof identityView>;

export const phraseView = z.looseObject({ phrase: z.string() });

export const deviceEntryView = z.looseObject({
  slug,
  name: z.string(),
  role,
  state: z.enum(["valid", "revoked", "bad_signature"]),
  sync_device_id: z.string(),
  seq: z.int(),
  paired_at: z.string(),
  revoked_at: z.string().nullable(),
  this_device: z.boolean(),
});
export type DeviceEntryView = z.infer<typeof deviceEntryView>;

export const revokeView = z.looseObject({
  device: slug,
  seq: z.int(),
  revoked_at: z.string(),
  /** The credentials that awd wrote again with the new key. */
  credentials: z.int(),
  /** The credentials that did not open on this device: they keep the old key (add them again). */
  closed: z.array(z.string()).default([]),
  /**
   * True when the revoked device confirmed its revoke record before the peer went. False: it was
   * offline or did not answer, so it does not know of the revoke and keeps its sessions. Missing
   * from an older awd.
   */
  delivered: z.boolean().optional(),
});

export const pairingView = z.looseObject({
  id: z.string(),
  side: z.enum(["show", "join"]),
  state: z.enum([
    "waiting",
    "check",
    "approved",
    "joining",
    "done",
    "failed",
    "expired",
    "cancelled",
  ]),
  workspace: z.looseObject({ id: z.string(), name: z.string() }),
  device: z.string().describe("The showing device"),
  expires_at: z.string(),
  check_code: z.string().nullable(),
  new_device: z.looseObject({ slug, name: z.string(), role }).nullable(),
  error: z.string().nullable(),
  folder: z
    .string()
    .nullable()
    .default(null)
    .describe("The workspace folder of this device (join side only)"),
  folder_note: z
    .string()
    .nullable()
    .default(null)
    .describe("One sentence when the folder rule skipped a taken name (join side only)"),
  code: z.string().nullable().describe("The code aw1:… (show side only)"),
  qr_svg: z.string().nullable().describe("The QR code of the code as SVG (show side only)"),
});
export type PairingView = z.infer<typeof pairingView>;

export const credentialView = z.looseObject({
  name: credentialName,
  added_by: z.string().nullable(),
  imported_on: z.array(z.string()),
  file: z.boolean(),
});
export type CredentialView = z.infer<typeof credentialView>;

export const credentialValueView = z.looseObject({ name: credentialName, value: z.string() });

// ---- Client -------------------------------------------------------------------------------

const encode = encodeURIComponent;

export class IdentityClient {
  readonly #client: AwClient;

  constructor(client: AwClient) {
    this.#client = client;
  }

  identity = () => this.#client.request<IdentityView>("GET", "/v1/identity", identityView);
  phrase = () => this.#client.request<{ phrase: string }>("GET", "/v1/identity/phrase", phraseView);

  devices = (ws: string) =>
    this.#client.request<DeviceEntryView[]>(
      "GET",
      `/v1/workspaces/${encode(ws)}/devices`,
      z.array(deviceEntryView),
    );
  revoke = (ws: string, device: string) =>
    this.#client.request<z.infer<typeof revokeView>>(
      "POST",
      `/v1/workspaces/${encode(ws)}/devices/${encode(device)}/revoke`,
      revokeView,
    );

  startPairing = (ws: string) =>
    this.#client.request<PairingView>("POST", `/v1/workspaces/${encode(ws)}/pairing`, pairingView);
  pairing = (id: string) =>
    this.#client.request<PairingView>("GET", `/v1/pairing/${encode(id)}`, pairingView);
  approve = (id: string, checkCode: string) =>
    this.#client.request<PairingView>("POST", `/v1/pairing/${encode(id)}/approve`, pairingView, {
      body: { check_code: checkCode },
    });
  cancelPairing = (id: string) =>
    this.#client.request<PairingView>("DELETE", `/v1/pairing/${encode(id)}`, pairingView);
  join = (body: z.infer<typeof joinBody>) =>
    this.#client.request<PairingView>("POST", "/v1/pairing/join", pairingView, { body });

  credentials = (ws: string) =>
    this.#client.request<CredentialView[]>(
      "GET",
      `/v1/workspaces/${encode(ws)}/credentials`,
      z.array(credentialView),
    );
  addCredential = (ws: string, name: string, value: string) =>
    this.#client.request<CredentialView>(
      "POST",
      `/v1/workspaces/${encode(ws)}/credentials`,
      credentialView,
      { body: { name, value } },
    );
  removeCredential = (ws: string, name: string) =>
    this.#client.request<{ name: string }>(
      "DELETE",
      `/v1/workspaces/${encode(ws)}/credentials/${encode(name)}`,
      z.looseObject({ name: credentialName }),
    );
  credentialValue = (ws: string, name: string) =>
    this.#client.request<{ name: string; value: string }>(
      "GET",
      `/v1/workspaces/${encode(ws)}/credentials/${encode(name)}/value`,
      credentialValueView,
    );
}
