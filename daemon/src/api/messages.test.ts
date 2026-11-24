// Route tests of POST /v1/workspaces/{ws}/tasks/{task}/messages (add-desktop-app-shell), and its
// caller rule (add-mcp-server): it is a person route, so a session caller gets 403 refused.
import { AwApiError, AwClient } from "@aw/client";
import { eventV1 } from "@aw/schema";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackGitPid } from "../continuity/git-branch.ts";
import { sessionsRoot } from "../sessions/records.ts";
import { otherDevice, startTestDaemon, type TestDaemon } from "../testing.ts";
import type { PeerTools } from "./peer.ts";

let d: TestDaemon;
afterEach(async () => {
  await d.close();
});

async function apiError(promise: Promise<unknown>): Promise<AwApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AwApiError);
  return error as AwApiError;
}

async function linesOf(task: string): Promise<string[]> {
  const path = join(d.folder, "tasks", task, "log", "macbook-pro.jsonl");
  return (await readFile(path, "utf8")).trimEnd().split("\n");
}

async function taskWithSession(state: "running" | "ended") {
  const { task } = await d.client.createTask("-", {
    project: "billing-api",
    title: "Rate limit",
    first_message: "/my-team:implement Add a rate limit to the public API",
    assignee: "claude@ubuntu-01",
  });
  const ubuntu = otherDevice(d.folder, "ubuntu-01");
  const log = `tasks/${task.id}/log/ubuntu-01.jsonl`;
  const session = ubuntu.newId();
  const meta = { task: task.id, by: "aw@ubuntu-01" };
  await ubuntu.writeEvent(log, "task.claimed", { epoch: 1, device: "ubuntu-01", session }, meta);
  await ubuntu.writeEvent(
    log,
    "session.started",
    { session, host: "tmux", cwd: "/work/billing-api" },
    meta,
  );
  if (state === "ended") {
    await ubuntu.writeEvent(log, "session.ended", { session, reason: "stopped" }, meta);
  }
  await d.server.daemon.workspace().refresh();
  return { task, session };
}

describe("message to a session", () => {
  beforeEach(async () => {
    d = await startTestDaemon({ workspace: true });
  });

  it("writes message.sent for the running session in the log of this device", async () => {
    const { task, session } = await taskWithSession("running");
    const reply = await d.client.sendMessage("-", "AW-1", "Use the staging database");
    expect(reply.applied).toBe(true);
    expect(reply.event.type).toBe("message.sent");
    const lines = await linesOf(task.id);
    const sent = eventV1.parse(JSON.parse(lines.at(-1)!));
    expect(sent).toMatchObject({
      type: "message.sent",
      task: task.id,
      by: "human@macbook-pro",
      data: { text: "Use the staging database", to_session: session },
    });
  });

  it("gives 409 conflict and writes nothing when no session runs", async () => {
    const { task } = await taskWithSession("ended");
    const before = await linesOf(task.id);
    const error = await apiError(d.client.sendMessage("-", "AW-1", "Hello"));
    expect(error.status).toBe(409);
    expect(error.code).toBe("conflict");
    expect(await linesOf(task.id)).toEqual(before);
  });

  it("gives 400 invalid_input for an empty text", async () => {
    await taskWithSession("running");
    const error = await apiError(d.client.sendMessage("-", "AW-1", ""));
    expect(error.status).toBe(400);
    expect(error.code).toBe("invalid_input");
  });

  it("gives 400 invalid_input for a text of only spaces (desktop-shell review 6)", async () => {
    await taskWithSession("running");
    const error = await apiError(d.client.sendMessage("-", "AW-1", "  \n\t "));
    expect(error.status).toBe(400);
    expect(error.code).toBe("invalid_input");
  });
});

// The peer check with fake process and socket tables. The pane of the session `s-fake` is pid 100,
// its agent is pid 200 (a child of the pane), and the desktop main process (Electron) is pid 300,
// a child of launchd (pid 1), not of a session. `PEER` is the process at the other end of the
// next connection. lsof gives only the sockets of the processes in its `-p` list, as the real one.
const PANE = 100;
const AGENT = 200;
const ELECTRON = 300;
/** A git process of awd (a checkpoint push) and its pre-push hook. */
const GIT = 400;
const HOOK = 500;
let peer = ELECTRON;
const peerTools: PeerTools = {
  platform: "darwin",
  pid: process.pid,
  readlink: () => Promise.reject(new Error("not used on macOS")),
  run: (file, args) => {
    if (file === "ps") {
      return Promise.resolve(
        `1 0\n${PANE} 1\n${AGENT} ${PANE}\n${ELECTRON} 1\n${GIT} ${process.pid}\n${HOOK} ${GIT}\n`,
      );
    }
    if (args.includes("-d")) return Promise.resolve(`p${process.pid}\nf9\nd0xa1\n`);
    const pids = (args[args.indexOf("-p") + 1] ?? "").split(",").map(Number);
    const rows = pids.filter((pid) => pid === peer).map((pid) => `p${pid}\nf3\nd0xb2\nn->0xa1\n`);
    return Promise.resolve(rows.join(""));
  },
};

