// The revoke journey on 2 awd containers (docs/phase-1.md 6.8, openspec revoke-device): ubuntu-01
// pairs with a code (signed records) and works on a task; its agent commits, and awd pushes
// `aw/<key>` at the Stop. The person revokes ubuntu-01 on macbook-pro. macbook-pro shows "Paused:
// ubuntu-01 was revoked", ubuntu-01 gets its revoke and stops its session, and macbook-pro has no
// peer ubuntu-01. The person changes the assignee to claude@macbook-pro, which continues from
// `aw/<key>`. Run it with "task e2e". Each step writes one "EVIDENCE {json}" line to stdout.
import type { SyncStatusReply, Task, ThreadReply } from "@aw/client";
import type { DeviceEntryView, PairingView } from "@aw/client/identity";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aw, awJson, compose, exec, waitFor, WORKSPACE, type Device } from "./compose.ts";

const A: Device = "macbook-pro";
const B: Device = "ubuntu-01";
const PROJECT_SLUG = "demo-api";
const REMOTE = "/remote/demo.git";
const CHECKOUT = "/aw/demo";
const GIT_USER = ["-c", "user.name=Agent", "-c", "user.email=agent@example.com"];

function evidence(step: string, data: Record<string, unknown>): void {
  process.stdout.write(`EVIDENCE ${JSON.stringify({ step, ...data })}\n`);
}

const status = (device: Device) => awJson<SyncStatusReply>(device, ["sync", "status"]);
const git = (device: Device, args: string[]) => exec(device, ["git", ...args]);
const thread = (device: Device, task: string) =>
  awJson<ThreadReply>(device, ["thread", task, "--limit", "1000"]);
const data = (row: { event: { data: unknown } }) => row.event.data as Record<string, unknown>;
const sessions = (device: Device) =>
  awJson<{ id: string; task: string; state: string; epoch: number }[]>(device, ["session", "list"]);

async function engineDevices(device: Device): Promise<string[]> {
  const xml = (await exec(device, ["cat", "/aw/state/sync/config.xml"])).stdout;
  return [...xml.matchAll(/^\s*<device id="([A-Z2-7-]{63})" name=/gm)].map((m) => m[1]!);
}

async function remoteLog(ref: string): Promise<string[]> {
  const log = await git(A, ["-C", REMOTE, "log", "--format=%s", ref]);
  return log.code === 0 ? log.stdout.trim().split("\n") : [];
}

beforeAll(async () => {
  await compose(["down", "-v", "--remove-orphans"]);
  const up = await compose(["up", "-d", "--build"]);
  if (up.code !== 0) throw new Error(`docker compose up failed: ${up.stderr}`);
  for (const device of [A, B]) {
    await waitFor(
      async () => (await status(device)).engine === "running",
      60_000,
      `engine on ${device}`,
    );
  }
}, 900_000);

afterAll(async () => {
  await compose(["down", "-v", "--remove-orphans"]);
});

