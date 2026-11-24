// The caller rule of the local API (design of add-mcp-server, decision 5). Each request has one
// caller: the agent of a session (its token, or a process of its tree with no token), or the
// person. A route says what it needs in `config.access`:
//   person  only the person; a session caller gets 403 refused (principle 4);
//   agent   only the session in the path, with its token (the agent commands and the hooks);
//   caller  any caller, and the route acts as that caller (the knowledge writes);
//   read    any caller, and the route changes nothing (a read with a body, for example the
//           knowledge context).
// Fail-closed: a route with no `access` is `read` for GET and HEAD and `person` for each other
// method, so a new write route that forgets `access` refuses a session caller.
import type { FastifyInstance, FastifyRequest, RawServerDefault } from "fastify";
import type { IncomingMessage, ServerResponse } from "node:http";
import { runningGitPids } from "../continuity/git-branch.ts";
import type { Logger } from "../log.ts";
import { bearerToken } from "../mcp/tokens.ts";
import type { Daemon } from "../service/daemon.ts";
import { ServiceError } from "../service/errors.ts";
import {
  ancestorIn,
  descendants,
  parentTable,
  peerPid,
  systemPeerTools,
  type PeerTools,
} from "./peer.ts";

/** A peer check that takes this long is logged as a warning. */
const SLOW_PEER_CHECK_MS = 1000;

export type Access = "person" | "agent" | "caller" | "read";

/** The access of a route: its `config.access`, else `read` for GET and HEAD and `person` else. */
export function routeAccess(method: string, access: Access | undefined): Access {
  if (access !== undefined) return access;
  return method === "GET" || method === "HEAD" ? "read" : "person";
}

/** The agent of a session, or null for the person. */
export type RequestCaller = {
  agent: string;
  session: string;
  task: string;
  workspace: string;
} | null;

declare module "fastify" {
  interface FastifyContextConfig {
    access?: Access;
  }
  interface FastifyRequest {
    /** The caller of the request (see caller.ts). */
    caller: RequestCaller;
  }
}

/** The refusal of a person route for a session caller. */
export function personOnly(what: string, caller: NonNullable<RequestCaller>): ServiceError {
  return new ServiceError(
    "refused",
    `${what} is an action of a person, and this caller is the agent session ${caller.session} (${caller.agent}). Ask the human with aw ask.`,
    { session: caller.session, agent: caller.agent },
  );
}

export interface CallerOptions {
  /** The tools of the peer check (tests give fakes). */
  peerTools?: PeerTools;
}

/** The owner of a process under a git command of awd (see sessionOfPeer). */
const GIT_OF_AWD = "\0git";

/** The refusal of a person route for a process under a git command of awd. */
function gitHookRefusal(what: string): ServiceError {
  return new ServiceError(
    "refused",
    `${what} is an action of a person, and this caller is a process of a git command of awd (a hook of the repository, which an agent can write)`,
  );
}

/**
 * The session of a process of a running session tree, or null. A process under a git command
 * that awd runs (a hook of the repository: a checkpoint or wake push, a worktree add) gives
 * GIT_OF_AWD: the agent can write such a hook, so it never acts as the person (final check
 * fc1-6). A failed check is logged and gives null: the allow rules and the CLI refusal are the
 * first layers, and a failed check must not block the gate answers of the person (design
 * decision 6).
 */
async function sessionOfPeer(
  daemon: Daemon,
  request: FastifyRequest,
  tools: PeerTools,
): Promise<string | null> {
  const panes = daemon.sessions?.runningPanes() ?? [];
  const gits = runningGitPids();
  if (panes.length === 0 && gits.length === 0) return null;
  const started = daemon.clock.now();
  try {
    const roots = new Map<number, string>(panes.map((p) => [p.pid, p.session]));
    for (const pid of gits) if (!roots.has(pid)) roots.set(pid, GIT_OF_AWD);
    // The process table first: on macOS, lsof then lists only the sockets of the session trees.
    // The peer of this connection runs already, so it is in the table.
    const parents = await parentTable(tools);
    const candidates = descendants(roots.keys(), parents);
    const pid = await peerPid(request.raw.socket, tools, candidates);
    if (pid === null) {
      if (tools.platform !== "darwin") {
        request.log.warn(
          "The peer check found no process for this connection: caller is the person",
        );
      }
      return null;
    }
    return ancestorIn(pid, parents, roots);
  } catch (error) {
    request.log.warn({ err: error }, "The peer check failed: caller is the person");
    return null;
  } finally {
    const ms = daemon.clock.now() - started;
    if (ms >= SLOW_PEER_CHECK_MS) request.log.warn({ ms }, "The peer check was slow");
    else request.log.debug({ ms }, "The peer check ended");
  }
}

/** Adds the caller hook to the local API. */
export function registerCallerRule(
  app: FastifyInstance<RawServerDefault, IncomingMessage, ServerResponse, Logger>,
  daemon: Daemon,
  options: CallerOptions = {},
): void {
  const tools = options.peerTools ?? systemPeerTools;
  app.decorateRequest("caller", null);
  app.addHook("onRequest", async (request) => {
    // No route (the not-found reply) changes nothing: a read.
    const access =
      request.routeOptions.url === undefined
        ? "read"
        : routeAccess(request.method, request.routeOptions.config.access);
    const token = bearerToken(request.headers.authorization);
    let caller: RequestCaller = null;
    if (request.headers.authorization !== undefined) {
      if (!daemon.sessions) {
        throw new ServiceError(
          "unauthorized",
          "Sessions are off on this device: no token is valid",
        );
      }
      caller = daemon.sessions.callerOfToken(token);
    } else if ((access === "person" || access === "caller") && daemon.sessions) {
      const session = await sessionOfPeer(daemon, request, tools);
      if (session === GIT_OF_AWD) {
        throw gitHookRefusal(`${request.method} ${request.routeOptions.url ?? request.url}`);
      }
      if (session !== null) caller = daemon.sessions.caller(session);
    }
    request.caller = caller;
    if (access === "person" && caller) {
      throw personOnly(`${request.method} ${request.routeOptions.url ?? request.url}`, caller);
    }
    if (access === "agent") {
      const path = (request.params as { session?: unknown }).session;
      if (!caller) {
        throw new ServiceError(
          "refused",
          "An agent command needs the token of its session (AW_MCP_TOKEN). Run it inside the AW session.",
        );
      }
      if (caller.session !== path) {
        throw new ServiceError("refused", `The token belongs to the session ${caller.session}`, {
          session: caller.session,
        });
      }
    }
  });
}
