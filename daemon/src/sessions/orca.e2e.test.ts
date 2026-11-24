// End-to-end tests of the Orca session host (add-orca-session-host): awd, aw-launch, the fake
// claude and the fake Orca CLI, whose terminals run in a private tmux server. With
// AW_E2E_ORCA=1 and AW_ORCA=<the Orca CLI> the same tests run against a real Orca; then
// AW_E2E_ORCA_STOP and AW_E2E_ORCA_START are the shell commands that stop and start the Orca
// runtime. Use a private Orca runtime (ORCA_USER_DATA_PATH), never the Orca app of a person.
import { DesktopClient } from "@aw/client/desktop";
import { execa } from "execa";
import { existsSync } from "node:fs";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listRecords, sessionPaths } from "./records.ts";
import { startSessionDaemon, TEST_TMUX, waitFor, type SessionTestDaemon } from "./testing.ts";

const REAL = process.env.AW_E2E_ORCA === "1";
const ORCA = REAL ? (process.env.AW_ORCA ?? "") : "fake";

let awd: SessionTestDaemon | null = null;

afterEach(async () => {
  await awd?.close();
  awd = null;
});

const text = (row: { event: unknown }) =>
  String((row.event as { data: { text?: string } }).data.text ?? "");
const data = (row: { event: unknown }) => (row.event as { data: Record<string, unknown> }).data;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function orcaDown(d: SessionTestDaemon): Promise<void> {
  if (REAL) await execa("sh", ["-c", process.env.AW_E2E_ORCA_STOP ?? "false"]);
  else await writeFile(join(d.orcaState!, "down"), "");
}

async function orcaUp(d: SessionTestDaemon): Promise<void> {
  if (REAL) await execa("sh", ["-c", process.env.AW_E2E_ORCA_START ?? "false"]);
  else await rm(join(d.orcaState!, "down"));
}

async function record(d: SessionTestDaemon, task: string) {
  const found = (await listRecords(d.home)).find((r) => r.task === task);
  if (!found) throw new Error(`No session record of ${task}`);
  return found;
}

