// The sync routes of the local API (openspec add-syncthing-sync, local-api: sync routes). A thin
// adapter: each route parses its input and calls one method of the sync service.
import {
  addPeerBody,
  errorReplies,
  peerParams,
  syncNowBody,
  syncNowReply,
  syncStatusReply,
} from "@aw/client/schemas";
import type { FastifyInstance, RawServerDefault } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "../log.ts";
import type { Daemon } from "../service/daemon.ts";

type App = FastifyInstance<RawServerDefault, IncomingMessage, ServerResponse, Logger>;

const asReply = <T>(value: unknown): T => value as T;

export function registerSyncRoutes(app: App, daemon: Daemon): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    "/v1/sync",
    {
      schema: {
        tags: ["sync"],
        operationId: "getSyncStatus",
        summary: "The sync engine state and the status of each peer with its text",
        response: { 200: syncStatusReply, ...errorReplies },
      },
    },
    async () => asReply<never>(await daemon.sync.status()),
  );

  api.post(
    "/v1/sync/now",
    {
      config: { access: "person" },
      schema: {
        tags: ["sync"],
        operationId: "syncNow",
        summary:
          "Sync now: scan each folder, then wait until each peer is connected with 0 items and a valid state",
        body: syncNowBody,
        response: { 200: syncNowReply, ...errorReplies },
      },
    },
    async (request) => asReply<never>(await daemon.sync.syncNow(request.body.timeout_ms)),
  );

  api.post(
    "/v1/sync/pause",
    {
      config: { access: "person" },
      schema: {
        tags: ["sync"],
        operationId: "pauseSync",
        summary: "Pause the connections to each peer",
        response: { 200: syncStatusReply, ...errorReplies },
      },
    },
    async () => asReply<never>(await daemon.sync.pause()),
  );

  api.post(
    "/v1/sync/resume",
    {
      config: { access: "person" },
      schema: {
        tags: ["sync"],
        operationId: "resumeSync",
        summary: "Resume the connections to each peer",
        response: { 200: syncStatusReply, ...errorReplies },
      },
    },
    async () => asReply<never>(await daemon.sync.resume()),
  );

  api.post(
    "/v1/sync/peers",
    {
      config: { access: "person" },
      schema: {
        tags: ["sync"],
        operationId: "addSyncPeer",
        summary:
          "Add a peer by its engine device id and addresses. A test path: awd answers 403 refused unless AW_SYNC_TEST_PEERS=on (identity-pairing adds peers after its own checks)",
        body: addPeerBody,
        response: { 200: syncStatusReply, ...errorReplies },
      },
    },
    async (request) => asReply<never>(await daemon.sync.addTestPeer(request.body)),
  );

  api.delete(
    "/v1/sync/peers/:device",
    {
      config: { access: "person" },
      schema: {
        tags: ["sync"],
        operationId: "removeSyncPeer",
        summary: "Remove a peer by its device slug or engine device id",
        params: peerParams,
        response: { 200: syncStatusReply, ...errorReplies },
      },
    },
    async (request) => asReply<never>(await daemon.sync.removePeer(request.params.device)),
  );
}
