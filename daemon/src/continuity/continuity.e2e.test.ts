// End-to-end tests of continuity (add-continuity) with awd, a real tmux on a private socket,
// aw-launch and the fake claude: the resume limit, the usage and agent-error pauses, the queue, the
// test slots, the health file and the credential clean-up.
import { healthV1 } from "@aw/schema";
import { execa } from "execa";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { sessionPaths } from "../sessions/records.ts";
import {
  startSessionDaemon,
  TEST_TMUX,
  waitFor,
  type SessionTestDaemon,
} from "../sessions/testing.ts";
import { tempDir } from "../testing.ts";

let awd: SessionTestDaemon | null = null;

afterEach(async () => {
  await awd?.close();
  awd = null;
});

const data = (row: { event: unknown }) => (row.event as { data: Record<string, unknown> }).data;

describe.skipIf(!TEST_TMUX)("continuity with tmux and the fake agent", () => {
  it("fails a session whose agent dies after each SessionStart, and opens Take over terminal", async () => {
    awd = await startSessionDaemon({ fakeEnv: { FAKE_CLAUDE_EXIT_AFTER_START: "1" } });
    const task = await awd.createTask("reply never");
    const comment = await awd.waitRow(
      task.id,
      (r) => r.type === "comment.added" && String(data(r).text).startsWith("Resume failed"),
      60_000,
    );
    expect(String(data(comment).text)).toMatch(/no progress after 2 resumes/);
    await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "take_over_terminal",
    );
    const resumed = (await awd.rows(task.id)).filter((r) => r.type === "session.started");
    expect(resumed.length).toBeLessThanOrEqual(1);
    const record = awd.server.daemon.sessions!.list().find((s) => s.task === task.id)!;
    expect(record.state).toBe("failed");
    // No credential files stay in the folder of a session that does not run.
    expect(existsSync(sessionPaths(awd.home, record.id).credentials)).toBe(false);
    // No person stopped it: the session ended as crashed (decision 37, ptf-4).
    const ended = await awd.waitRow(task.id, (r) => r.type === "session.ended");
    expect(data(ended)).toEqual({ session: record.id, reason: "crashed" });
    expect((await awd.task(task.id)).session).toMatchObject({
      session: record.id,
      state: "ended",
      reason: "crashed",
    });
  }, 90_000);

  it("resumes a killed agent with no end, and ends the session as crashed after the resume limit", async () => {
    // Each start waits 15 s before SessionStart: a kill in that time leaves the resume with no
    // progress, as an agent that the system kills again and again.
    awd = await startSessionDaemon({ fakeEnv: { FAKE_CLAUDE_START_DELAY_MS: "15000" } });
    const task = await awd.createTask("wait 600000");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.human" && data(r).source === "first",
      60_000,
    );
    const session = awd.session(task.id);
    const record = () => awd!.server.daemon.sessions!.list().find((s) => s.id === session)!;
    let pid = record().pid!;
    for (let kill = 1; kill <= 2; kill++) {
      process.kill(pid, "SIGKILL");
      await waitFor(() => record().pid !== undefined && record().pid !== pid, 30_000);
      pid = record().pid!;
      // AW resumes the killed agent: the session did not end.
      expect((await awd.rows(task.id)).filter((r) => r.type === "session.ended")).toEqual([]);
      expect((await awd.task(task.id)).session?.state).toBe("running");
    }
    process.kill(pid, "SIGKILL");
    const ended = await awd.waitRow(task.id, (r) => r.type === "session.ended", 30_000);
    expect(data(ended)).toEqual({ session, reason: "crashed" });
    expect(record().state).toBe("failed");
    const comment = await awd.waitRow(
      task.id,
      (r) => r.type === "comment.added" && String(data(r).text).startsWith("Resume failed"),
    );
    expect(String(data(comment).text)).toMatch(/no progress after 2 resumes/);
  }, 150_000);

  it("runs a crashed session again after Resume again, and shows it running", async () => {
    awd = await startSessionDaemon({ fakeEnv: { FAKE_CLAUDE_EXIT_AFTER_START: "1" } });
    const task = await awd.createTask("reply never");
    const gate = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "take_over_terminal",
      60_000,
    );
    const crashed = await awd.waitRow(
      task.id,
      (r) => r.type === "session.ended" && data(r).reason === "crashed",
    );
    await awd.answerFrom("pixel-9", task.id, String(data(gate).gate), "Resume again");
    const resumed = await awd.waitRow(
      task.id,
      (r) => r.type === "session.resumed" && r.hlc > crashed.hlc,
    );
    expect(data(resumed).session).toBe(data(crashed).session);
    // The agent dies again: AW resumes it, then the session crashes a second time.
    await awd.waitRow(
      task.id,
      (r) => r.type === "session.ended" && r.hlc > resumed.hlc && data(r).reason === "crashed",
      60_000,
    );
  }, 120_000);

  it("pauses at a usage limit with the reset time, and resumes when the agent works again", async () => {
    awd = await startSessionDaemon();
    const reset = Math.floor(Date.now() / 1000) + 2 * 3600;
    const status = JSON.stringify({
      rate_limits: {
        five_hour: { used_percentage: 100, resets_at: reset },
        seven_day: { used_percentage: 40, resets_at: reset + 3 * 24 * 3600 },
      },
    });
    const task = await awd.createTask(`statusline ${status}`);
    await awd.waitRow(task.id, (r) => r.type === "message.agent");
    const session = awd.session(task.id);
    const usage = JSON.parse(await readFile(sessionPaths(awd.home, session).usage, "utf8")) as {
      five_hour: { used_percentage: number; resets_at: number };
    };
    expect(usage.five_hour).toEqual({ used_percentage: 100, resets_at: reset * 1000 });

    await awd.sendMessage("pixel-9", task.id, session, "stop-failure rate_limit");
    const paused = await awd.waitRow(task.id, (r) => r.type === "task.paused");
    expect(data(paused)).toMatchObject({
      cause: "usage_limit",
      resumes_at: new Date(reset * 1000).toISOString(),
      needs_human: false,
    });
    expect((await awd.task(task.id)).paused?.cause).toBe("usage_limit");

    await awd.sendMessage("pixel-9", task.id, session, "hello again");
    await awd.waitRow(task.id, (r) => r.type === "task.resumed");
    expect((await awd.task(task.id)).paused).toBeNull();

    // An agent error: a pause with a retry time, no human needed.
    await awd.sendMessage("pixel-9", task.id, session, "stop-failure server_error");
    const error = await awd.waitRow(
      task.id,
      (r) => r.type === "task.paused" && data(r).cause === "agent_error",
    );
    expect(data(error)).toMatchObject({ needs_human: false });
    expect(String(data(error).next_step)).toMatch(/^Agent error \(server_error\)\. AW retries at/);
  }, 90_000);

  it("never pastes the answer of Continue after usage limit, and Continue waits for the reset (fix list 0h)", async () => {
    awd = await startSessionDaemon();
    const reset = Math.floor(Date.now() / 1000) + 2 * 3600;
    const status = JSON.stringify({
      rate_limits: {
        five_hour: { used_percentage: 100, resets_at: reset },
        seven_day: { used_percentage: 40, resets_at: reset + 3 * 24 * 3600 },
      },
    });
    const task = await awd.createTask(`statusline ${status}`);
    await awd.waitRow(task.id, (r) => r.type === "message.agent");
    const session = awd.session(task.id);
    // 3 automatic continues are used: the next limit opens the cap gate.
    const record = awd.server.daemon.sessions!.manager(session).record(session)!;
    record.continues = 3;
    record.auto_resume_disabled = true;
    const capGate = async (after: number) => {
      await awd!.sendMessage("pixel-9", task.id, session, "stop-failure rate_limit");
      return awd!.waitRow(
        task.id,
        (r) =>
          r.type === "gate.opened" &&
          data(r).kind === "continue_after_limit" &&
          r.hlc > new Date(after).toISOString(),
      );
    };
    const first = await capGate(0);
    await awd.answerFrom("pixel-9", task.id, String(data(first).gate), "Wait");
    await awd.waitRow(
      task.id,
      (r) => r.type === "gate.resolved" && data(r).gate === data(first).gate,
    );
    await awd.waitChecks(session, 12);
    // "Wait": no text goes to the agent, and the task stays paused.
    const delivered = (gate: unknown) => async () =>
      (await awd!.rows(task.id)).some(
        (r) => r.type === "message.human" && data(r).delivery_id === gate,
      );
    expect(await delivered(data(first).gate)()).toBe(false);
    expect(await awd.screen(task.id)).not.toContain(`[AW answer ${String(data(first).gate)}]`);
    expect((await awd.task(task.id)).paused?.cause).toBe("continue_cap");
    // A message of the person ends the pause of the cap.
    await awd.sendMessage("pixel-9", task.id, session, "hello again");
    await waitFor(async () => (await awd!.task(task.id)).paused === null, 20_000);

    // "Continue": no text either; AW continues after the reset (a usage pause until then).
    record.continues = 3;
    const second = await capGate(Date.now());
    await awd.answerFrom("pixel-9", task.id, String(data(second).gate), "Continue");
    await waitFor(async () => (await awd!.task(task.id)).paused?.cause === "usage_limit", 20_000);
    expect((await awd.task(task.id)).paused?.resumes_at).toBe(new Date(reset * 1000).toISOString());
    await awd.waitChecks(session, 12);
    expect(await delivered(data(second).gate)()).toBe(false);
  }, 120_000);

  it("starts a queued task only when a working session waits at a gate", async () => {
    awd = await startSessionDaemon({ env: { AW_MAX_WORKING: "1" } });
    const first = await awd.createTask("reply working");
    await awd.waitRow(first.id, (r) => r.type === "message.agent");
    const second = await awd.createTask("reply second");
    const session = awd.session(first.id);
    await awd.waitChecks(session, 6);
    expect((await awd.rows(second.id)).some((r) => r.type === "task.claimed")).toBe(false);
    await awd.sendMessage("pixel-9", first.id, session, "ask Which one? | a|b");
    await awd.waitRow(first.id, (r) => r.type === "gate.opened");
    await awd.waitRow(second.id, (r) => r.type === "task.claimed");
  }, 90_000);

  it("counts the working sessions of the device across workspaces (fix list 0g)", async () => {
    awd = await startSessionDaemon({ env: { AW_MAX_WORKING: "1" } });
    const first = await awd.createTask("reply working");
    await awd.waitRow(first.id, (r) => r.type === "message.agent");
    // A second workspace on the same device, with a task for the same agent.
    const folder = await tempDir("aw-side-");
    await awd.client.initWorkspace({ path: folder, name: "side" });
    await awd.client.addProject("side", {
      slug: "billing-api",
      name: "Billing API",
      permission_mode: "default",
    });
    const side = awd.server.daemon.workspace("side");
    // Its own clone: both workspaces have a task AW-1, so both use the branch aw/AW-1.
    const clone = join(folder, "..", `${basename(folder)}-checkout`);
    await execa("git", ["clone", "-q", awd.checkout, clone]);
    await side.files.writeDocument("tasks/devices/macbook-pro/bindings.yaml", {
      kind: "bindings",
      schema: 1,
      device: "macbook-pro",
      may_run: true,
      checkouts: [{ project: "billing-api", path: clone }],
    });
    await side.refresh();
    const created = await awd.client.createTask("side", {
      project: "billing-api",
      title: "Side task",
      first_message: "reply side",
      assignee: "claude@macbook-pro",
    });
    const session = awd.session(first.id);
    await awd.waitChecks(session, 12);
    const sideRows = async () =>
      (await awd!.client.thread("side", created.task.id, { limit: 1000 })).events;
    expect((await sideRows()).some((r) => r.type === "task.claimed")).toBe(false);
    // The first session waits at a gate: the side task starts.
    await awd.sendMessage("pixel-9", first.id, session, "ask Which one? | a|b");
    await awd.waitRow(first.id, (r) => r.type === "gate.opened");
    await waitFor(async () => (await sideRows()).some((r) => r.type === "task.claimed"), 30_000);
  }, 120_000);

  it("leases a test slot of this device, renews it, releases it, and writes the health file", async () => {
    awd = await startSessionDaemon();
    const service = awd.server.daemon.workspace();
    await service.files.writeDocument("tasks/devices/macbook-pro/bindings.yaml", {
      kind: "bindings",
      schema: 1,
      device: "macbook-pro",
      may_run: true,
      checkouts: [{ project: "billing-api", path: awd.checkout }],
      resources: { k3d: 1 },
    });
    await service.refresh();
    const task = await awd.createTask("reply ok");
    await awd.waitRow(task.id, (r) => r.type === "message.agent");
    const session = awd.session(task.id);
    const env = await awd.agentEnv(task.id);
    const acquired = await awd.aw(["slot", "acquire", "k3d"], { env });
    expect(acquired.code).toBe(0);
    expect(acquired.stdout).toMatch(/You hold k3d slot 0 until .* \(fencing token 1\)/);
    const client = await awd.agentClient(session);
    expect(await client.slotAcquire(session, { resource: "k3d" })).toMatchObject({
      renewed: true,
      lease: { slot: 0, fencing_token: 1 },
    });
    expect(service.view.slots).toHaveLength(1);
    const released = await awd.aw(["slot", "release", "k3d"], { env });
    expect(released.code).toBe(0);
    expect(service.view.slots).toHaveLength(0);
    await expect(client.slotAcquire(session, { resource: "gpu" })).rejects.toMatchObject({
      status: 404,
    });

    // Health: the file of this device, at most once per 60 s (the first one at the first check;
    // the session list of a later write is covered by the unit test).
    const path = join(awd.folder, "tasks", "devices", "macbook-pro", "health.yaml");
    await waitFor(() => Promise.resolve(existsSync(path)), 20_000);
    const health = healthV1.parse(parse(await readFile(path, "utf8")));
    expect(health.device).toBe("macbook-pro");
    expect(health.versions.claude).toBe("2.1.330");
    expect(health.boot_time).toBe("2026-11-22T08:00:00.000Z");
    // The first write can come before the bindings of the test: the unit test covers the list.
    expect(Array.isArray(health.checkouts)).toBe(true);
  }, 90_000);

  it("gives CLAUDE_CONFIG_DIR of awd to the session, and removes the credentials at the stop", async () => {
    const config = await tempDir("awcc-");
    awd = await startSessionDaemon({ env: { CLAUDE_CONFIG_DIR: config } });
    const task = await awd.createTask("reply ok");
    await awd.waitRow(task.id, (r) => r.type === "message.agent");
    const session = awd.session(task.id);
    const launch = JSON.parse(await readFile(sessionPaths(awd.home, session).launch, "utf8")) as {
      env: Record<string, string>;
      state_file: string;
    };
    expect(launch.env.CLAUDE_CONFIG_DIR).toBe(config);
    expect(launch.state_file).toBe(join(config, ".claude.json"));
    // The transcript is in the config folder of awd, so awd finds the conversation.
    await waitFor(() => Promise.resolve(existsSync(join(config, "projects"))), 10_000);
    expect(existsSync(sessionPaths(awd.home, session).credentials)).toBe(true);
    await awd.client.stopSession(session);
    expect(existsSync(sessionPaths(awd.home, session).credentials)).toBe(false);
  }, 90_000);
});