describe("revoke a device that works on a task", () => {
  let task: Task;
  let idB = "";

  it("1. pairs ubuntu-01 with a code, and binds a checkout of the project remote on each", async () => {
    expect((await aw(A, ["workspace", "init", WORKSPACE, "--name", "demo"])).code).toBe(0);
    expect((await aw(A, ["project", "add", PROJECT_SLUG])).code).toBe(0);
    expect(
      (await aw(A, ["project", "edit", PROJECT_SLUG, "--device", A, "--device", B])).code,
    ).toBe(0);
    idB = (await status(B)).sync_id!;
    await waitFor(
      async () =>
        (await exec(A, ["test", "-f", `${WORKSPACE}/tasks/devices/${A}/device.yaml`])).code === 0,
      30_000,
      "the own record of A",
    );
    const offer = await awJson<PairingView>(A, ["device", "add", "--no-wait"]);
    const joined = await awJson<PairingView>(B, [
      "pair",
      offer.code!,
      "--path",
      WORKSPACE,
      "--no-wait",
    ]);
    await waitFor(
      async () =>
        (await aw(A, ["--json", "device", "approve", offer.id, joined.check_code!])).code === 0,
      60_000,
      "the approval of ubuntu-01",
      1000,
    );
    await waitFor(
      async () => (await status(A)).peers.find((p) => p.device === B && p.connected),
      120_000,
      "A connected to B",
    );

    expect((await git(A, ["init", "-q", "--bare", "-b", "main", REMOTE])).code).toBe(0);
    expect((await git(A, ["init", "-q", "-b", "main", CHECKOUT])).code).toBe(0);
    await git(A, ["-C", CHECKOUT, ...GIT_USER, "commit", "-q", "--allow-empty", "-m", "init"]);
    await git(A, ["-C", CHECKOUT, "remote", "add", "origin", REMOTE]);
    expect((await git(A, ["-C", CHECKOUT, "push", "-q", "origin", "main"])).code).toBe(0);
    expect((await git(B, ["clone", "-q", REMOTE, CHECKOUT])).code).toBe(0);
    await waitFor(
      async () =>
        (await awJson<{ slug: string; devices: string[] }[]>(B, ["project", "list"])).some(
          (p) => p.slug === PROJECT_SLUG && p.devices.includes(B),
        ),
      60_000,
      "the project on B",
    );
    for (const device of [A, B]) {
      const bound = await aw(device, ["binding", "set", PROJECT_SLUG, CHECKOUT]);
      expect(bound.code, bound.stderr).toBe(0);
    }
    const list = await awJson<DeviceEntryView[]>(A, ["device", "list"]);
    evidence("paired", { devices: list.map((d) => `${d.slug}:${d.role}:${d.state}`) });
  }, 300_000);

  it("2. the agent on ubuntu-01 commits, and awd pushes aw/<key> at the Stop", async () => {
    const reply = await awJson<{ task: Task }>(A, [
      "task",
      "create",
      "--project",
      PROJECT_SLUG,
      "--title",
      "Add rate limit to the billing API",
      "--assignee",
      `claude@${B}`,
      "--first-message",
      `bash git ${GIT_USER.join(" ")} commit -q --allow-empty -m work-of-ubuntu-01`,
    ]);
    task = reply.task;
    const gate = await waitFor(
      async () =>
        (await thread(A, task.id)).events.find(
          (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
        ),
      120_000,
      "the approve_command gate of B on A",
      1000,
    );
    expect((await aw(A, ["gate", "answer", String(data(gate).gate), "Allow once"])).code).toBe(0);
    await waitFor(
      async () => (await remoteLog(`aw/${task.key}`)).includes("work-of-ubuntu-01"),
      90_000,
      `aw/${task.key} on the remote`,
      1000,
    );
    const running = await sessions(B);
    evidence("working-on-b", {
      remote_log: await remoteLog(`aw/${task.key}`),
      sessions_b: running.map((s) => `${s.task} ${s.state} epoch ${s.epoch}`),
    });
    expect(running.find((s) => s.task === task.id)?.state).toBe("running");
  }, 240_000);

  it("3. revoke ubuntu-01: it stops its session, and macbook-pro shows the revoked pause", async () => {
    const started = Date.now();
    const revoke = await aw(A, ["device", "revoke", B]);
    expect(revoke.code, revoke.stderr).toBe(0);
    const revokeMs = Date.now() - started;
    // B got its own revoke before the peer went, and stopped the session.
    const stopped = await waitFor(
      async () => {
        const list = await sessions(B);
        return list.find((s) => s.task === task.id && s.state === "stopped") ? list : null;
      },
      30_000,
      "the stopped session on B",
      500,
    );
    const stopMs = Date.now() - started;
    const ownB = await awJson<DeviceEntryView[]>(B, ["device", "list"]);
    const panes = await exec(B, ["sh", "-c", "pgrep -fa 'fake|claude' | grep -v pgrep || true"]);
    await waitFor(async () => !(await engineDevices(A)).includes(idB), 20_000, "B not in A");
    const show = await waitFor(
      async () => {
        const shown = await aw(A, ["task", "show", task.key!]);
        return shown.stdout.includes(`Paused:    ${B} was revoked.`) ? shown : null;
      },
      30_000,
      "the revoked pause on A",
      1000,
    );
    const list = await aw(A, ["task", "list"]);
    const json = await awJson<Task & { needs_you_lane: boolean }>(A, ["task", "show", task.key!]);
    evidence("revoked", {
      revoke_reply: revoke.stdout.trim(),
      revoke_ms: revokeMs,
      session_stopped_ms: stopMs,
      sessions_b: stopped.map((s) => `${s.task} ${s.state}`),
      record_on_b: ownB.find((d) => d.slug === B)?.state,
      agent_processes_b: panes.stdout.trim(),
      engine_devices_a: (await engineDevices(A)).length,
      peers_a: (await status(A)).peers.map((p) => p.device),
      show: show.stdout.trim(),
      list: list.stdout.trim(),
      needs_you_lane: json.needs_you_lane,
    });
    expect(ownB.find((d) => d.slug === B)?.state).toBe("revoked");
    expect((await status(A)).peers.map((p) => p.device)).not.toContain(B);
    expect(show.stdout).toContain("Change the assignee to continue on another device.");
    expect(list.stdout).toContain(`(paused: ${B} was revoked)`);
    expect(json.needs_you_lane).toBe(true);
    expect(revokeMs).toBeLessThan(15_000);
  }, 120_000);

  it("4. Change assignee to claude@macbook-pro: it continues from aw/<key>", async () => {
    expect((await aw(A, ["task", "assign", task.key!, `claude@${A}`])).code).toBe(0);
    const claim = await waitFor(
      async () =>
        (await thread(A, task.id)).events.find(
          (r) => r.type === "task.claimed" && data(r).device === A && r.applied,
        ),
      90_000,
      "the claim of A",
    );
    const worktree = `/aw/state/worktrees/aw-${task.key}`;
    const log = await waitFor(
      async () => {
        const result = await git(A, ["-C", worktree, "log", "--format=%s"]);
        return result.code === 0 ? result.stdout.trim().split("\n") : false;
      },
      60_000,
      "the worktree on A",
    );
    const show = await aw(A, ["task", "show", task.key!]);
    evidence("continued-on-a", {
      claim: data(claim),
      worktree_log_a: log,
      branch_a: (await git(A, ["-C", worktree, "branch", "--show-current"])).stdout.trim(),
      show: show.stdout.trim(),
    });
    expect(data(claim).epoch).toBe(2);
    expect(log).toEqual(["work-of-ubuntu-01", "init"]);
    expect(show.stdout).not.toContain("was revoked");
  }, 180_000);
});