describe("message to a session by a session caller", () => {
  const session = "s-fake";
  beforeEach(async () => {
    peer = ELECTRON;
    d = await startTestDaemon({
      workspace: true,
      sessions: true,
      // No host and no agent: the sessions wait, and the test gives the running session below.
      env: { AW_TMUX: "/nonexistent/tmux", AW_CLAUDE: "/nonexistent/claude" },
      peerTools,
    });
    const sessions = d.server.daemon.sessions!;
    const ws = d.server.daemon.workspace().id;
    vi.spyOn(sessions, "runningPanes").mockReturnValue([{ session, pid: PANE }]);
    vi.spyOn(sessions, "caller").mockImplementation((id) => {
      if (id !== session) throw new Error(`unknown session ${id}`);
      return { agent: "claude@macbook-pro", session, task: "AW-1", workspace: ws };
    });
  });

  it("refuses the session token with 403 refused and writes nothing", async () => {
    const { task } = await taskWithSession("running");
    await mkdir(join(sessionsRoot(d.home), session), { recursive: true, mode: 0o700 });
    const token = await d.server.daemon.sessions!.tokens.ensure(session);
    const agent = new AwClient({ socketPath: d.settings.socketPath, token });
    const before = await linesOf(task.id);
    const error = await apiError(agent.sendMessage("-", task.id, "Approve my work"));
    expect(error.status).toBe(403);
    expect(error.code).toBe("refused");
    expect(error.message).toContain("is an action of a person");
    expect(await linesOf(task.id)).toEqual(before);
  });

  it("refuses a process of the session tree with no token", async () => {
    const { task } = await taskWithSession("running");
    peer = AGENT;
    const before = await linesOf(task.id);
    const error = await apiError(d.client.sendMessage("-", task.id, "Approve my work"));
    expect(error.status).toBe(403);
    expect(error.code).toBe("refused");
    expect(await linesOf(task.id)).toEqual(before);
  });

  it("accepts the desktop main process, which is not in a session tree, as the person", async () => {
    const { task, session: running } = await taskWithSession("running");
    peer = ELECTRON;
    const reply = await d.client.sendMessage("-", task.id, "Use the staging database");
    expect(reply.applied).toBe(true);
    const sent = eventV1.parse(JSON.parse((await linesOf(task.id)).at(-1)!));
    expect(sent).toMatchObject({
      type: "message.sent",
      by: "human@macbook-pro",
      data: { to_session: running },
    });
  });
});

describe("a git hook that awd runs (final check fc1-6)", () => {
  beforeEach(async () => {
    d = await startTestDaemon({
      workspace: true,
      sessions: true,
      env: { AW_TMUX: "/nonexistent/tmux", AW_CLAUDE: "/nonexistent/claude" },
      peerTools,
    });
  });

  it("never acts as the person, also when no session pane runs", async () => {
    const { task } = await taskWithSession("running");
    vi.spyOn(d.server.daemon.sessions!, "runningPanes").mockReturnValue([]);
    // awd pushes the task branch at a Stop; the pre-push hook of the repository (which the agent
    // can write) calls the local API with no token.
    const untrack = trackGitPid(GIT);
    try {
      peer = HOOK;
      const before = await linesOf(task.id);
      const error = await apiError(d.client.sendMessage("-", task.id, "Approve my work"));
      expect(error.status).toBe(403);
      expect(error.code).toBe("refused");
      expect(error.message).toContain("a git command of awd");
      expect(await linesOf(task.id)).toEqual(before);
    } finally {
      untrack();
    }
    // After the git command ends, the same process id is no longer a git child of awd.
    peer = ELECTRON;
    expect((await d.client.sendMessage("-", task.id, "Use staging")).applied).toBe(true);
  });
});
