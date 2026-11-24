// Starts awd: the service, then the local API on the Unix socket with mode 0600 in a 0700 folder
// (docs/engineering-rules.md 6.8, design decision 14).
import { chmod, rm, stat } from "node:fs/promises";
import { connect } from "node:net";
import { createApp, type AppOptions, type AwApp } from "./api/app.ts";
import { startMcpServer, type McpListener } from "./mcp/server.ts";
import { Daemon, type DaemonOptions } from "./service/daemon.ts";
import { checkSocketPath, ensurePrivateFolder, SOCKET_MODE, statePaths } from "./state.ts";

/** True when a process accepts a connection on the socket. */
export function socketAnswers(path: string, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path);
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export class AlreadyRunningError extends Error {
  constructor(path: string) {
    super(`awd already runs on ${path}. Stop it first, or use another AW_HOME.`);
    this.name = "AlreadyRunningError";
  }
}

/** Removes a stale socket file, or throws when another awd answers on it. */
async function claimSocket(path: string): Promise<void> {
  const exists = await stat(path).then(
    () => true,
    () => false,
  );
  if (!exists) return;
  if (await socketAnswers(path)) throw new AlreadyRunningError(path);
  await rm(path, { force: true });
}

export interface RunningServer {
  daemon: Daemon;
  app: AwApp;
  /** The MCP listener, or null (off, or no free port). */
  mcp: McpListener | null;
  close(): Promise<void>;
}

export interface ServerOptions extends DaemonOptions {
  /** The tools of the peer process check of the local API (tests give fakes). */
  peerTools?: AppOptions["peerTools"];
}

/** Starts the service and listens on the socket of the settings. */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const socketPath = options.settings.socketPath;
  // Before listen: else a long AW_HOME fails in listen with a low-level error.
  checkSocketPath(options.settings);
  if (options.settings.mcp.error) throw new Error(options.settings.mcp.error);
  await ensurePrivateFolder(statePaths(options.settings).home);
  await ensurePrivateFolder(statePaths(options.settings).run);
  await claimSocket(socketPath);
  const daemon = new Daemon(options);
  // The tokens of the running sessions before the first request: an agent call during the start
  // gets 503 not_ready (its workspace is not attached yet), not 401.
  await daemon.sessions?.loadTokens();
  const app = await createApp(daemon, options.peerTools ? { peerTools: options.peerTools } : {});
  // Listen first, so a client gets 503 from /readyz while the workspaces open.
  const oldMask = process.umask(0o077);
  try {
    await app.listen({ path: socketPath });
  } finally {
    process.umask(oldMask);
  }
  await chmod(socketPath, SOCKET_MODE);
  options.log.info({ socket: socketPath }, "The local API listens");
  // Before the start: the session managers open windows during the start (new sessions, resumes),
  // and aw-launch reads the port file as soon as /readyz is ready. A tool call before the managers
  // are attached gets 503 not_ready (the tokens are loaded). A failed MCP start leaves awd running
  // with no MCP server; the agents use the aw CLI with their token.
  const mcp = await startMcpServer(daemon).catch((error: unknown) => {
    options.log.error({ err: error }, "The MCP server did not start");
    return null;
  });
  try {
    await daemon.start();
  } catch (error) {
    await mcp?.close().catch(() => undefined);
    await app.close();
    throw error;
  }
  let closed = false;
  return {
    daemon,
    app,
    mcp,
    async close() {
      if (closed) return;
      closed = true;
      await mcp?.close().catch((error: unknown) => {
        options.log.error({ err: error }, "The MCP server stop failed");
      });
      await app.close();
      await daemon.stop();
      await rm(socketPath, { force: true });
    },
  };
}
