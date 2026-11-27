// End-to-end tests of the sessions: awd, a real tmux on a private socket, aw-launch and the fake
// claude with the AW plugin hooks (test plan 1 to 3 of the sessions-tmux handoff).
import { hlcMs } from "@aw/core";
import { execa } from "execa";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "../testing.ts";
import { startSessionDaemon, TEST_TMUX, waitFor, type SessionTestDaemon } from "./testing.ts";

let awd: SessionTestDaemon | null = null;

afterEach(async () => {
  await awd?.close();
  awd = null;
});

const text = (row: { event: unknown }) =>
  String((row.event as { data: { text?: string } }).data.text ?? "");
const data = (row: { event: unknown }) => (row.event as { data: Record<string, unknown> }).data;

describe.skipIf(!TEST_TMUX)("sessions with tmux and the fake agent", () => {
  it("asks with aw ask, delivers the answer of another device, and keeps the thread", async () => {
    awd = await startSessionDaemon();
    expect((await awd.client.ready()).checks.session_host).toBe("ok");
    const task = await awd.createTask("ask Which limit per client? | 100/min|1000/min");
    const opened = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "question",
    );
    const gate = String(data(opened).gate);
    expect(data(opened).options).toEqual(["100/min", "1000/min"]);
    expect(opened.event).toMatchObject({ by: "claude@macbook-pro" });
    const claim = await awd.waitRow(task.id, (r) => r.type === "task.claimed");
    expect(data(claim)).toMatchObject({ epoch: 1, device: "macbook-pro" });

    await awd.answerFrom("pixel-9", task.id, gate, "1000/min");
    const human = await awd.waitRow(
      task.id,
      (r) => r.type === "message.human" && data(r).source === "answer",
    );
    expect(data(human)).toMatchObject({ delivery_id: gate, text: `[AW answer ${gate}] 1000/min` });
    expect(human.event).toMatchObject({ by: "human@pixel-9" });
    const reply = await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("Got: 1000/min"),
    );
    // The text of a turn is Session only (openspec agent-pushes-updates).
    expect(data(reply).source).toBe("turn");

    // A second delivery of a confirmed answer would come at the next checks (every 500 ms): wait
    // 3 checks, then count.
    await awd.waitChecks(awd.session(task.id), 3);
    const rows = await awd.rows(task.id);
    const first = rows.find((r) => r.type === "message.human" && data(r).source === "first");
    expect(text(first!)).toBe("ask Which limit per client? | 100/min|1000/min");
    expect(rows.filter((r) => r.type === "gate.resolved")).toHaveLength(1);
    expect(
      rows.filter((r) => r.type === "message.human" && data(r).delivery_id === gate),
    ).toHaveLength(1);
    expect(rows.some((r) => r.type === "session.started")).toBe(true);
    expect((await awd.task(task.id)).stage).toBe("discuss");

    const thread = await awd.aw(["thread", task.key ?? task.id]);
    expect(thread.code).toBe(0);
    expect(thread.stdout).toContain(
      "message.human\n  ask Which limit per client? | 100/min|1000/min",
    );
    expect(thread.stdout).toContain(`message.human\n  [AW answer ${gate}] 1000/min`);
    expect(thread.stdout).toMatch(/message\.agent\n {2}Got: 1000\/min\./);
  }, 60_000);

  it("allows a command when the human answers Allow once, and delivers nothing", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("write allowed.txt hello");
    const opened = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
    );
    const gate = String(data(opened).gate);
    expect(data(opened).request_id).toMatch(/^p-[0-9a-f-]{36}$/);
    expect(data(opened).options).toEqual(["Allow once", "Allow for this task", "Deny"]);
    await awd.answerFrom("pixel-9", task.id, gate, "Allow once");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r) === "I wrote allowed.txt.",
    );
    const cwd = join(awd.home, "worktrees", `aw-${task.key}`);
    expect(await readFile(join(cwd, "allowed.txt"), "utf8")).toBe("hello\n");
    // A delivery would come at the next checks (every 500 ms): wait 3 checks, then look.
    await awd.waitChecks(awd.session(task.id), 3);
    const rows = await awd.rows(task.id);
    expect(rows.some((r) => r.type === "message.human" && data(r).delivery_id === gate)).toBe(
      false,
    );
  }, 60_000);

  it("allows a file tool for this task only on the same file (final check fc1-9)", async () => {
    const d = await startSessionDaemon();
    awd = d;
    const task = await d.createTask("write rule.txt one");
    const opened = await d.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
    );
    await d.answerFrom("pixel-9", task.id, String(data(opened).gate), "Allow for this task");
    await d.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "I wrote rule.txt.");
    const session = d.session(task.id);
    // The same file again: the rule allows it with no gate.
    await d.sendMessage("pixel-9", task.id, session, "write rule.txt two");
    await waitFor(
      async () =>
        (await d.rows(task.id)).filter(
          (r) => r.type === "message.agent" && text(r) === "I wrote rule.txt.",
        ).length >= 2,
      20_000,
    );
    expect(
      (await d.rows(task.id)).filter(
        (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
      ),
    ).toHaveLength(1);
    // Another file: a new gate, the rule does not allow it.
    await d.sendMessage("pixel-9", task.id, session, "write other.txt three");
    const second = await d.waitRow(
      task.id,
      (r) =>
        r.type === "gate.opened" &&
        data(r).kind === "approve_command" &&
        String(data(r).title).includes("other.txt"),
    );
    expect(String(data(second).gate)).not.toBe(String(data(opened).gate));
    expect(existsSync(join(d.home, "worktrees", `aw-${task.key}`, "other.txt"))).toBe(false);
  }, 60_000);

  it("delivers a deny as the next input of the human", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("write denied.txt x");
    const opened = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
    );
    const gate = String(data(opened).gate);
    await awd.answerFrom("pixel-9", task.id, gate, "Deny");
    await awd.waitRow(
      task.id,
      (r) =>
        r.type === "message.agent" &&
        text(r).startsWith("The Write tool was denied: Denied by human@pixel-9: Deny"),
    );
    const human = await awd.waitRow(
      task.id,
      (r) => r.type === "message.human" && data(r).delivery_id === gate,
    );
    expect(text(human)).toBe(`[AW answer ${gate}] Denied by human@pixel-9: Deny`);
    expect(existsSync(join(awd.home, "worktrees", `aw-${task.key}`, "denied.txt"))).toBe(false);
  }, 60_000);

  it("denies after the timeout, and a late Allow approves the retry once", async () => {
    awd = await startSessionDaemon({ permissionTimeoutMs: 1500 });
    const task = await awd.createTask("write late.txt y");
    const opened = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
    );
    const gate = String(data(opened).gate);
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("No answer from the human in 2 s"),
    );
    expect((await awd.task(task.id)).gates.find((g) => g.gate === gate)?.state).toBe("open");
    await awd.answerFrom("pixel-9", task.id, gate, "Allow once");
    const human = await awd.waitRow(
      task.id,
      (r) => r.type === "message.human" && data(r).delivery_id === gate,
    );
    expect(text(human)).toBe(`[AW answer ${gate}] Approved: run it again.`);
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).startsWith("I ran Write again"),
    );
    expect(await readFile(join(awd.home, "worktrees", `aw-${task.key}`, "late.txt"), "utf8")).toBe(
      "y\n",
    );
    const gates = (await awd.rows(task.id)).filter((r) => r.type === "gate.opened");
    expect(gates).toHaveLength(1);
  }, 60_000);

  it("gives each answer only to its own request", async () => {
    awd = await startSessionDaemon({ permissionTimeoutMs: 6000 });
    const task = await awd.createTask("write first.txt 1");
    const first = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
    );
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("No answer"),
      20_000,
    );
    await awd.sendMessage("pixel-9", task.id, awd.session(task.id), "write second.txt 2");
    const second = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command" && r.id !== first.id,
    );
    await awd.answerFrom("pixel-9", task.id, String(data(second).gate), "Allow once");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r) === "I wrote second.txt.",
    );
    const cwd = join(awd.home, "worktrees", `aw-${task.key}`);
    expect(existsSync(join(cwd, "second.txt"))).toBe(true);
    expect(existsSync(join(cwd, "first.txt"))).toBe(false);
    // The new turn ended the wait of the first request: AW closed its gate (openspec stale-gates).
    const closed = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.resolved" && data(r).gate === data(first).gate,
      20_000,
    );
    expect(data(closed).answer).toBe("Denied after 6 s");
    const view = await awd.task(task.id);
    expect(view.gates.find((g) => g.gate === data(first).gate)).toMatchObject({
      state: "resolved",
      answer: "Denied after 6 s",
      answer_event: null,
    });
    expect(data(first).request_id).not.toBe(data(second).request_id);
  }, 60_000);

  it("keeps a permission request across an awd restart, and the answer after it reaches the hook", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("write restart.txt z");
    const opened = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
    );
    const gate = String(data(opened).gate);
    // The stop ends the waiting request with 503 at once (no wait of 120 s); the hook asks again.
    const started = Date.now();
    await awd.restart();
    expect(Date.now() - started).toBeLessThan(10_000);
    await awd.answerFrom("pixel-9", task.id, gate, "Allow once");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r) === "I wrote restart.txt.",
    );
    expect(
      await readFile(join(awd.home, "worktrees", `aw-${task.key}`, "restart.txt"), "utf8"),
    ).toBe("z\n");
    const rows = await awd.rows(task.id);
    expect(rows.filter((r) => r.type === "gate.opened")).toHaveLength(1);
    expect(rows.some((r) => text(r).includes("AW could not ask the human"))).toBe(false);
    // The 503 of the stop is a known state: no error line in the log of awd.
    expect(
      awd.logLines().filter((l) => l.level === 50 && l.msg === "awd stops. Ask again."),
    ).toEqual([]);
    expect(awd.logLines().some((l) => l.msg === "awd stops. Ask again.")).toBe(true);
  }, 60_000);

  it("counts the permission wait from the gate open, also across an awd restart", async () => {
    // A wait of 10 s and a restart at 3 s. Right: the deny comes 10 s after the gate open, or at
    // once after a restart that took longer. Wrong (a new full wait): the deny comes 10 s after the
    // hook asks the new awd, which is after the restart starts. So the deny must come before the
    // restart start + 10 s: the bound leaves up to 7 s for the restart, which is slow under load
    // (fix list 0-44, kb-2), and it does not use the time when the restart ends.
    const waitMs = 10_000;
    awd = await startSessionDaemon({ permissionTimeoutMs: waitMs });
    const task = await awd.createTask("write slow.txt s");
    const opened = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
    );
    const openedMs = hlcMs(opened.hlc);
    await waitFor(() => Date.now() >= openedMs + 3000, 10_000);
    const restartMs = Date.now();
    await awd.restart();
    const denied = await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("No answer from the human in 10 s"),
      30_000,
    );
    const deniedMs = hlcMs(denied.hlc);
    expect(deniedMs).toBeGreaterThanOrEqual(openedMs + waitMs - 50);
    expect(deniedMs).toBeLessThan(restartMs + waitMs);
  }, 60_000);

  it("opens the gate of a Write with 100 KB of content, and keeps only a hash of the input", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("write-large large.txt 100000");
    const opened = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
    );
    expect(data(opened).request).toEqual({
      tool: "Write",
      input_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
    });
    expect(String(data(opened).title)).toContain("large.txt");
    await awd.answerFrom("pixel-9", task.id, String(data(opened).gate), "Allow once");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r) === "I wrote large.txt.",
    );
    expect((await stat(join(awd.home, "worktrees", `aw-${task.key}`, "large.txt"))).size).toBe(
      100_000,
    );
  }, 60_000);

  it("opens a Reply gate after a timed-out command gate and after an unanswered Reply gate", async () => {
    awd = await startSessionDaemon({ permissionTimeoutMs: 1500 });
    // The gate "Approve command" of the same turn stays open after its timeout: the question at
    // the end of the turn still opens a Reply gate.
    const task = await awd.createTask("write-then-ask stale.txt Should I try another name?");
    await awd.waitRow(
      task.id,
      (r) =>
        r.type === "gate.opened" &&
        data(r).kind === "reply" &&
        text(r).endsWith("Should I try another name?"),
    );
    const session = awd.session(task.id);
    // An open command gate of an earlier turn does not stop it either.
    await awd.sendMessage("pixel-9", task.id, session, "reply Which file name?");
    await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "reply" && text(r) === "Which file name?",
    );
    // The human answers with a message, not on the gate: the next question gets its own gate.
    await awd.sendMessage("pixel-9", task.id, session, "reply Which folder?");
    await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "reply" && text(r) === "Which folder?",
    );
  }, 60_000);

  it("resumes a killed agent with --resume and a continue message that names the step", async () => {
    awd = await startSessionDaemon();
    // The sleep ignores SIGHUP, like a background command that outlives the agent (verification
    // 2026-11-22): only the process-group stop of the resume ends it.
    const task = await awd.createTask("bash trap '' HUP; sleep 300");
    const opened = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
    );
    await awd.answerFrom("pixel-9", task.id, String(data(opened).gate), "Allow once");
    const session = awd.session(task.id);
    const before = awd.server.daemon.sessions!.list().find((s) => s.id === session)!;
    // The sleep runs in the process group of the pane.
    await waitFor(async () => {
      const ps = await execa("ps", ["-A", "-o", "pgid=,command="]);
      return String(ps.stdout)
        .split("\n")
        .some((l) => l.trim().startsWith(`${before.pid} `) && l.includes("sleep 300"));
    }, 10_000);
    process.kill(before.pid!, "SIGKILL");
    const resumed = await awd.waitRow(task.id, (r) => r.type === "session.resumed", 30_000);
    expect(text(resumed)).toMatch(
      /^\[AW resume\] AW resumed this session after the agent process stopped at .* The interrupted step was Bash: trap '' HUP; sleep 300\./,
    );
    const after = awd.server.daemon.sessions!.list().find((s) => s.id === session)!;
    expect(after.pid).not.toBe(before.pid);
    const launch = JSON.parse(
      await readFile(join(awd.home, "sessions", session, "launch.json"), "utf8"),
    ) as { mode: string; args: string[] };
    expect(launch.mode).toBe("resume");
    expect(launch.args.slice(0, 2)).toEqual(["--resume", session]);
    // The background command of the killed agent is gone.
    const ps = await execa("ps", ["-A", "-o", "pgid="]);
    expect(
      String(ps.stdout)
        .split("\n")
        .map((l) => Number(l.trim())),
    ).not.toContain(before.pid);
    // Only the session with the claim ran: one claim, one session.
    expect((await awd.rows(task.id)).filter((r) => r.type === "task.claimed")).toHaveLength(1);
  }, 90_000);

  it("resumes a session whose window is gone, and never signals the stored pids then", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("reply ready");
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "ready");
    const session = awd.session(task.id);
    const record = awd.server.daemon.sessions!.manager(session).record(session)!;
    const real = { ...record.pane! };
    // After a reboot or a tmux kill-server, the stored pid and pgid can be of another program.
    const other = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
    other.unref();
    const otherPid = other.pid!;
    try {
      record.pane = { ...real, pid: otherPid, pgid: otherPid };
      await awd.host.close(real);
      await awd.waitRow(task.id, (r) => r.type === "session.resumed", 30_000);
      expect(() => process.kill(otherPid, 0)).not.toThrow();
    } finally {
      process.kill(otherPid, "SIGKILL");
    }
  }, 60_000);

  it("delivers an answer when the agent text on the screen asks Do you want to ...?", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("reply Do you want to use Postgres or SQLite?");
    const reply = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "reply",
    );
    const gate = String(data(reply).gate);
    expect(await awd.screen(task.id)).toContain("Do you want to use Postgres or SQLite?");
    await awd.answerFrom("pixel-9", task.id, gate, "SQLite");
    await awd.waitRow(task.id, (r) => r.type === "message.human" && data(r).delivery_id === gate);
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "Got: SQLite.");
  }, 60_000);

  it("answers the trust screen of a Claude Code version that the tests do not cover", async () => {
    awd = await startSessionDaemon({ claudeVersion: "2.2.0" });
    const task = await awd.createTask("reply trusted");
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "trusted");
    const launch = JSON.parse(
      await readFile(join(awd.home, "sessions", awd.session(task.id), "launch.json"), "utf8"),
    ) as { trust: boolean };
    expect(launch.trust).toBe(false);
    // aw-launch wrote no trust entry: the fake claude wrote it when AW selected "Yes".
    expect(existsSync(join(awd.home, "backups"))).toBe(false);
    const state = JSON.parse(await readFile(join(awd.userHome, ".claude.json"), "utf8")) as {
      projects: Record<string, { hasTrustDialogAccepted?: boolean }>;
    };
    // The working folder as the agent sees it (macOS: /private/var/... for /var/...).
    const entry = Object.entries(state.projects).find(([path]) =>
      path.endsWith(`/worktrees/aw-${task.key}`),
    );
    expect(entry?.[1].hasTrustDialogAccepted).toBe(true);
  }, 60_000);

  it("presses Enter at once when the trust screen of an uncovered version has Yes first", async () => {
    awd = await startSessionDaemon({ claudeVersion: "2.2.0", trustOrder: "yes-first" });
    const task = await awd.createTask("reply trusted first");
    // A Down here would select "No, exit": the agent would exit and the session would resume.
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "trusted first");
    const rows = await awd.rows(task.id);
    expect(rows.some((r) => r.type === "session.resumed")).toBe(false);
  }, 60_000);

  it("starts the other sessions when one task cannot get its worktree", async () => {
    awd = await startSessionDaemon();
    // The branch of the first task is checked out in a folder that AW did not make: no start.
    await execa("git", [
      "-C",
      awd.checkout,
      "worktree",
      "add",
      "-q",
      "-b",
      "aw/AW-1",
      join(awd.home, "elsewhere"),
    ]);
    const broken = await awd.createTask("reply never");
    expect(broken.key).toBe("AW-1");
    const comment = await awd.waitRow(
      broken.id,
      (r) => r.type === "comment.added" && text(r).startsWith("The session did not start"),
    );
    expect(text(comment)).toContain("The branch aw/AW-1 is checked out in ");
    expect(text(comment)).toContain("/elsewhere, a folder that AW did not make for this task");
    const task = await awd.createTask("ask Which region? | eu|us");
    const opened = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "question",
    );
    const gate = String(data(opened).gate);
    await awd.answerFrom("pixel-9", task.id, gate, "eu");
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "Got: eu.");
    // One comment, not one per check.
    await awd.waitChecks(awd.session(task.id), 3);
    expect(
      (await awd.rows(broken.id)).filter(
        (r) => r.type === "comment.added" && text(r).startsWith("The session did not start"),
      ),
    ).toHaveLength(1);
  }, 60_000);

  it("starts the agent again with its first input when it stops before its first prompt", async () => {
    const once = join(await tempDir("awx-"), "exited");
    awd = await startSessionDaemon({ fakeEnv: { FAKE_CLAUDE_EXIT_ONCE: once } });
    const task = await awd.createTask("reply started again");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r) === "started again",
      30_000,
    );
    // The first window exited before SessionStart: no transcript, so no --resume.
    expect(existsSync(once)).toBe(true);
    const session = awd.session(task.id);
    const launch = JSON.parse(
      await readFile(join(awd.home, "sessions", session, "launch.json"), "utf8"),
    ) as { mode: string; args: string[] };
    expect(launch.mode).toBe("new");
    expect(launch.args.slice(0, 2)).toEqual(["--session-id", session]);
    const record = awd.server.daemon.sessions!.manager(session).record(session)!;
    expect(record).toMatchObject({ restarts: 1, resumes: 0, state: "running" });
    const rows = await awd.rows(task.id);
    expect(rows.some((r) => r.type === "session.resumed")).toBe(false);
    expect(rows.some((r) => r.type === "comment.added" && text(r).includes("failed"))).toBe(false);
    const first = rows.filter((r) => r.type === "message.human" && data(r).source === "first");
    expect(first.map(text)).toEqual(["reply started again"]);
    expect(rows.filter((r) => r.type === "task.claimed")).toHaveLength(1);
  }, 60_000);

  it("claims again after the window did not open, and the next try starts the session", async () => {
    awd = await startSessionDaemon({ tmuxFailsOnce: true, startRetryMs: 1000 });
    const task = await awd.createTask("reply opened at the second try");
    const comment = await awd.waitRow(
      task.id,
      (r) => r.type === "comment.added" && text(r).startsWith("The session did not start"),
    );
    expect(text(comment)).toContain("fake tmux failure");
    expect(text(comment)).toContain("AW tries again in 1 s");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r) === "opened at the second try",
    );
    const claims = (await awd.rows(task.id)).filter((r) => r.type === "task.claimed");
    expect(claims.map((r) => data(r).epoch)).toEqual([1, 2]);
    const sessions = awd.server.daemon.sessions!.list();
    expect(sessions.map((s) => s.state)).toEqual(["running"]);
    expect(sessions[0]!.id).toBe(data(claims[1]!).session);
    // The record of the first claim is gone with its folder.
    expect(existsSync(join(awd.home, "sessions", String(data(claims[0]!).session)))).toBe(false);
  }, 60_000);

  it("refuses a checkout that is not a git repository, with a comment", async () => {
    awd = await startSessionDaemon();
    const plain = await tempDir("awp-");
    await awd.server.daemon
      .workspace()
      .files.writeDocument("tasks/devices/macbook-pro/bindings.yaml", {
        kind: "bindings",
        schema: 1,
        device: "macbook-pro",
        may_run: true,
        checkouts: [{ project: "billing-api", path: plain }],
      });
    const task = await awd.createTask("reply never");
    const comment = await awd.waitRow(
      task.id,
      (r) => r.type === "comment.added" && text(r).startsWith("The session did not start"),
    );
    expect(text(comment)).toContain("is not a git repository");
    expect(await awd.host.list()).toEqual([]);
    expect(awd.server.daemon.sessions!.list()).toEqual([]);
    expect(existsSync(join(awd.userHome, ".claude.json"))).toBe(false);
  }, 60_000);

  it("refuses a worktree for a checkout with no commit, then starts after the first commit", async () => {
    awd = await startSessionDaemon({ startRetryMs: 500 });
    const unborn = await tempDir("awu-");
    await execa("git", ["-C", unborn, "init", "-q", "-b", "main"]);
    await writeFile(join(unborn, "notes.md"), "notes\n");
    await awd.server.daemon
      .workspace()
      .files.writeDocument("tasks/devices/macbook-pro/bindings.yaml", {
        kind: "bindings",
        schema: 1,
        device: "macbook-pro",
        may_run: true,
        checkouts: [{ project: "billing-api", path: unborn }],
      });
    const task = await awd.createTask("reply never");
    const comment = await awd.waitRow(
      task.id,
      (r) => r.type === "comment.added" && text(r).startsWith("The session did not start"),
    );
    expect(text(comment)).toContain(`${unborn} has no commit yet`);
    expect(text(comment)).toContain('"Project checkout"');
    expect(await awd.host.list()).toEqual([]);
    expect(awd.server.daemon.sessions!.list()).toEqual([]);
    // The retries of the same cause write no second comment.
    await new Promise((r) => setTimeout(r, 1500));
    const starts = (await awd.rows(task.id)).filter(
      (r) => r.type === "comment.added" && text(r).startsWith("The session did not start"),
    );
    expect(starts).toHaveLength(1);
    // The first commit: the next retry starts the session, with no new assignment.
    await execa("git", ["-C", unborn, "add", "."]);
    await execa("git", [
      "-C",
      unborn,
      "-c",
      "user.name=AW Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "init",
    ]);
    await awd.waitRow(task.id, (r) => r.type === "session.started");
    expect(awd.worktree(task.id)).not.toBe(unborn);
  }, 60_000);

  it("starts the sessions when the agent binary answers after the start, with no awd restart", async () => {
    const ready = join(await tempDir("awa-"), "ready");
    awd = await startSessionDaemon({ versionNeeds: ready, prepareRetryMs: 500 });
    const task = await awd.createTask("reply the agent is here");
    const comment = await awd.waitRow(
      task.id,
      (r) => r.type === "comment.added" && text(r).startsWith("AW cannot start a session"),
    );
    expect(text(comment)).toContain("does not answer");
    expect((await awd.client.ready()).checks).toMatchObject({
      session_host: "ok",
      session_agent: "failed",
    });
    await writeFile(ready, "");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r) === "the agent is here",
    );
    expect((await awd.client.ready()).checks.session_agent).toBe("ok");
    expect(
      (await awd.rows(task.id)).filter(
        (r) => r.type === "comment.added" && text(r).startsWith("AW cannot start a session"),
      ),
    ).toHaveLength(1);
  }, 60_000);
});

export { waitFor };