describe.skipIf(!TEST_TMUX || (REAL && !ORCA))("sessions in Orca with the fake agent", () => {
  it("starts in an Orca worktree, delivers a 2-line answer with terminal send, and stops the process group", async () => {
    awd = await startSessionDaemon({ orca: ORCA });
    const task = await awd.createTask("ask Which limit per client? | 100/min|1000/min");
    const started = await awd.waitRow(task.id, (r) => r.type === "session.started", 40_000);
    expect(data(started)).toMatchObject({ host: "orca" });
    const opened = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "question",
    );
    const gate = String(data(opened).gate);
    const session = await record(awd, task.id);
    expect(session.host).toBe("orca");
    expect(session.pane).toMatchObject({
      host: "orca",
      pane: expect.stringMatching(/^term_/) as unknown,
    });
    // The Orca worktree, not the git worktree of the tmux host.
    expect(session.cwd).not.toContain(join(awd.home, "worktrees"));
    // The Orca worktree has the key in its name (session-options, ux-1).
    expect(session.cwd.endsWith(`aw-${task.key}`)).toBe(true);
    expect(session.branch).toBe(`aw/${task.key}`);
    const shown = await awd.orca!.find(session.pane!);
    expect(shown).toMatchObject({ dead: false, pid: session.pane!.pid });
    const info = awd.server.daemon.sessions!.list().find((s) => s.task === task.id);
    expect(info).toMatchObject({ host: "orca" });

    await awd.answerFrom("pixel-9", task.id, gate, "1000/min\nper client");
    const human = await awd.waitRow(
      task.id,
      (r) => r.type === "message.human" && data(r).source === "answer",
    );
    // One prompt with both lines: Orca bracket-pastes the text for the agent.
    expect(data(human)).toMatchObject({
      delivery_id: gate,
      text: `[AW answer ${gate}] 1000/min\nper client`,
    });
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("Got: 1000/min"),
    );
    await awd.waitChecks(awd.session(task.id), 3);
    const rows = await awd.rows(task.id);
    expect(
      rows.filter((r) => r.type === "message.human" && data(r).delivery_id === gate),
    ).toHaveLength(1);

    const stop = await awd.aw(["session", "stop", session.id]);
    expect(stop.code).toBe(0);
    await awd.waitRow(task.id, (r) => r.type === "session.ended" && data(r).reason === "stopped");
    await waitFor(() => Promise.resolve(!alive(session.pane!.pid)), 10_000);
    const closed = await awd.orca!.find(session.pane!);
    expect(closed?.dead ?? true).toBe(true);
    expect(await awd.orca!.alive(session.pane!)).toBe(false);
  }, 120_000);

  it("gives the agent in Orca the MCP variables and the credential files, with no token in a command line", async () => {
    awd = await startSessionDaemon({ orca: ORCA });
    const SECRET = "sk_test_orca_launch_4242";
    const added = await awd.aw(["credential", "add", "stripe-test"], {
      stdin: () => Promise.resolve(`${SECRET}\n`),
    });
    expect(added.code).toBe(0);
    // The fake agent expands the plugin .mcp.json with the AW_MCP_URL and AW_MCP_TOKEN that
    // aw-launch read from AW_HOME: the Orca command line has only AW_NODE, AW_HOME and the session.
    const created = await awd.client.createTask("-", {
      project: "billing-api",
      title: "MCP in Orca",
      first_message: 'mcp stage {"text":"From Orca"}',
      assignee: "claude@macbook-pro",
      credentials: ["stripe-test"],
      session_host: "orca",
    });
    const task = created.task.id;
    const started = await awd.waitRow(task, (r) => r.type === "session.started", 40_000);
    expect(data(started)).toMatchObject({ host: "orca" });
    await awd.waitRow(task, (r) => r.type === "task.progress" && text(r) === "From Orca");
    const reply = await awd.waitRow(
      task,
      (r) => r.type === "message.agent" && text(r).startsWith("MCP "),
    );
    expect(text(reply)).toMatch(/^MCP result /);
    const session = await record(awd, task);
    expect(session.host).toBe("orca");
    // The launch file of aw-launch gives the agent the credentials folder (add-task-loop).
    const launch = JSON.parse(
      await readFile(sessionPaths(awd.home, session.id).launch, "utf8"),
    ) as {
      env: Record<string, string>;
    };
    const dir = join(awd.home, "sessions", session.id, "credentials");
    expect(launch.env.AW_CREDENTIALS_DIR).toBe(dir);
    expect(await readFile(join(dir, "stripe-test"), "utf8")).toBe(SECRET);
    expect((await stat(join(dir, "stripe-test"))).mode & 0o777).toBe(0o600);
    const token = await awd.token(session.id);
    const ps = await execa("ps", ["-A", "-o", "args="]);
    expect(ps.stdout).not.toContain(token);
    expect(ps.stdout).not.toContain(SECRET);
  }, 120_000);

  it("ends a done session in Orca: stops the agent and closes its Orca terminal (add-task-loop)", async () => {
    awd = await startSessionDaemon({ orca: ORCA });
    const task = await awd.createTask("reply ready in Orca");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r) === "ready in Orca",
      40_000,
    );
    const session = await record(awd, task.id);
    expect(session.host).toBe("orca");
    await writeFile(join(session.cwd, "r.md"), "# Result");
    await awd.sendMessage("pixel-9", task.id, session.id, 'mcp result {"path":"r.md"}');
    const gate = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_result",
    );
    await awd.answerFrom("pixel-9", task.id, String(data(gate).gate), "Approve");
    await awd.waitRow(task.id, (r) => r.type === "session.ended" && data(r).reason === "done");
    await waitFor(async () => (await record(awd!, task.id)).state === "ended", 10_000);
    await waitFor(() => Promise.resolve(!alive(session.pane!.pid)), 10_000);
    const closed = await awd.orca!.find(session.pane!);
    expect(closed?.dead ?? true).toBe(true);
  }, 120_000);

  it("keeps the session while the Orca runtime is down, says so once, and delivers after it is back", async () => {
    awd = await startSessionDaemon({ orca: ORCA, hostNoticeMs: 3000 });
    const task = await awd.createTask("reply ready");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("ready"),
      40_000,
    );
    const session = await record(awd, task.id);
    await orcaDown(awd);
    let up = false;
    try {
      // 24 checks are 12 s: they hold 2 full pane checks (every 5 s) or more. A session that AW
      // took for dead would get 2 resumes in that time, and then "Resume failed".
      await awd.waitChecks(session.id, 24);
      expect(alive(session.pane!.pid)).toBe(true);
      const info = awd.server.daemon.sessions!.list().find((x) => x.id === session.id);
      expect(info).toMatchObject({ state: "running", resumes: 0 });
      // A stop while Orca does not answer: 503 not_ready, and the session still runs.
      await expect(awd.client.stopSession(session.id)).rejects.toMatchObject({
        status: 503,
        code: "not_ready",
      });
      expect(alive(session.pane!.pid)).toBe(true);
      const notices = (await awd.rows(task.id)).filter(
        (r) =>
          r.type === "comment.added" && text(r).startsWith("Orca does not answer on macbook-pro"),
      );
      expect(notices).toHaveLength(1);
      expect(text(notices[0]!)).toContain("the session waits");
      const message = await awd.sendMessage("pixel-9", task.id, session.id, "after the restart");
      await awd.waitChecks(session.id, 4);
      await orcaUp(awd);
      up = true;
      await awd.waitRow(
        task.id,
        (r) => r.type === "message.human" && data(r).delivery_id === message,
        40_000,
      );
      await awd.waitRow(
        task.id,
        (r) => r.type === "message.agent" && text(r).includes("Got: after the restart"),
      );
      await awd.waitRow(
        task.id,
        (r) =>
          r.type === "comment.added" && text(r).startsWith("Orca answers again on macbook-pro"),
      );
    } finally {
      if (!up) await orcaUp(awd);
    }
    const rows = await awd.rows(task.id);
    expect(rows.filter((r) => r.type === "session.resumed")).toHaveLength(0);
    expect(rows.filter((r) => r.type === "session.ended")).toHaveLength(0);
    expect(rows.filter((r) => r.type === "session.started")).toHaveLength(1);
    expect(rows.some((r) => r.type === "comment.added" && text(r).includes("Resume failed"))).toBe(
      false,
    );
    expect((await record(awd, task.id)).pane).toEqual(session.pane);
  }, 120_000);

  it("waits for the end of a busy turn before it sends a text to Orca", async () => {
    awd = await startSessionDaemon({ orca: ORCA });
    const task = await awd.createTask("wait 4000");
    // The UserPromptSubmit of the first prompt is in the log: the hooks say the agent is busy.
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.human" && data(r).source === "first",
      40_000,
    );
    const session = await record(awd, task.id);
    const message = await awd.sendMessage("pixel-9", task.id, session.id, "after the turn");
    // 4 checks are 2 s: the turn of 4 s still runs, and the hooks say the agent is busy.
    await awd.waitChecks(session.id, 4);
    if (!REAL) {
      const state = JSON.parse(await readFile(join(awd.orcaState!, "state.json"), "utf8")) as {
        sends?: { text: string }[];
      };
      expect((state.sends ?? []).filter((x) => x.text.includes("after the turn"))).toEqual([]);
    }
    const stop = await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("Waited 4000 ms"),
    );
    const human = await awd.waitRow(
      task.id,
      (r) => r.type === "message.human" && data(r).delivery_id === message,
      40_000,
    );
    expect(human.hlc > stop.hlc).toBe(true);
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("Got: after the turn"),
    );
  }, 120_000);

  it("delivers an answer that came while the agent was down only after the SessionStart of the new terminal,", async () => {
    // The fake claude loads for 3 s before it reads input: a text sent then arrives raw.
    awd = await startSessionDaemon({
      orca: ORCA,
      fakeEnv: { FAKE_CLAUDE_START_DELAY_MS: "3000" },
    });
    const task = await awd.createTask("ask Which limit per client? | 100/min|1000/min");
    const opened = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "question",
      40_000,
    );
    const gate = String(data(opened).gate);
    const session = await record(awd, task.id);
    // The agent stops (a crash): its group gets SIGKILL. The answer comes before the resume.
    process.kill(-session.pane!.pgid, "SIGKILL");
    await awd.answerFrom("pixel-9", task.id, gate, "1000/min\nper client");
    await awd.waitRow(task.id, (r) => r.type === "session.resumed", 40_000);
    const human = await awd.waitRow(
      task.id,
      (r) => r.type === "message.human" && data(r).delivery_id === gate,
      40_000,
    );
    // One input with both lines: AW waited for the SessionStart, so the paste was bracketed.
    expect(data(human)).toMatchObject({ text: `[AW answer ${gate}] 1000/min\nper client` });
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("Got: 1000/min"),
    );
    const resumed = await record(awd, task.id);
    expect(resumed.pane!.pane).not.toBe(session.pane!.pane);
    expect(resumed.ready_pane).toBe(resumed.pane!.pane);
    const rows = await awd.rows(task.id);
    expect(
      rows.filter((r) => r.type === "message.human" && data(r).delivery_id === gate),
    ).toHaveLength(1);
    expect(rows.some((r) => r.type === "message.human" && text(r) === "per client")).toBe(false);
  }, 150_000);

  it("writes one comment when the agent in Orca sends no SessionStart in time", async () => {
    // The fake claude loads for 6 s: longer than the notice time of 2 s.
    awd = await startSessionDaemon({
      orca: ORCA,
      hostNoticeMs: 2000,
      fakeEnv: { FAKE_CLAUDE_START_DELAY_MS: "6000" },
    });
    const task = await awd.createTask("reply late start");
    const notice = await awd.waitRow(
      task.id,
      (r) => r.type === "comment.added" && text(r).startsWith("The agent did not start in 2 s"),
      40_000,
    );
    expect(text(notice)).toContain(`Open the Orca worktree aw-${task.id}`);
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("late start"),
      40_000,
    );
    await awd.waitChecks(awd.session(task.id), 4);
    expect(
      (await awd.rows(task.id)).filter(
        (r) => r.type === "comment.added" && text(r).startsWith("The agent did not start"),
      ),
    ).toHaveLength(1);
  }, 120_000);

  it("runs the session in tmux with one comment when the Claude Code version is not covered", async () => {
    awd = await startSessionDaemon({ orca: ORCA, claudeVersion: "2.2.0" });
    const task = await awd.createTask("reply uncovered");
    const started = await awd.waitRow(task.id, (r) => r.type === "session.started", 40_000);
    expect(data(started)).toMatchObject({ host: "tmux" });
    const comments = (await awd.rows(task.id)).filter(
      (r) => r.type === "comment.added" && text(r).startsWith("Orca needs a Claude Code version"),
    );
    expect(comments).toHaveLength(1);
    expect(text(comments[0]!)).toContain("2.2.0");
    expect(text(comments[0]!)).toContain("AW starts the session in tmux");
    expect((await record(awd, task.id)).host).toBe("tmux");
  }, 120_000);

  it("picks the host by the task, then the checkout, then use_orca", async () => {
    awd = await startSessionDaemon({ orca: ORCA });
    await awd.server.daemon
      .workspace()
      .files.writeDocument("tasks/devices/macbook-pro/bindings.yaml", {
        kind: "bindings",
        schema: 1,
        device: "macbook-pro",
        may_run: true,
        use_orca: true,
        checkouts: [{ project: "billing-api", path: awd.checkout, session_host: "tmux" }],
      });
    // The checkout asks for tmux: it wins over use_orca.
    const byCheckout = await awd.createTask("reply checkout");
    const first = await awd.waitRow(byCheckout.id, (r) => r.type === "session.started", 40_000);
    expect(data(first)).toMatchObject({ host: "tmux" });
    // The task asks for Orca at the create, and the assignment names no host: the task wins.
    const created = await awd.client.createTask("-", {
      project: "billing-api",
      title: "Assigned later",
      first_message: "reply assigned later",
      session_host: "orca",
    });
    const later = created.task as unknown as { id: string };
    await awd.client.assignTask("-", later.id, "claude@macbook-pro");
    const second = await awd.waitRow(later.id, (r) => r.type === "session.started", 40_000);
    expect(data(second)).toMatchObject({ host: "orca" });
    expect((await record(awd, later.id)).host).toBe("orca");
  }, 120_000);

  it("gives the desktop the Orca state of this device and its use_orca (integrate-ui)", async () => {
    awd = await startSessionDaemon({ orca: ORCA });
    const reply = await new DesktopClient(awd.client).sessionHosts("-");
    const me = reply.devices.find((e) => e.device === reply.device);
    expect(me).toMatchObject({
      use_orca: true,
      orca: { available: true, reason: null, version: expect.any(String) as unknown },
    });
  }, 60_000);

  it("runs in tmux with one comment when Orca is off, and when a task asks for tmux", async () => {
    awd = await startSessionDaemon({ orca: ORCA, useOrca: false });
    const asked = await awd.createTask("reply in tmux", "orca");
    const started = await awd.waitRow(asked.id, (r) => r.type === "session.started", 40_000);
    expect(data(started)).toMatchObject({ host: "tmux" });
    const comments = (await awd.rows(asked.id)).filter(
      (r) => r.type === "comment.added" && text(r).startsWith("Orca is off on macbook-pro"),
    );
    expect(comments).toHaveLength(1);
    expect(text(comments[0]!)).toContain("AW starts the session in tmux");
    expect((await record(awd, asked.id)).host).toBe("tmux");
  }, 120_000);

  it("keeps the branch and the folder of a task that moves from Orca to tmux", async () => {
    awd = await startSessionDaemon({ orca: ORCA });
    const task = await awd.createTask("reply first host");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("first host"),
      40_000,
    );
    const first = await record(awd, task.id);
    expect(first.host).toBe("orca");
    expect((await awd.aw(["session", "stop", first.id])).code).toBe(0);
    await awd.waitRow(task.id, (r) => r.type === "session.ended");
    // The branch stays checked out in the Orca worktree: a tmux session runs there (also when
    // Orca is down and AW falls back to tmux).
    await awd.client.assignTask("-", task.id, "claude@macbook-pro", "tmux");
    await awd.waitRow(
      task.id,
      (r) => r.type === "session.started" && data(r).host === "tmux",
      40_000,
    );
    const second = (await listRecords(awd.home)).find(
      (r) => r.task === task.id && r.state === "running",
    )!;
    expect(second).toMatchObject({ host: "tmux", cwd: first.cwd, branch: first.branch });
    // The agent of the second session runs in that folder: it answers the first message again.
    await waitFor(
      async () =>
        (await awd!.rows(task.id)).filter(
          (r) => r.type === "message.agent" && text(r).includes("first host"),
        ).length >= 2,
      40_000,
    );
    const rows = await awd.rows(task.id);
    expect(rows.some((r) => r.type === "comment.added" && text(r).includes("did not start"))).toBe(
      false,
    );
    expect(rows.filter((r) => r.type === "session.started").map((r) => data(r).branch)).toEqual([
      first.branch,
      first.branch,
    ]);
  }, 150_000);

  it("starts no second agent for a task assigned again while Orca does not answer", async () => {
    awd = await startSessionDaemon({ orca: ORCA });
    const task = await awd.createTask("reply first agent");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("first agent"),
      40_000,
    );
    const first = await record(awd, task.id);
    await orcaDown(awd);
    let up = false;
    try {
      // tmux, as after the 60 s detect cache: the new session would run in the Orca worktree of
      // the task, next to the agent that AW cannot stop.
      await awd.client.assignTask("-", task.id, "claude@macbook-pro", "tmux");
      const wait = await awd.waitRow(
        task.id,
        (r) => r.type === "comment.added" && text(r).startsWith("The new session waits"),
        40_000,
      );
      expect(text(wait)).toContain(`the session ${first.id} of this task still runs`);
      expect(text(wait)).toContain("does not answer");
      await awd.waitChecks(first.id, 10);
      expect(alive(first.pane!.pid)).toBe(true);
      const rows = await awd.rows(task.id);
      expect(rows.filter((r) => r.type === "session.started")).toHaveLength(1);
      expect(
        rows.filter((r) => r.type === "comment.added" && text(r).startsWith("The new session")),
      ).toHaveLength(1);
      expect((await listRecords(awd.home)).filter((r) => r.task === task.id)).toHaveLength(1);
      await orcaUp(awd);
      up = true;
    } finally {
      if (!up) await orcaUp(awd);
    }
    // Orca answers again: AW stops the first agent, then starts the new session.
    await awd.waitRow(
      task.id,
      (r) => r.type === "session.ended" && data(r).reason === "replaced",
      40_000,
    );
    await awd.waitRow(
      task.id,
      (r) => r.type === "session.started" && data(r).host === "tmux",
      40_000,
    );
    await waitFor(() => Promise.resolve(!alive(first.pane!.pid)), 10_000);
    const running = (await listRecords(awd.home)).filter(
      (r) => r.task === task.id && r.state === "running",
    );
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({ host: "tmux", cwd: first.cwd, branch: first.branch });
  }, 150_000);

  it("keeps a task that ran in tmux in its folder and branch when it asks for Orca", async () => {
    awd = await startSessionDaemon({ orca: ORCA });
    const task = await awd.createTask("reply tmux first", "tmux");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("tmux first"),
      40_000,
    );
    const first = await record(awd, task.id);
    expect(first.cwd).toBe(join(awd.home, "worktrees", `aw-${task.key}`));
    expect((await awd.aw(["session", "stop", first.id])).code).toBe(0);
    await awd.waitRow(task.id, (r) => r.type === "session.ended");
    await awd.client.assignTask("-", task.id, "claude@macbook-pro", "orca");
    const notice = await awd.waitRow(
      task.id,
      (r) => r.type === "comment.added" && text(r).startsWith(`The branch ${first.branch}`),
      40_000,
    );
    expect(text(notice)).toContain("AW starts the session in tmux");
    const started = (await awd.rows(task.id)).filter((r) => r.type === "session.started");
    await awd.waitRow(
      task.id,
      (r) => r.type === "session.started" && !started.some((x) => x.id === r.id),
      40_000,
    );
    const second = (await listRecords(awd.home)).find(
      (r) => r.task === task.id && r.state === "running",
    )!;
    expect(second).toMatchObject({ host: "tmux", cwd: first.cwd, branch: first.branch });
    // No second branch `aw/<key>-2` that the task would not show.
    const branches = await execa("git", [
      "-C",
      awd.checkout,
      "branch",
      "--list",
      `${first.branch}*`,
    ]);
    expect(branches.stdout.trim().split("\n")).toHaveLength(1);
  }, 150_000);

  it("runs a task that asks for tmux in tmux on a device with Orca on", async () => {
    awd = await startSessionDaemon({ orca: ORCA });
    const task = await awd.createTask("reply in tmux", "tmux");
    const started = await awd.waitRow(task.id, (r) => r.type === "session.started", 40_000);
    expect(data(started)).toMatchObject({ host: "tmux" });
    expect(
      (await awd.rows(task.id)).some(
        (r) => r.type === "comment.added" && text(r).startsWith("Orca"),
      ),
    ).toBe(false);
    expect((await record(awd, task.id)).cwd).toBe(join(awd.home, "worktrees", `aw-${task.key}`));
  }, 120_000);
});

