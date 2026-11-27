// Route tests of GET /v1/workspaces/{ws}/tasks/{task}/terminal (openspec task-terminal-view): the
// newest snapshot of a session on another device, the Orca note, the targets of "Open the terminal"
// and "Sign in" (local argv, remote command), and the caller rule (a person route).
import { AwApiError, AwClient } from "@aw/client";
import { DesktopClient } from "@aw/client/desktop";
import type { WorkspaceFiles } from "@aw/core";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTerminal } from "../cli/terminal.ts";
import { terminalView } from "../service/terminal.ts";
import type { LocalTerminal } from "../sessions/manager.ts";
import { sessionsRoot } from "../sessions/records.ts";
import { snapshotPath, snapshotText } from "../sessions/terminal-snapshot.ts";
import { otherDevice, startTestDaemon, type TestDaemon } from "../testing.ts";

let d: TestDaemon;
afterEach(async () => {
  await d.close();
});

const identity = (text: string) => text;

async function create(assignee: string) {
  const { task } = await d.client.createTask("-", {
    project: "billing-api",
    title: "Call the staging API",
    first_message: "m",
    assignee,
  });
  return task;
}

/** The claim and the session start of a device, and optionally its snapshot. */
async function session(
  files: WorkspaceFiles,
  device: string,
  task: string,
  host: "tmux" | "orca",
  snapshot?: { at: string; screen: string; socket: string },
  workIn?: "worktree" | "checkout",
) {
  const id = files.newId();
  const meta = { task, by: `aw@${device}` };
  const log = `tasks/${task}/log/${device}.jsonl`;
  await files.writeEvent(log, "task.claimed", { epoch: 1, device, session: id }, meta);
  await files.writeEvent(
    log,
    "session.started",
    { session: id, host, cwd: "/w", ...(workIn ? { work_in: workIn } : {}) },
    meta,
  );
  if (snapshot) {
    const text = snapshotText(
      {
        device,
        session: id,
        host,
        socket: snapshot.socket,
        window: `aw-${task}`,
        captured_at: snapshot.at,
      },
      snapshot.screen,
      identity,
    );
    await files.writeFile(snapshotPath(task, device), text);
  }
  return id;
}

