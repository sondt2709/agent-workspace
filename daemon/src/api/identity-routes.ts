// The identity, device, pairing and credential routes of the local API (openspec
// add-identity-and-pairing, local-api). A thin adapter: each route parses its input and calls one
// method of the services. A credential value is never logged: fastify logs no body.
import {
  addCredentialBody,
  approveBody,
  credentialParams,
  credentialValueView,
  credentialView,
  deviceEntryView,
  deviceParams,
  identityView,
  idWsParams,
  joinBody,
  pairingParams,
  pairingView,
  phraseView,
  revokeView,
} from "@aw/client/identity";
import { errorReplies } from "@aw/client/schemas";
import { z } from "zod";
import type { Daemon } from "../service/daemon.ts";
import type { ZodApi } from "./knowledge.ts";

const tags = ["identity"];

/**
 * Each route here is a person route, also the reads (integration with add-mcp-server): a session
 * caller gets 403 refused. The phrase and the credential values must never reach an agent through
 * the local API; an agent gets its credentials only through the session start.
 */
const person = { access: "person" } as const;

async function reply(value: unknown): Promise<never> {
  return (await value) as never;
}

export function registerIdentityRoutes(api: ZodApi, daemon: Daemon): void {
  const ws = (selector: string) => daemon.workspace(selector === "-" ? undefined : selector);

  api.get(
    "/v1/identity",
    {
      config: person,
      schema: {
        tags,
        operationId: "getIdentity",
        summary: "The user id, the master public key and this device with its public keys",
        response: { 200: identityView, ...errorReplies },
      },
    },
    () => {
      const identity = daemon.identity;
      return reply({
        user: identity.user,
        master_public: identity.masterPublic,
        has_master_key: identity.hasMaster,
        keystore: identity.keystoreKind,
        device: daemon.device,
        keys: { ed25519: identity.device.ed25519, x25519: identity.device.x25519 },
      });
    },
  );

  api.get(
    "/v1/identity/phrase",
    {
      config: person,
      schema: {
        tags,
        operationId: "getRecoveryPhrase",
        summary: "The recovery phrase (only on the device with the master key; 403 elsewhere)",
        response: { 200: phraseView, ...errorReplies },
      },
    },
    async () => reply({ phrase: await daemon.identity.phrase() }),
  );

  api.get(
    "/v1/workspaces/:ws/devices",
    {
      config: person,
      schema: {
        tags,
        operationId: "listDevices",
        summary: "The devices of the workspace from the signed device records, with their state",
        params: idWsParams,
        response: { 200: z.array(deviceEntryView), ...errorReplies },
      },
    },
    (request) => reply(daemon.devices.list(ws(request.params.ws))),
  );

  api.post(
    "/v1/workspaces/:ws/devices/:device/revoke",
    {
      config: person,
      schema: {
        tags,
        operationId: "revokeDevice",
        summary:
          "Revoke a device: a signed record with revoked: true, a new credential key, the peer removed",
        params: deviceParams,
        response: { 200: revokeView, ...errorReplies },
      },
    },
    async (request) => {
      const result = await daemon.devices.revoke(ws(request.params.ws), request.params.device);
      return reply({
        device: result.record.slug,
        seq: result.record.seq,
        revoked_at: result.record.revoked_at,
        credentials: result.credentials,
        closed: result.closed,
        delivered: result.delivered,
      });
    },
  );

  api.post(
    "/v1/workspaces/:ws/pairing",
    {
      config: person,
      schema: {
        tags,
        operationId: "startPairing",
        summary:
          "Start a pairing: a one-time code and its QR code, valid 10 min (device with the master key only)",
        params: idWsParams,
        response: { 200: pairingView, ...errorReplies },
      },
    },
    (request) =>
      reply(daemon.pairing.start(request.params.ws === "-" ? undefined : request.params.ws)),
  );

  api.get(
    "/v1/pairing/:id",
    {
      config: person,
      schema: {
        tags,
        operationId: "getPairing",
        summary: "The state of a pairing, with the check code when both keys are known",
        params: pairingParams,
        response: { 200: pairingView, ...errorReplies },
      },
    },
    (request) => reply(daemon.pairing.status(request.params.id)),
  );

  api.post(
    "/v1/pairing/:id/approve",
    {
      config: person,
      schema: {
        tags,
        operationId: "approvePairing",
        summary: "Approve the request with the check code that the new device shows",
        params: pairingParams,
        body: approveBody,
        response: { 200: pairingView, ...errorReplies },
      },
    },
    (request) => reply(daemon.pairing.approve(request.params.id, request.body.check_code)),
  );

  api.delete(
    "/v1/pairing/:id",
    {
      config: person,
      schema: {
        tags,
        operationId: "cancelPairing",
        summary: "Cancel a pairing and remove its folder",
        params: pairingParams,
        response: { 200: pairingView, ...errorReplies },
      },
    },
    (request) => reply(daemon.pairing.cancel(request.params.id)),
  );

  api.post(
    "/v1/pairing/join",
    {
      config: person,
      schema: {
        tags,
        operationId: "joinPairing",
        summary:
          "Join with a pairing code: the request goes to the showing device; the reply has the check code",
        body: joinBody,
        response: { 200: pairingView, ...errorReplies },
      },
    },
    (request) => reply(daemon.pairing.join(request.body)),
  );

  api.get(
    "/v1/workspaces/:ws/credentials",
    {
      config: person,
      schema: {
        tags,
        operationId: "listCredentials",
        summary: "The credential names (never a value)",
        params: idWsParams,
        response: { 200: z.array(credentialView), ...errorReplies },
      },
    },
    (request) => reply(daemon.credentials.list(ws(request.params.ws))),
  );

  api.post(
    "/v1/workspaces/:ws/credentials",
    {
      config: person,
      schema: {
        tags,
        operationId: "addCredential",
        summary: "Add or replace a credential: encrypted to the workspace credential key",
        params: idWsParams,
        body: addCredentialBody,
        response: { 200: credentialView, ...errorReplies },
      },
    },
    (request) =>
      reply(daemon.credentials.add(ws(request.params.ws), request.body.name, request.body.value)),
  );

  api.delete(
    "/v1/workspaces/:ws/credentials/:name",
    {
      config: person,
      schema: {
        tags,
        operationId: "removeCredential",
        summary: "Remove a credential file and write credential.removed",
        params: credentialParams,
        response: { 200: z.looseObject({ name: z.string() }), ...errorReplies },
      },
    },
    async (request) => {
      await daemon.credentials.remove(ws(request.params.ws), request.params.name);
      return reply({ name: request.params.name });
    },
  );

  api.get(
    "/v1/workspaces/:ws/credentials/:name/value",
    {
      config: person,
      schema: {
        tags,
        operationId: "getCredentialValue",
        summary: "The value of a credential, for the session start (a human route)",
        params: credentialParams,
        response: { 200: credentialValueView, ...errorReplies },
      },
    },
    async (request) =>
      reply({
        name: request.params.name,
        value: await daemon.credentials.value(ws(request.params.ws), request.params.name),
      }),
  );
}