describe.skipIf(!TEST_TMUX || REAL)("another incarnation of the Orca terminal", () => {
  it("closes the old terminal with no signal and resumes in a new one", async () => {
    awd = await startSessionDaemon({ orca: "fake" });
    const task = await awd.createTask("reply first run");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("first run"),
      40_000,
    );
    const session = await record(awd, task.id);
    const file = join(awd.orcaState!, "state.json");
    const state = JSON.parse(await readFile(file, "utf8")) as {
      terminals: { handle: string; incarnationId: string; closed: boolean }[];
    };
    // Orca now runs another process in the stored terminal: the stored pids are not true for it.
    state.terminals.find((t) => t.handle === session.pane!.pane)!.incarnationId =
      "00000000-0000-0000-0000-000000000000";
    await writeFile(file, JSON.stringify(state, null, 2));
    await awd.waitRow(task.id, (r) => r.type === "session.resumed", 40_000);
    const after = JSON.parse(await readFile(file, "utf8")) as typeof state;
    expect(after.terminals.find((t) => t.handle === session.pane!.pane)?.closed).toBe(true);
    const resumed = await record(awd, task.id);
    expect(resumed.pane!.pane).not.toBe(session.pane!.pane);
    expect(after.terminals.find((t) => t.handle === resumed.pane!.pane)?.closed).toBe(false);
  }, 120_000);
});