describe("terminal route", () => {
  it("gives the newest snapshot of a remote session and the ssh commands", async () => {
    d = await startTestDaemon({ workspace: true });
    const ubuntu = otherDevice(d.folder, "ubuntu-01");
    const task = await create("claude@ubuntu-01");
    // An older snapshot of this device (an earlier session here) and the new one of ubuntu-01.
    const here = d.server.daemon.workspace().files;
    await here.writeFile(
      snapshotPath(task.id, "macbook-pro"),
      snapshotText(
        {
          device: "macbook-pro",
          session: here.newId(),
          host: "tmux",
          socket: "aw",
          window: `aw-${task.id}`,
          captured_at: "2026-11-23T14:00:00.000Z",
        },
        "old screen",
        identity,
      ),
    );
    await session(ubuntu, "ubuntu-01", task.id, "tmux", {
      at: "2026-11-23T14:20:05.000Z",
      screen: "❯ make test\nok",
      socket: "aw-lab",
    });
    await d.server.daemon.workspace().refresh();

    const reply = await new DesktopClient(d.client).terminal("-", task.key!);
    expect(reply.session).toMatchObject({ device: "ubuntu-01", host: "tmux", local: false });
    expect(reply.snapshot).toMatchObject({
      device: "ubuntu-01",
      host: "tmux",
      captured_at: "2026-11-23T14:20:05.000Z",
      text: "❯ make test\nok",
    });
    expect(reply.note).toBeNull();
    expect(reply.open).toEqual({
      kind: "copy",
      device: "ubuntu-01",
      local: false,
      command: `ssh -t ubuntu-01 tmux -L aw-lab attach -t aw:aw-${task.id}`,
      text: "Run this command to open the terminal of ubuntu-01:",
    });
    expect(reply.sign_in).toMatchObject({
      kind: "copy",
      command: "ssh -t ubuntu-01 claude auth login",
    });
    const text = formatTerminal(reply, Date.parse("2026-11-23T14:23:05.000Z"));
    expect(text.split("\n")[0]).toBe("ubuntu-01 · captured 2026-11-23 14:20:05 UTC (3 min ago)");
    expect(text).toContain("❯ make test\nok");
    expect(text).toContain(`Open the terminal: ssh -t ubuntu-01 tmux -L aw-lab attach -t aw:aw-`);
  });

  it("reads only regular snapshot files with a device name, and never puts a bad socket in the ssh command", async () => {
    d = await startTestDaemon({ workspace: true });
    const ubuntu = otherDevice(d.folder, "ubuntu-01");
    const task = await create("claude@ubuntu-01");
    const folder = join(d.folder, "tasks", task.id, "terminal");
    await mkdir(folder, { recursive: true });
    // A synced header with a shell command in its socket: the remote shell of ssh runs the words.
    await session(ubuntu, "ubuntu-01", task.id, "tmux", {
      at: "2026-11-23T14:20:05.000Z",
      screen: "screen of ubuntu-01",
      socket: "aw;touch${IFS}/tmp/aw-pwned",
    });
    // A planted link to a private file, and a conflict copy with a newer header.
    const secret = join(d.home, "private.txt");
    await writeFile(secret, "PRIVATE KEY TEXT");
    await symlink(secret, join(folder, "mac-mini-lab.txt"));
    await writeFile(
      join(folder, "ubuntu-01.sync-conflict-20261123-142100-ABCDEFG.txt"),
      snapshotText(
        {
          device: "ubuntu-01",
          session: "s",
          host: "tmux",
          socket: "aw",
          window: null,
          captured_at: "2026-11-23T14:21:00.000Z",
        },
        "conflict copy",
        identity,
      ),
    );
    await d.server.daemon.workspace().refresh();

    const reply = await new DesktopClient(d.client).terminal("-", task.key!);
    expect(reply.snapshot).toMatchObject({ device: "ubuntu-01", captured_at: null });
    expect(JSON.stringify(reply)).not.toContain("PRIVATE KEY TEXT");
    expect(JSON.stringify(reply)).not.toContain("conflict copy");
    expect(reply.open).toMatchObject({
      command: `ssh -t ubuntu-01 tmux -L aw attach -t aw:aw-${task.id}`,
    });
  });

  it("says that AW does not read the screen of an Orca session", async () => {
    d = await startTestDaemon({ workspace: true });
    const ubuntu = otherDevice(d.folder, "ubuntu-01");
    const task = await create("claude@ubuntu-01");
    await session(ubuntu, "ubuntu-01", task.id, "orca");
    await d.server.daemon.workspace().refresh();
    const reply = await new DesktopClient(d.client).terminal("-", task.id);
    expect(reply.snapshot).toBeNull();
    expect(reply.note).toBe(
      `AW does not read the screen of an Orca session. Open the Orca worktree aw-${task.id} on ubuntu-01.`,
    );
    expect(reply.open).toMatchObject({ kind: "copy", command: null });
  });

  it("names the project checkout for an Orca session in the checkout", async () => {
    d = await startTestDaemon({ workspace: true });
    const ubuntu = otherDevice(d.folder, "ubuntu-01");
    const task = await create("claude@ubuntu-01");
    await session(ubuntu, "ubuntu-01", task.id, "orca", undefined, "checkout");
    await d.server.daemon.workspace().refresh();
    const reply = await new DesktopClient(d.client).terminal("-", task.id);
    expect(reply.note).toBe(
      "AW does not read the screen of an Orca session. Open the billing-api checkout in Orca on ubuntu-01.",
    );
    expect(reply.open).toMatchObject({
      kind: "copy",
      text: "Open the billing-api checkout in Orca on ubuntu-01.",
    });
  });

  it("gives an argv for a local tmux session, a local Orca session and the sign-in", async () => {
    d = await startTestDaemon({ workspace: true });
    const ws = d.server.daemon.workspace();
    const task = await create("claude@macbook-pro");
    await session(ws.files, "macbook-pro", task.id, "tmux");
    await ws.refresh();
    const local: LocalTerminal = {
      host: "tmux",
      binary: "/opt/homebrew/bin/tmux",
      worktree: "/w",
      socket: "aw-test",
    };
    const sessions = {
      claude: "/usr/local/bin/claude",
      tmuxSocket: "aw-dev",
      localTerminal: vi.fn<(ws: string, task: string) => Promise<LocalTerminal | null>>(() =>
        Promise.resolve(local),
      ),
    };
    const reply = await terminalView(ws, task.id, sessions);
    expect(sessions.localTerminal).toHaveBeenCalledWith(ws.id, task.id);
    expect(reply.note).toBe(
      "No terminal snapshot yet. A tmux session writes one at most every 30 s when its screen changes, and at each gate.",
    );
    expect(reply.open).toEqual({
      kind: "terminal",
      device: "macbook-pro",
      local: true,
      argv: ["/opt/homebrew/bin/tmux", "-L", "aw-test", "attach", "-t", `aw:aw-${task.id}`],
      command: `/opt/homebrew/bin/tmux -L aw-test attach -t aw:aw-${task.id}`,
    });
    expect(reply.sign_in).toEqual({
      kind: "terminal",
      device: "macbook-pro",
      local: true,
      argv: ["/usr/local/bin/claude", "auth", "login"],
      command: "/usr/local/bin/claude auth login",
    });

    const orca: LocalTerminal = {
      host: "orca",
      binary: "/Applications/Orca.app/bin/orca",
      worktree: "/o/aw w",
      socket: null,
    };
    sessions.localTerminal.mockImplementation(() => Promise.resolve(orca));
    const orcaReply = await terminalView(ws, task.id, sessions);
    expect(orcaReply.open).toEqual({
      kind: "orca",
      device: "macbook-pro",
      local: true,
      orca: "/Applications/Orca.app/bin/orca",
      worktree: "/o/aw w",
      command: "/Applications/Orca.app/bin/orca worktree activate --worktree 'path:/o/aw w' --json",
    });
  });

  it("uses the tmux socket of this device for a local session that ended", async () => {
    d = await startTestDaemon({ workspace: true });
    const ws = d.server.daemon.workspace();
    const task = await create("claude@macbook-pro");
    await session(ws.files, "macbook-pro", task.id, "tmux");
    await ws.refresh();
    // No live record (awd restarted) and no snapshot of this device.
    const sessions = {
      claude: "claude",
      tmuxSocket: "aw-dev",
      localTerminal: () => Promise.resolve(null),
    };
    const reply = await terminalView(ws, task.id, sessions);
    expect(reply.open).toMatchObject({
      kind: "terminal",
      argv: ["tmux", "-L", "aw-dev", "attach", "-t", `aw:aw-${task.id}`],
    });
  });

  it("has no target for a task with no session", async () => {
    d = await startTestDaemon({ workspace: true });
    const { task } = await d.client.createTask("-", {
      project: "billing-api",
      title: "t",
      first_message: "m",
    });
    const reply = await new DesktopClient(d.client).terminal("-", task.id);
    expect(reply).toMatchObject({ session: null, snapshot: null, open: null, sign_in: null });
  });

  it("refuses a session token with 403 refused", async () => {
    d = await startTestDaemon({
      workspace: true,
      sessions: true,
      env: { AW_TMUX: "/nonexistent/tmux", AW_CLAUDE: "/nonexistent/claude" },
    });
    const sessionId = "s-fake";
    const ws = d.server.daemon.workspace().id;
    vi.spyOn(d.server.daemon.sessions!, "caller").mockImplementation((id) => {
      if (id !== sessionId) throw new Error(`unknown session ${id}`);
      return { agent: "claude@macbook-pro", session: sessionId, task: "AW-1", workspace: ws };
    });
    await mkdir(join(sessionsRoot(d.home), sessionId), { recursive: true, mode: 0o700 });
    const token = await d.server.daemon.sessions!.tokens.ensure(sessionId);
    const agent = new DesktopClient(new AwClient({ socketPath: d.settings.socketPath, token }));
    const error = await agent.terminal("-", "AW-1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AwApiError);
    expect((error as AwApiError).status).toBe(403);
    expect((error as AwApiError).code).toBe("refused");
  });
});
