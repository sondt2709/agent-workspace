// The sync test plan on 2 awd containers (e2e/compose.yaml; openspec add-syncthing-sync). Run it
// with "task e2e". Each step writes one "EVIDENCE {json}" line to stdout.
import type { SyncNowReply, SyncStatusReply, Task, ThreadReply } from "@aw/client";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aw,
  awJson,
  compose,
  copyBetween,
  exec,
  leakLines,
  waitFor,
  WORKSPACE,
  type Device,
} from "./compose.ts";

const A: Device = "macbook-pro";
const B: Device = "ubuntu-01";

function evidence(step: string, data: Record<string, unknown>): void {
  process.stdout.write(`EVIDENCE ${JSON.stringify({ step, ...data })}\n`);
}

async function status(device: Device): Promise<SyncStatusReply> {
  return awJson<SyncStatusReply>(device, ["sync", "status"]);
}

/** Writes a file in a container as a person does (not through awd). */
async function writeFileIn(device: Device, path: string, content: string): Promise<void> {
  const result = await exec(
    device,
    ["sh", "-c", 'mkdir -p "$(dirname "$1")" && cat > "$1"', "sh", path],
    content,
  );
  if (result.code !== 0) throw new Error(result.stderr);
}

async function readFileIn(device: Device, path: string): Promise<string | null> {
  const result = await exec(device, ["cat", path]);
  return result.code === 0 ? result.stdout : null;
}

async function conflictCopies(device: Device): Promise<string[]> {
  const result = await exec(device, ["find", WORKSPACE, "-name", "*.sync-conflict-*"]);
  return result.stdout.split("\n").filter(Boolean);
}

async function count(device: Device, dir: string): Promise<number> {
  const result = await exec(device, ["sh", "-c", 'ls "$1" 2>/dev/null | wc -l', "sh", dir]);
  return Number(result.stdout.trim());
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** True when awd of a device journaled this content as its own write (a human edit too). */
async function journaled(device: Device, content: string): Promise<boolean> {
  const result = await exec(device, ["sh", "-c", "cat /aw/state/journal/*.jsonl 2>/dev/null"]);
  return result.stdout.includes(`"sha256":"${sha256(content)}"`);
}

/** True when a device has this content in its history store (`<AW_HOME>/history/<ws>/<sha256>`). */
async function inHistory(device: Device, content: string): Promise<boolean> {
  const result = await exec(device, ["find", "/aw/state/history", "-name", sha256(content)]);
  return result.stdout.trim() !== "";
}

/** The fields of `aw kb history` that the steps check. */
interface HistoryEntry {
  dev: string;
  kind: string;
  author: string;
  by: string | null;
  hash: string | null;
  label: string;
  available: boolean;
}

/** The knowledge history of a path (relative to `knowledge/`) on a device. */
function kbHistory(device: Device, path: string): Promise<HistoryEntry[]> {
  return awJson<HistoryEntry[]>(device, ["kb", "history", path]);
}

async function engineLog(device: Device): Promise<string> {
  return (await exec(device, ["cat", "/aw/state/logs/sync-engine.log"])).stdout;
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
}, 600_000);

afterAll(async () => {
  await compose(["down", "-v", "--remove-orphans"]);
});