describe.skipIf(!TEST_TMUX || REAL)("an Orca stop whose close fails", () => {
  it("stops the session and never resumes the agent", async () => {
    awd = await startSessionDaemon({ orca: "fake" });
    const task = await awd.createTask("reply close fails");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("close fails"),
      40_000,
    );
    const session = await record(awd, task.id);
    await writeFile(join(awd.orcaState!, "fail-next-close"), "");
    const stop = await awd.aw(["session", "stop", session.id]);
    expect(stop.code).toBe(0);
    await awd.waitRow(task.id, (r) => r.type === "session.ended" && data(r).reason === "stopped");
    expect(existsSync(join(awd.orcaState!, "fail-next-close"))).toBe(false);
    await waitFor(() => Promise.resolve(!alive(session.pane!.pid)), 10_000);
    expect((await record(awd, task.id)).state).toBe("stopped");
    // 12 checks are 6 s: they hold a pane check (every 5 s). A running record would resume it.
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const rows = await awd.rows(task.id);
    expect(rows.filter((r) => r.type === "session.resumed")).toHaveLength(0);
  }, 120_000);
});

describe.skipIf(!TEST_TMUX || REAL)("an Orca that is too old", () => {
  it("runs the session in tmux with the cause", async () => {
    awd = await startSessionDaemon({ orca: "fake", orcaVersion: "1.4.200" });
    const task = await awd.createTask("reply old orca");
    await awd.waitRow(
      task.id,
      (r) => r.type === "session.started" && data(r).host === "tmux",
      40_000,
    );
    const comment = (await awd.rows(task.id)).find(
      (r) => r.type === "comment.added" && text(r).startsWith("Orca is not available"),
    );
    expect(text(comment!)).toContain("older than 1.4.257");
    expect(existsSync(join(awd.home, "worktrees", `aw-${task.key}`))).toBe(true);
  }, 120_000);
});

