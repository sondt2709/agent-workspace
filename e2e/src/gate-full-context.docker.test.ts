// The journey of openspec gate-full-context on 2 awd containers (e2e/compose.yaml with
// e2e/compose.redaction.yaml; gaps M19, M23, M24; fix list 0-7). ubuntu-01 runs the fake agent. It
// proposes approach v1 with 2 decisions; macbook-pro confirms; the agent proposes v2 (Waits for
// you); macbook-pro confirms; the agent posts a result with a screenshot and a test report, which
// sync to macbook-pro. ubuntu-01 approves while macbook-pro syncs nothing; the later answer of
// macbook-pro becomes a comment, and a new answer gives gate_not_open. The task is Done. A thread
// of 1,100 edits gives its newest events first. Each step writes one "EVIDENCE {json}" line.
import type { Gate, Task, ThreadReply } from "@aw/client";
import type { PairingView } from "@aw/client/identity";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aw,
  awJson,
  compose,
  COMPOSE_FILE,
  exec,
  PROJECT,
  waitFor,
  WORKSPACE,
  type Device,
} from "./compose.ts";

const A: Device = "macbook-pro";
const B: Device = "ubuntu-01";
const PROJECT_SLUG = "demo-api";
const REMOTE = "/remote/demo.git";
const CHECKOUT = "/aw/demo";
const SOCKET = "/aw/state/run/awd.sock";
const GIT_USER = ["-c", "user.name=Agent", "-c", "user.email=agent@example.com"];
const OVERRIDE = fileURLToPath(new URL("../compose.redaction.yaml", import.meta.url));
const FX = "/tmp/fx";
// A 1x1 PNG (synthetic): the screenshot artifact.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc0000003010100c9fe92ef0000000049454e44ae426082",
  "hex",
);
const DECISIONS = [
  {
    question: "Which limit per API key?",
    options: ["100/min", "1000/min"],
    recommended: "100/min",
  },
  {
    question: "Where do we keep the counters?",
    options: ["In memory", "Redis"],
    recommended: "Redis",
  },
];
const FILES: Record<string, string | Buffer> = {
  "approach-v1.md": "# Add rate limits\n\n## Steps\n1. Add a token bucket per API key.\n",
  "approach-v2.md":
    "# Add rate limits (v2: per route)\n\n## Steps\n1. Add a bucket per key and route.\n\nFULL-TEXT-END-MARKER\n",
  "decisions.json": JSON.stringify(DECISIONS),
  "results/result.md": "# Result\n\nAll 42 unit tests pass.\n",
  "results/report.xml":
    '<?xml version="1.0"?>\n<testsuite name="limits" tests="42" failures="0"/>\n',
  "results/shot.png": PNG,
};

function evidence(step: string, data: Record<string, unknown>): void {
  process.stdout.write(`EVIDENCE ${JSON.stringify({ step, ...data })}\n`);
}

/** One method of the awd client in a container: the reply, or `{error}` (exit code 2). */
async function call<T>(device: Device, method: string, args: unknown[]): Promise<T> {
  const r = await exec(device, [
    "node",
    "/repo/e2e/docker/client-call.ts",
    SOCKET,
    method,
    JSON.stringify(args),
  ]);
  if (r.code !== 0 && r.code !== 2) throw new Error(`${method} on ${device}: ${r.stderr}`);
  return JSON.parse(r.stdout) as T;
}

const gates = (device: Device, task: string) =>
  awJson<Gate[]>(device, ["gate", "list", "--task", task, "--all"]);
const openGate = async (device: Device, task: string, kind: string) =>
  (await gates(device, task)).find((g) => g.kind === kind && g.state === "open") ?? null;
const message = (task: string, text: string) => call(A, "sendMessage", ["-", task, text]);
const git = (device: Device, args: string[]) => exec(device, ["git", ...args]);

beforeAll(async () => {
  await compose(["down", "-v", "--remove-orphans"]);
  const up = await execa(
    "docker",
    ["compose", "-f", COMPOSE_FILE, "-f", OVERRIDE, "-p", PROJECT, "up", "-d", "--build"],
    { reject: false },
  );
  if (up.exitCode !== 0) throw new Error(`docker compose up failed: ${up.stderr}`);
  for (const device of [A, B]) {
    await waitFor(
      async () =>
        (await awJson<{ engine: string }>(device, ["sync", "status"])).engine === "running",
      60_000,
      `engine on ${device}`,
    );
  }
}, 900_000);

afterAll(async () => {
  await compose(["down", "-v", "--remove-orphans"]);
});

