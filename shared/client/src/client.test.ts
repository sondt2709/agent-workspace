// @aw/client against a small HTTP server on a temp socket: the reply parse and the /readyz body.
// The bodies copy real awd replies (daemon/ api.test.ts and service.test.ts, /readyz while a
// workspace does not open, and GET /v1/status).
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AwClient, AwProtocolError } from "./index.ts";

let server: Server | null = null;
let folder: string | null = null;
afterEach(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
  server = null;
  if (folder) await rm(folder, { recursive: true, force: true });
  folder = null;
});

/** A server that answers each request with this status and body, and the awd headers. */
async function fakeAwd(status: number, body: unknown): Promise<AwClient> {
  folder = await mkdtemp(join(tmpdir(), "awc-"));
  const socketPath = join(folder, "awd.sock");
  server = createServer((_request, response) => {
    response.writeHead(status, {
      "content-type": "application/json",
      "x-aw-version": "0.0.0",
      "x-trace-id": "t1",
    });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server!.listen(socketPath, resolve));
  return new AwClient({ socketPath });
}

const notReady = {
  ready: false,
  checks: {
    workspaces: [{ id: "019a0000-0000-7000-8000-000000000001", ready: false, error: "EMFILE" }],
    sync_engine: "not_configured",
    session_host: "not_configured",
    session_agent: "not_configured",
  },
};

describe("AwClient", () => {
  it("returns the /readyz body on 503, with the error of each workspace", async () => {
    const client = await fakeAwd(503, notReady);
    expect(await client.ready()).toEqual(notReady);
  });

  it("throws AwProtocolError when a reply does not match its schema", async () => {
    const client = await fakeAwd(200, { version: "9.0.0", device: "macbook-pro" });
    const error = await client.status().then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AwProtocolError);
    expect((error as Error).message).toContain("GET /v1/status");
  });

  it("reads a session of an older awd with no host as a tmux session", async () => {
    const old = {
      id: "01a2038e-7f00-7000-8000-000000000001",
      workspace: "acme",
      task: "01a2038e-7f00-7000-8000-000000000002",
      key: "AW-1",
      agent: "claude",
      epoch: 1,
      state: "running",
      cwd: "/home/user/.aw/worktrees/01a2038e-7f00-7000-8000-000000000002",
      window: "@1",
      pid: 4242,
      resumes: 0,
    };
    const client = await fakeAwd(200, [old]);
    expect(await client.sessions()).toEqual([{ ...old, host: "tmux" }]);
  });
});