describe.skipIf(!TEST_TMUX || REAL)("continuity in Orca (integrate-continuity)", () => {
  it("applies the resume limit to an Orca session and names the Orca worktree in Take over terminal", async () => {
    awd = await startSessionDaemon({
      orca: "fake",
      fakeEnv: { FAKE_CLAUDE_EXIT_AFTER_START: "1" },
    });
    const task = await awd.createTask("reply never in orca");
    const comment = await awd.waitRow(
      task.id,
      (r) => r.type === "comment.added" && text(r).startsWith("Resume failed"),
      60_000,
    );
    expect(text(comment)).toMatch(/no progress after 2 resumes/);
    expect(text(comment)).toContain(`Open the Orca worktree aw-${task.id}`);
    expect(text(comment)).not.toContain("tmux");
    const gate = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "take_over_terminal",
    );
    expect(text(gate)).toContain(`Open the Orca worktree aw-${task.id}`);
    expect(data(gate).options).toEqual(["Resume again", "Leave it stopped"]);
    const rows = await awd.rows(task.id);
    expect(rows.find((r) => r.type === "session.started")).toMatchObject({
      event: { data: { host: "orca" } },
    });
    expect((await record(awd, task.id)).state).toBe("failed");
  }, 90_000);

  it("pauses an Orca session at a usage limit and resumes it when the agent works again", async () => {
    awd = await startSessionDaemon({ orca: "fake" });
    const task = await awd.createTask("reply usage in orca");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("usage in orca"),
      40_000,
    );
    const session = (await record(awd, task.id)).id;
    await awd.sendMessage("pixel-9", task.id, session, "stop-failure rate_limit");
    const paused = await awd.waitRow(task.id, (r) => r.type === "task.paused", 40_000);
    expect(data(paused)).toMatchObject({ cause: "usage_limit", needs_human: false });
    await awd.sendMessage("pixel-9", task.id, session, "reply after the limit");
    await awd.waitRow(task.id, (r) => r.type === "task.resumed", 40_000);
    expect((await awd.task(task.id)).paused).toBeNull();
  }, 120_000);
});