describe("gate full context across 2 devices", () => {
  let task: Task;

  it("1. pairs ubuntu-01, binds the project on it, and writes the agent files", async () => {
    expect((await aw(A, ["workspace", "init", WORKSPACE, "--name", "demo"])).code).toBe(0);
    expect((await aw(A, ["project", "add", PROJECT_SLUG])).code).toBe(0);
    expect(
      (await aw(A, ["project", "edit", PROJECT_SLUG, "--device", A, "--device", B])).code,
    ).toBe(0);
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
      async () =>
        (
          await awJson<{ peers: { device: string; connected: boolean }[] }>(A, ["sync", "status"])
        ).peers.find((p) => p.device === B && p.connected),
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
    const bound = await aw(B, ["binding", "set", PROJECT_SLUG, CHECKOUT]);
    expect(bound.code, bound.stderr).toBe(0);
    for (const [name, content] of Object.entries(FILES)) {
      const dir = name.includes("/") ? `${FX}/results` : FX;
      const wrote = await exec(
        B,
        ["sh", "-c", 'mkdir -p "$1" && cat > "$2"', "sh", dir, `${FX}/${name}`],
        content,
      );
      expect(wrote.code, wrote.stderr).toBe(0);
    }
    // An agent command reads a file only in the working folder of its session (fix list 0-3): the
    // approach files are in the repository, so the worktree of the task has them in plan/.
    const plan = await exec(B, [
      "sh",
      "-c",
      'mkdir -p "$1/plan" && cp "$2/approach-v1.md" "$2/approach-v2.md" "$2/decisions.json" "$1/plan/" && git -C "$1" add plan && git -C "$1" -c user.name=Agent -c user.email=agent@example.com commit -q -m "Add the plan files"',
      "sh",
      CHECKOUT,
      FX,
    ]);
    expect(plan.code, plan.stderr).toBe(0);
  }, 400_000);

  it("2. approach v1 with 2 decisions reaches macbook-pro with each recommended option", async () => {
    const reply = await awJson<{ task: Task }>(A, [
      "task",
      "create",
      "--project",
      PROJECT_SLUG,
      "--title",
      "Add rate limits",
      "--first-message",
      `bash aw approach $AW_TASK --file plan/approach-v1.md --decisions plan/decisions.json`,
      "--assignee",
      `claude@${B}`,
    ]);
    task = reply.task;
    const gate = await waitFor(
      () => openGate(A, task.id, "confirm_approach"),
      120_000,
      "Confirm approach v1 on macbook-pro",
      1000,
    );
    const work = await call<ThreadReply>(A, "thread", [
      "-",
      task.id,
      { types: "gate.opened", newest: "true", limit: 1000 },
    ]);
    const opened = work.events.find((e) => e.event.data.gate === gate.gate)!;
    expect(work.events.every((e) => e.type === "gate.opened")).toBe(true);
    expect(opened.event.data.decisions).toEqual(DECISIONS);
    evidence("approach-v1", { gate: gate.gate, decisions: opened.event.data.decisions });
    // The session device wrote the turn text as Session only, and the link to its Claude session
    // and terminal; both reach macbook-pro (openspec agent-pushes-updates).
    const synced = await awJson<ThreadReply>(A, ["thread", task.id, "--limit", "1000"]);
    const turns = synced.events.filter((e) => e.type === "message.agent" && e.dev === B);
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every((e) => e.event.data.source === "turn")).toBe(true);
    const started = synced.events.find((e) => e.type === "session.started")!;
    expect(started.dev).toBe(B);
    expect(started.event.data.name).toBe(task.key);
    expect(String((started.event.data.terminal as { pane: unknown }).pane)).toMatch(/^%\d+$/);
    evidence("session-link", {
      turn_sources: turns.map((e) => e.event.data.source),
      name: started.event.data.name,
      terminal: started.event.data.terminal,
    });
    const answered = await aw(A, ["gate", "answer", gate.gate, "Confirm"]);
    expect(answered.code, answered.stderr).toBe(0);
  }, 200_000);

  it("3. after a confirmed v1 the agent proposes v2: latest 2, confirmed 1, both files on macbook-pro", async () => {
    await waitFor(
      async () => (await gates(A, task.id)).every((g) => g.state === "resolved"),
      60_000,
      "v1 resolved",
      1000,
    );
    await message(
      task.id,
      `bash aw approach $AW_TASK --file plan/approach-v2.md --decisions plan/decisions.json`,
    );
    await waitFor(() => openGate(A, task.id, "confirm_approach"), 120_000, "v2 gate", 1000);
    const shown = await awJson<Task & { approach: { latest: number; confirmed: number | null } }>(
      A,
      ["task", "show", task.id],
    );
    expect(shown.approach).toMatchObject({ latest: 2, confirmed: 1 });
    const proposed = await call<ThreadReply>(A, "thread", [
      "-",
      task.id,
      { types: "approach.proposed" },
    ]);
    expect(proposed.events.map((e) => e.event.data.version)).toEqual([1, 2]);
    const text = (await exec(A, ["cat", `${WORKSPACE}/tasks/${task.id}/approach/v2.md`])).stdout;
    expect(text).toContain("FULL-TEXT-END-MARKER");
    evidence("approach-v2", { approach: shown.approach, v2_full_text_marker: true });
    const gate = (await openGate(A, task.id, "confirm_approach"))!;
    expect((await aw(A, ["gate", "answer", gate.gate, "Confirm"])).code).toBe(0);
  }, 200_000);

  it("4. the result with 2 artifacts syncs to macbook-pro with the sizes of artifact.added", async () => {
    await waitFor(
      async () => (await gates(A, task.id)).every((g) => g.state === "resolved"),
      60_000,
      "v2 resolved",
      1000,
    );
    await message(task.id, `copy-files ${FX}/results`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await message(
      task.id,
      "bash aw result $AW_TASK --file result.md --artifact shot.png --artifact report.xml",
    );
    const gate = await waitFor(
      () => openGate(A, task.id, "approve_result"),
      120_000,
      "Approve result on macbook-pro",
      1000,
    );
    const work = await call<ThreadReply>(A, "thread", [
      "-",
      task.id,
      { types: "result.posted,artifact.added", newest: "true", limit: 1000 },
    ]);
    const posted = work.events.find((e) => e.type === "result.posted")!;
    const artifacts = posted.event.data.artifacts as string[];
    expect(artifacts).toEqual([`artifacts/${B}/shot.png`, `artifacts/${B}/report.xml`]);
    const sizes: Record<string, number> = {};
    for (const path of artifacts) {
      const added = work.events.find(
        (e) => e.type === "artifact.added" && e.event.data.path === path,
      )!;
      const size = added.event.data.size as number;
      await waitFor(
        async () =>
          (
            await exec(A, ["stat", "-c", "%s", `${WORKSPACE}/tasks/${task.id}/${path}`])
          ).stdout.trim() === String(size),
        120_000,
        `${path} on macbook-pro`,
        1000,
      );
      sizes[path] = size;
    }
    expect(sizes[`artifacts/${B}/shot.png`]).toBe(PNG.length);
    evidence("result-artifacts", { gate: gate.gate, file: posted.event.data.file, sizes });
  }, 300_000);

  it("5. a late answer becomes a comment, a new answer gives gate_not_open, and the task is Done", async () => {
    const gate = (await openGate(A, task.id, "approve_result"))!;
    expect((await aw(A, ["sync", "pause"])).code).toBe(0);
    const approved = await aw(B, ["gate", "answer", gate.gate, "Approve"]);
    expect(approved.code, approved.stderr).toBe(0);
    await waitFor(
      async () => (await awJson<Task>(B, ["task", "show", task.id])).stage === "done",
      120_000,
      "Done on ubuntu-01",
      1000,
    );
    // macbook-pro syncs nothing: the gate is still open there, so its answer is pending.
    const late = await aw(A, ["gate", "answer", gate.gate, "Request changes", "--comment", "Late"]);
    expect(late.code, late.stderr).toBe(0);
    expect((await aw(A, ["sync", "resume"])).code).toBe(0);
    const resolved = await waitFor(
      async () => {
        const g = (await gates(A, task.id)).find((x) => x.gate === gate.gate);
        return g?.state === "resolved" ? g : null;
      },
      120_000,
      "the resolution on macbook-pro",
      1000,
    );
    const mine = resolved.answers.find((a) => a.dev === A)!;
    expect(mine.use).toBe("comment");
    expect(resolved.answer).toBe("Approve");
    const refused = await call<{ error: { code: string; details: { answer: string } } }>(
      A,
      "answerGate",
      ["-", gate.gate, { answer: "Approve" }],
    );
    expect(refused.error.code).toBe("gate_not_open");
    expect(refused.error.details.answer).toBe("Approve");
    await waitFor(
      async () => (await awJson<Task>(A, ["task", "show", task.id])).stage === "done",
      120_000,
      "Done on macbook-pro",
      1000,
    );
    evidence("late-answer", {
      late_use: mine.use,
      used_answer: resolved.answer,
      refused: refused.error.code,
      stage: "done",
    });
  }, 300_000);

  it("6. a thread of 1,100 edits gives the newest 500 events, and the older page before them", async () => {
    const long = await awJson<{ task: Task }>(A, [
      "task",
      "create",
      "--project",
      PROJECT_SLUG,
      "--title",
      "Long thread",
      "--first-message",
      "hi",
    ]);
    const id = long.task.id;
    const bulk = await exec(A, ["node", "/repo/e2e/docker/bulk-edit.ts", SOCKET, id, "1100"]);
    expect(bulk.code, bulk.stderr).toBe(0);
    const all = await awJson<ThreadReply>(A, ["thread", id, "--from", "0"]).catch(() => null);
    const newest = await call<ThreadReply>(A, "thread", ["-", id, { newest: "true", limit: 500 }]);
    const lastData = newest.events.at(-1)!.event.data;
    expect(JSON.stringify(lastData)).toContain("Edit 1099 from macbook-pro");
    expect(newest.events).toHaveLength(500);
    expect(newest.next).toBeNull();
    expect(newest.prev).not.toBeNull();
    const older = await call<ThreadReply>(A, "thread", [
      "-",
      id,
      { before: newest.prev, limit: 500 },
    ]);
    expect(older.events).toHaveLength(500);
    expect(older.events.at(-1)!.hlc <= newest.events[0]!.hlc).toBe(true);
    evidence("long-thread", {
      first_page_size: all?.events.length ?? null,
      newest_last: lastData,
      newest_count: newest.events.length,
      older_count: older.events.length,
    });
  }, 300_000);
});