describe("sync between 2 awd containers", () => {
  let task: string;

  it("4. first start: no discovery, relay or NAT line in the engine log", async () => {
    for (const device of [A, B]) {
      const log = await engineLog(device);
      expect(log).toContain("GUI and API listening");
      evidence("first-start-leak-lines", { device, lines: leakLines(log) });
      expect(leakLines(log)).toEqual([]);
    }
  });

  it("1a. pairs by REST only, and a task created on A appears on B", async () => {
    const init = await aw(A, ["workspace", "init", WORKSPACE, "--name", "demo"]);
    expect(init.code, init.stderr).toBe(0);
    expect((await aw(A, ["project", "add", "demo-api"])).code).toBe(0);
    // No pairing folder yet (identity-pairing): B gets the workspace file and the schemas.
    await exec(B, ["mkdir", "-p", `${WORKSPACE}/tasks`]);
    await copyBetween(A, B, WORKSPACE, ["tasks/workspace.yaml", "tasks/schemas"]);
    expect((await aw(B, ["workspace", "init", WORKSPACE])).code).toBe(0);

    const [idA, idB] = [(await status(A)).sync_id!, (await status(B)).sync_id!];
    const started = Date.now();
    const addB = await aw(A, [
      "sync",
      "peer",
      "add",
      idB,
      "tcp://ubuntu-01:22300",
      "--name",
      B,
      "--role",
      "remote",
    ]);
    const addA = await aw(B, [
      "sync",
      "peer",
      "add",
      idA,
      "tcp://macbook-pro:22300",
      "--name",
      A,
      "--role",
      "local",
    ]);
    expect(addB.code, addB.stderr).toBe(0);
    expect(addA.code, addA.stderr).toBe(0);
    await waitFor(async () => (await status(A)).peers[0]?.connected, 30_000, "A connected to B");
    const connectedMs = Date.now() - started;

    const created = await awJson<{ task: Task }>(A, [
      "task",
      "create",
      "--project",
      "demo-api",
      "--title",
      "Fix the flaky invoice test",
      "--first-message",
      "The invoice test fails 1 time in 5.",
    ]);
    task = created.task.id;
    const madeAt = Date.now();
    const seen = await waitFor(
      async () => (await awJson<Task[]>(B, ["task", "list"])).find((t) => t.id === task),
      30_000,
      "the task on B",
    );
    evidence("pair-and-task", {
      connected_ms: connectedMs,
      task_on_b_ms: Date.now() - madeAt,
      key: seen.key,
    });
    expect(seen.title).toBe("Fix the flaky invoice test");
  }, 120_000);

  it("1b. 300 log lines on each device at the same time: 0 copies, the same merge", async () => {
    const run = (device: Device) =>
      exec(device, [
        "node",
        "/repo/e2e/docker/bulk-edit.ts",
        "/aw/state/run/awd.sock",
        task,
        "300",
      ]);
    const [ra, rb] = await Promise.all([run(A), run(B)]);
    expect(ra.code, ra.stderr).toBe(0);
    expect(rb.code, rb.stderr).toBe(0);
    const lines = async (device: Device, of: Device) =>
      Number(
        (
          await exec(device, [
            "sh",
            "-c",
            'wc -l < "$1"',
            "sh",
            `${WORKSPACE}/tasks/${task}/log/${of}.jsonl`,
          ])
        ).stdout.trim(),
      );
    for (const device of [A, B]) {
      await waitFor(
        async () => (await lines(device, A)) >= 301 && (await lines(device, B)) >= 300,
        60_000,
        `all lines on ${device}`,
      );
    }
    await waitFor(
      async () => {
        const [ta, tb] = await Promise.all(
          [A, B].map((d) => awJson<Task>(d, ["task", "show", task])),
        );
        return (
          JSON.stringify({ ...ta, includes: null }) === JSON.stringify({ ...tb, includes: null }) &&
          ta
        );
      },
      30_000,
      "the same task view",
    );
    const threads = await Promise.all(
      [A, B].map((d) => awJson<ThreadReply>(d, ["thread", task, "--limit", "1000"])),
    );
    const ids = threads.map((t) => t.events.map((e) => e.id).join(","));
    const copies = [...(await conflictCopies(A)), ...(await conflictCopies(B))];
    evidence("concurrent-logs", {
      events_a: threads[0]!.events.length,
      events_b: threads[1]!.events.length,
      same_order: ids[0] === ids[1],
      conflict_copies: copies.length,
    });
    expect(threads[0]!.events.length).toBe(601);
    expect(ids[0]).toBe(ids[1]);
    expect(copies).toEqual([]);
  }, 300_000);

  for (const order of ["remote edit newer", "local edit newer"] as const) {
    it(`2. a knowledge file changed on both devices: the local version wins (${order})`, async () => {
      const path = `${WORKSPACE}/knowledge/shared/${order.replaceAll(" ", "-")}.md`;
      await writeFileIn(A, path, "base\n");
      await waitFor(async () => (await readFileIn(B, path)) === "base\n", 30_000, "base on B");
      expect((await aw(A, ["sync", "pause"])).code).toBe(0);
      expect((await aw(B, ["sync", "pause"])).code).toBe(0);
      const [first, second] = order === "remote edit newer" ? [A, B] : [B, A];
      const edit = (device: Device) => `${device} edit (${order})\n`;
      await writeFileIn(first, path, edit(first));
      // The engine watcher finds the edit (fsWatcherDelayS 1) and awd journals it. The second edit
      // comes after it, so it is newer by the file time.
      await waitFor(() => journaled(first, edit(first)), 30_000, `the edit journaled on ${first}`);
      await writeFileIn(second, path, edit(second));
      await waitFor(
        () => journaled(second, edit(second)),
        30_000,
        `the edit journaled on ${second}`,
      );
      const resumed = Date.now();
      expect((await aw(A, ["sync", "resume"])).code).toBe(0);
      expect((await aw(B, ["sync", "resume"])).code).toBe(0);
      for (const device of [A, B]) {
        await waitFor(
          async () =>
            (await readFileIn(device, path)) === edit(A) &&
            (await conflictCopies(device)).every((c) => !c.includes("/knowledge/")),
          60_000,
          `the local version and no copy on ${device}`,
        );
      }
      const resolvedMs = Date.now() - resumed;
      // The local device resolved it and kept the version that lost in its history store.
      const lostInHistory = await inHistory(A, edit(B));
      // The knowledge history of each device shows the decision of the resolver.
      const name = path.slice(`${WORKSPACE}/knowledge/`.length);
      const replaced = (entries: HistoryEntry[]) =>
        entries.find((e) => e.kind === "replaced" && e.hash === sha256(edit(A)));
      const labels: string[] = [];
      for (const device of [A, B]) {
        const entry = await waitFor(
          async () => replaced(await kbHistory(device, name)),
          30_000,
          `the replaced change in the history of ${device}`,
        );
        labels.push(`${device}: ${entry.label} (by ${entry.by})`);
      }
      evidence("knowledge-conflict", {
        order,
        resolved_ms: resolvedMs,
        winner: A,
        lost_in_history: lostInHistory,
        history: labels,
      });
      expect(lostInHistory).toBe(true);
      expect(labels).toEqual([
        `${A}: Replaced by the macbook-pro version (by aw@macbook-pro)`,
        `${B}: Replaced by the macbook-pro version (by aw@macbook-pro)`,
      ]);
    }, 120_000);
  }

  it("2b. a knowledge file written on A shows in the history of B", async () => {
    const path = "shared/notes.md";
    const content = "Run the invoice test 5 times before a merge.\n";
    const write = await exec(A, ["aw", "kb", "write", path, "--file", "-"], content);
    expect(write.code, write.stderr).toBe(0);
    const written = Date.now();
    // B reconciles after the remote change: it stores the version (available) and logs no edit.
    const history = await waitFor(
      async () => {
        const entries = await kbHistory(B, path);
        return entries.length > 0 && entries.every((e) => e.available) && entries;
      },
      30_000,
      "the change of A in the history of B",
    );
    evidence("knowledge-history", {
      history_on_b_ms: Date.now() - written,
      entries: history.map((e) => `${e.dev}: ${e.label}`),
    });
    expect(await readFileIn(B, `${WORKSPACE}/knowledge/${path}`)).toBe(content);
    expect(history.map((e) => [e.dev, e.kind, e.author, e.hash, e.available])).toEqual([
      [A, "edit", "human@macbook-pro", sha256(content), true],
    ]);
    // After the settle time, B still has no edit of its own for the path.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect((await kbHistory(B, path)).map((e) => e.dev)).toEqual([A]);
  }, 60_000);

  it("3. Sync now with 1 and 200 changed files", async () => {
    await writeFileIn(A, `${WORKSPACE}/knowledge/shared/one.md`, "one\n");
    let started = Date.now();
    const one = await awJson<SyncNowReply>(A, ["sync", "now"]);
    const oneMs = Date.now() - started;
    expect(one.pending).toEqual([]);
    expect(await readFileIn(B, `${WORKSPACE}/knowledge/shared/one.md`)).toBe("one\n");
    const many = await exec(A, [
      "sh",
      "-c",
      'mkdir -p "$1" && i=0; while [ $i -lt 200 ]; do echo $i > "$1/f$i.md"; i=$((i+1)); done',
      "sh",
      `${WORKSPACE}/knowledge/shared/bulk`,
    ]);
    expect(many.code).toBe(0);
    started = Date.now();
    const bulk = await awJson<SyncNowReply>(A, ["sync", "now"]);
    const bulkMs = Date.now() - started;
    expect(bulk.pending).toEqual([]);
    expect(await count(B, `${WORKSPACE}/knowledge/shared/bulk`)).toBe(200);
    const text = await aw(A, ["sync", "now"]);
    evidence("sync-now", { one_file_ms: oneMs, files_200_ms: bulkMs, text: text.stdout.trim() });
    expect(text.stdout).toMatch(/ubuntu-01: Synced \d+ s ago/);
  }, 120_000);

  it("5. the engine is killed during a sync: awd restarts it and the sync completes", async () => {
    const before = await status(B);
    const worker = before.pids[before.pids.length - 1]!;
    const many = await exec(A, [
      "sh",
      "-c",
      'mkdir -p "$1" && i=0; while [ $i -lt 200 ]; do head -c 20000 /dev/urandom > "$1/f$i.bin"; i=$((i+1)); done',
      "sh",
      `${WORKSPACE}/knowledge/shared/kill`,
    ]);
    expect(many.code).toBe(0);
    // Kill the engine of B while the files arrive: after the first one, before the last one.
    await waitFor(
      async () => (await count(B, `${WORKSPACE}/knowledge/shared/kill`)) > 0,
      30_000,
      "the first file on B",
    );
    const atKill = await count(B, `${WORKSPACE}/knowledge/shared/kill`);
    expect((await exec(B, ["kill", "-9", String(worker)])).code).toBe(0);
    const killed = Date.now();
    await waitFor(
      async () => {
        const s = await status(B);
        return s.engine === "running" && !s.pids.includes(worker) && s;
      },
      60_000,
      "the engine on B again",
    );
    const restartMs = Date.now() - killed;
    const result = await waitFor(
      async () => {
        const reply = await awJson<SyncNowReply>(A, ["sync", "now", "--timeout", "30"], [0, 1]);
        return reply.pending.length === 0 && reply;
      },
      120_000,
      "Sync now with no pending peer",
    );
    expect(await count(B, `${WORKSPACE}/knowledge/shared/kill`)).toBe(200);
    evidence("engine-killed", {
      killed_pid: worker,
      files_on_b_at_kill: atKill,
      restart_ms: restartMs,
      synced_ms: Date.now() - killed,
      at: result.at,
    });
  }, 300_000);

  it("3b. an offline peer shows not synced, not 100 %", async () => {
    expect((await compose(["stop", B])).code).toBe(0);
    await waitFor(async () => !(await status(A)).peers[0]?.connected, 30_000, "B offline");
    await writeFileIn(A, `${WORKSPACE}/knowledge/shared/offline.md`, "x\n");
    const result = await aw(A, ["sync", "now", "--timeout", "5"]);
    const reply = await awJson<SyncNowReply>(A, ["sync", "now", "--timeout", "5"], [1]);
    evidence("offline-peer", {
      exit: result.code,
      text: result.stdout.trim(),
      pending: reply.pending,
    });
    expect(result.code).toBe(1);
    // At least the new file; a heartbeat line of A can add one more change.
    expect(result.stdout.trim()).toMatch(
      /^ubuntu-01: (1 change|\d+ changes) not synced to ubuntu-01 \(offline\)$/,
    );
    expect(reply.pending).toEqual([
      { device: "ubuntu-01", items: expect.any(Number) as number, reason: "offline" },
    ]);
    expect(reply.pending[0]!.items).toBeGreaterThanOrEqual(1);
    expect((await compose(["start", B])).code).toBe(0);
    // A test peer stays in memory only (add-identity-and-pairing): after its awd restart, B adds
    // A again. A paired device gets its peers from the signed records instead.
    await waitFor(async () => (await status(B)).engine === "running", 60_000, "engine on B");
    const idA = (await status(A)).sync_id!;
    const again = await aw(B, [
      "sync",
      "peer",
      "add",
      idA,
      "tcp://macbook-pro:22300",
      "--name",
      A,
      "--role",
      "local",
    ]);
    expect(again.code, again.stderr).toBe(0);
    await waitFor(
      async () => (await readFileIn(B, `${WORKSPACE}/knowledge/shared/offline.md`)) === "x\n",
      90_000,
      "the file on B after its restart",
    );
  }, 180_000);

  it("4b. after the whole run: still no discovery, relay or NAT line", async () => {
    for (const device of [A, B]) {
      const lines = leakLines(await engineLog(device));
      evidence("run-leak-lines", { device, lines });
      expect(lines).toEqual([]);
    }
  });
});
