// The MCP server of awd (docs/architecture.md 6.4, docs/phase-1.md 9.8, design of add-mcp-server):
// MCP Streamable HTTP, stateless, on a second fastify instance on 127.0.0.1. The Host and Origin
// guards of the SDK adapter run first, then the session token. Each request gets its own McpServer
// for the session of its token (createMcpHandler calls the factory once per request).
import { newId } from "@aw/schema";
import { localhostHostValidation, localhostOriginValidation } from "@modelcontextprotocol/fastify";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Logger } from "../log.ts";
import type { Daemon } from "../service/daemon.ts";
import { writePrivate } from "../sessions/records.ts";
import { bearerToken } from "./tokens.ts";
import { buildMcpServer, RetryCache } from "./tools.ts";

/** The body limit of the MCP endpoint (docs/tech-stack.md 2.2). */
export const MCP_BODY_LIMIT = 4 * 1024 * 1024;
export const MCP_PATH = "/mcp";

export interface McpListener {
  port: number;
  app: FastifyInstance;
  close(): Promise<void>;
}

/** The JSON-RPC error of a request with no valid token: 401 with no WWW-Authenticate (decision 4). */
const UNAUTHORIZED = {
  jsonrpc: "2.0",
  error: {
    code: -32001,
    message:
      "The AW session token is missing, unknown or revoked. A token is valid only while its AW session runs.",
  },
  id: null,
};

function buildApp(daemon: Daemon, log: Logger): { app: FastifyInstance; close(): Promise<void> } {
  const app = Fastify({
    loggerInstance: log,
    bodyLimit: MCP_BODY_LIMIT,
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: "trace_id" }),
    genReqId: () => newId(daemon.clock),
    // A request during the stop runs as usual: Claude Code then reconnects to the new awd.
    return503OnClosing: false,
  }) as unknown as FastifyInstance;
  // DNS rebinding and cross-site requests: before the token check (mcp-server spec).
  app.addHook("onRequest", localhostHostValidation());
  app.addHook("onRequest", localhostOriginValidation());

  const cache = new RetryCache(daemon.clock);
  const handler = createMcpHandler(
    (context) => {
      const session = (context.authInfo?.extra as { session?: string } | undefined)?.session;
      if (!session) throw new Error("An MCP request with no session reached the factory");
      return buildMcpServer({ daemon, session, log, cache });
    },
    {
      onerror: (error) => log.warn({ err: error }, "An MCP request failed"),
      maxRequestBodySize: MCP_BODY_LIMIT,
    },
  );
  const node = toNodeHandler(handler, {
    onerror: (error) => log.error({ err: error }, "The MCP handler failed"),
    maxRequestBodySize: MCP_BODY_LIMIT,
  });

  app.all(MCP_PATH, async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    const session = token === null ? null : (daemon.sessions?.tokens.session(token) ?? null);
    if (session === null) {
      // No WWW-Authenticate header: the token is the configured header of the AW plugin, so
      // Claude Code reports a failed server and starts no OAuth flow (decision 4, spike S12).
      return reply.code(401).header("content-type", "application/json").send(UNAUTHORIZED);
    }
    const auth: AuthInfo = { token: "session", clientId: session, scopes: [], extra: { session } };
    reply.hijack();
    await node(Object.assign(request.raw, { auth }), reply.raw, request.body);
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({
      error: { code: "not_found", message: `No route ${request.method} ${request.url}` },
      trace_id: request.id,
    });
  });

  return {
    app,
    close: async () => {
      await handler.close();
      await app.close();
    },
  };
}

/** The file with the port of the last MCP listener: kept at the stop (open issue 3 of the result). */
export function lastPortFile(portFile: string): string {
  return `${portFile}.last`;
}

/**
 * The ports in the order awd tries them: the port of the last run first when it is in the range, so
 * a session that runs over an awd restart keeps a valid AW_MCP_URL when that port is free again.
 */
async function portOrder(ports: number[], portFile: string): Promise<number[]> {
  const last = Number((await readFile(lastPortFile(portFile), "utf8").catch(() => "")).trim());
  if (!Number.isInteger(last) || last <= 0 || !ports.includes(last)) return ports;
  return [last, ...ports.filter((p) => p !== last)];
}

/**
 * Listens on the first free port of `ports` (127.0.0.1 only) and writes the port file. With no
 * port (`AW_MCP_PORT=off`) or no free port, it returns null and awd runs with no MCP server.
 */
export async function startMcpServer(
  daemon: Daemon,
  options: { ports?: number[] } = {},
): Promise<McpListener | null> {
  const portFile = daemon.settings.mcp.portFile;
  const ports = await portOrder(options.ports ?? daemon.settings.mcp.ports, portFile);
  const log = daemon.log.child({ module: "mcp" });
  await rm(portFile, { force: true });
  if (ports.length === 0) {
    log.info("The MCP server is off (AW_MCP_PORT=off)");
    return null;
  }
  for (const port of ports) {
    const built = buildApp(daemon, log);
    let actual: number;
    try {
      await built.app.listen({ host: "127.0.0.1", port });
      actual = (built.app.server.address() as AddressInfo).port;
      await writePrivate(portFile, `${actual}\n`);
      if (port !== 0) await writePrivate(lastPortFile(portFile), `${actual}\n`);
    } catch (error) {
      // Also after a listen: a failed port file write must not leave the port bound.
      await built.close().catch(() => undefined);
      await rm(portFile, { force: true });
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
      throw error;
    }
    log.info(
      { port: actual, url: `http://127.0.0.1:${actual}${MCP_PATH}` },
      "The MCP server listens",
    );
    return {
      port: actual,
      app: built.app,
      close: async () => {
        await rm(portFile, { force: true });
        await built.close();
      },
    };
  }
  log.error(
    { ports: `${ports[0]}-${ports[ports.length - 1]}` },
    "No free port for the MCP server: awd runs with no MCP server",
  );
  return null;
}
