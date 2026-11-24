// Route tests of GET /v1/workspaces/{ws}/queues (openspec queue-and-assign): the queue of an agent
// on another device from the merged files, the tasks with no assignee and their creator, and the
// caller rule (a person route: a session caller gets 403 refused).
import { AwApiError, AwClient } from "@aw/client";
import { DesktopClient } from "@aw/client/desktop";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionsRoot } from "../sessions/records.ts";
import { otherDevice, startTestDaemon, type TestDaemon } from "../testing.ts";

let d: TestDaemon;
afterEach(async () => {
  await d.close();
});

async function create(title: string, assignee?: string) {
  const { task } = await d.client.createTask("-", {
    project: "billing-api",
    title,
    first_message: title,
    ...(assignee ? { assignee } : {}),
  });
  return task;
}

describe("queues route", () => {
  it("gives the position and the cause of each queued task of another device", async () => {
    d = await startTestDaemon({ workspace: true });
    const ubuntu = otherDevice(d.folder, "ubuntu-01");
    const date = new Date().toISOString().slice(0, 10);
    await ubuntu.writeEvent(
      `tasks/devices/ubuntu-01/heartbeat/${date}.jsonl`,
      "device.heartbeat",
      { boot_time: new Date().toISOString() },
      { by: "aw@ubuntu-01" },
    );
    await ubuntu.writeDocument("tasks/devices/ubuntu-01/health.yaml", {
      kind: "health",
      schema: 1,
      device: "ubuntu-01",
      updated: ubuntu.hlc.now(),
      boot_time: new Date().toISOString(),
      disk: { used_percentage: 40 },
      queue: { max_working: 2, disk_full_percent: 95, login_valid: true },
    });
    const tasks: { id: string }[] = [];
    for (const n of [1, 2, 3, 4]) tasks.push(await create(`Task ${n}`, "claude@ubuntu-01"));
    for (const task of tasks.slice(0, 2)) {
      const session = ubuntu.newId();
      const meta = { task: task.id, by: "aw@ubuntu-01" };
      const log = `tasks/${task.id}/log/ubuntu-01.jsonl`;
      await ubuntu.writeEvent(
        log,
        "task.claimed",
        { epoch: 1, device: "ubuntu-01", session },
        meta,
      );
      await ubuntu.writeEvent(log, "session.started", { session, host: "tmux", cwd: "/w" }, meta);
    }
    // A subtask of an agent and a task of a person, both with no assignee.
    const subtask = ubuntu.newId();
    await ubuntu.writeEvent(
      `tasks/${subtask}/log/ubuntu-01.jsonl`,
      "task.created",
      {
        key: "AW-5",
        project: "billing-api",
        title: "Write the tests",
        first_message: "Add tests",
        parent: tasks[0]!.id,
      },
      { task: subtask, by: "claude@ubuntu-01" },
    );
    const parked = await create("Parked idea");
    await d.server.daemon.workspace().refresh();

    const reply = await new DesktopClient(d.client).queues("-");
    expect(reply.device).toBe("macbook-pro");
    expect(reply.agents).toEqual([
      {
        agent: "claude@ubuntu-01",
        device: "ubuntu-01",
        max_working: 2,
        working: 2,
        tasks: [3, 4].map((n, i) => ({
          task: tasks[n - 1]!.id,
          key: `AW-${n}`,
          title: `Task ${n}`,
          position: i + 1,
          text: `Queued · ${i === 0 ? "1st" : "2nd"} for claude@ubuntu-01`,
          cause: { code: "max_working", text: "2 sessions working" },
        })),
      },
    ]);
    expect(reply.unassigned).toEqual([
      {
        task: subtask,
        key: "AW-5",
        title: "Write the tests",
        created_by: "claude@ubuntu-01",
        by_agent: true,
      },
      {
        task: parked.id,
        key: parked.key,
        title: "Parked idea",
        created_by: "human@macbook-pro",
        by_agent: false,
      },
    ]);
  });

  it("refuses a session token with 403 refused", async () => {
    d = await startTestDaemon({
      workspace: true,
      sessions: true,
      env: { AW_TMUX: "/nonexistent/tmux", AW_CLAUDE: "/nonexistent/claude" },
    });
    const session = "s-fake";
    const ws = d.server.daemon.workspace().id;
    vi.spyOn(d.server.daemon.sessions!, "caller").mockImplementation((id) => {
      if (id !== session) throw new Error(`unknown session ${id}`);
      return { agent: "claude@macbook-pro", session, task: "AW-1", workspace: ws };
    });
    await mkdir(join(sessionsRoot(d.home), session), { recursive: true, mode: 0o700 });
    const token = await d.server.daemon.sessions!.tokens.ensure(session);
    const agent = new DesktopClient(new AwClient({ socketPath: d.settings.socketPath, token }));
    const error = await agent.queues("-").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AwApiError);
    expect((error as AwApiError).status).toBe(403);
    expect((error as AwApiError).code).toBe("refused");
  });
});
