// The journey of openspec gate-context on 2 awd containers (e2e/compose.yaml with
// e2e/compose.redaction.yaml; fix list ux-4). ubuntu-01 runs the fake agent. It asks a question with
// a details file of 20 KiB and option descriptions; macbook-pro gets the gate with the question as
// the title, the start of the details, the options with their descriptions and the full details
// file. The agent then calls AskUserQuestion with 2 questions; macbook-pro answers both in one text,
// and the session on ubuntu-01 gets it. Last, the agent writes its analysis and asks "see the message
// above": macbook-pro finds the analysis as the context of the gate. Each step writes one
// "EVIDENCE {json}" line.
import type { Gate, Task, ThreadReply } from "@aw/client";
import { gateContext, gateHasBody, gateQuestions, questionAnswer } from "@aw/client/gates";
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
const DETAILS = `## Options\n\n${"- Library A runs in the same process. Library B is a service.\n".repeat(330)}\nDETAILS-END-MARKER\n`;
const ANALYSIS =
  "Gate: queue library A or B\n\n1. Solution\nLibrary A runs in the same process.\n\n2. High risk\nB opens a new port.";
const QUESTIONS = {
  questions: [
    {
      question: "Which queue library do we use?",
      header: "Library",
      multiSelect: false,
      options: [
        { label: "Library A", description: "Same process" },
        { label: "Library B", description: "A separate service" },
      ],
    },
    {
      question: "Which checks must run?",
      header: "Checks",
      multiSelect: true,
      options: [
        { label: "Unit tests", description: "Vitest" },
        { label: "E2E", description: "Docker" },
      ],
    },
  ],
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
const openQuestion = async (device: Device, task: string, title: string) =>
  (await gates(device, task)).find(
    (g) => g.kind === "question" && g.state === "open" && g.title === title,
  ) ?? null;
const message = (task: string, text: string) => call(A, "sendMessage", ["-", task, text]);
const git = (device: Device, args: string[]) => exec(device, ["git", ...args]);
const thread = (device: Device, task: string) =>
  call<ThreadReply>(device, "thread", ["-", task, { limit: 1000 }]);

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

describe("question details and context across 2 devices", () => {
  let task: Task;

  it("1. pairs ubuntu-01, binds the project on it, and commits the details file", async () => {
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
    // An agent command reads a file only in the working folder of its session: the details file is
    // in the repository, so the worktree of the task has it in plan/.
    const plan = await exec(
      B,
      [
        "sh",
        "-c",
        'mkdir -p "$1/plan" && cat > "$1/plan/details.md" && git -C "$1" add plan && git -C "$1" -c user.name=Agent -c user.email=agent@example.com commit -q -m "Add the details"',
        "sh",
        CHECKOUT,
      ],
      DETAILS,
    );
    expect(plan.code, plan.stderr).toBe(0);
  }, 400_000);

  it("2. a question with a details file of 20 KiB reaches macbook-pro with its parts", async () => {
    const reply = await awJson<{ task: Task }>(A, [
      "task",
      "create",
      "--project",
      PROJECT_SLUG,
      "--title",
      "Pick a queue library",
      "--first-message",
      'bash aw ask $AW_TASK "Which queue library?" --details-file plan/details.md --option "Library A::Same process" --option "Library B::A separate service"',
      "--assignee",
      `claude@${B}`,
    ]);
    task = reply.task;
    const gate = await waitFor(
      () => openQuestion(A, task.id, "Which queue library?"),
      120_000,
      "the question on macbook-pro",
      1000,
    );
    const opened = (await thread(A, task.id)).events.find(
      (e) => e.type === "gate.opened" && e.event.data.gate === gate.gate,
    )!;
    const data = opened.event.data;
    const file = `artifacts/${B}/text-${gate.gate}.md`;
    expect(data).toMatchObject({
      title: "Which queue library?",
      file,
      options: ["Library A", "Library B"],
    });
    expect(String(data.text)).toContain(`(the full text is in ${file})`);
    expect(String(data.text)).not.toContain("DETAILS-END-MARKER");
    expect(gateQuestions(data)[0]!.options).toEqual([
      { label: "Library A", description: "Same process" },
      { label: "Library B", description: "A separate service" },
    ]);
    const full = await waitFor(
      async () => {
        const r = await exec(A, ["cat", `${WORKSPACE}/tasks/${task.id}/${file}`]);
        return r.code === 0 && r.stdout.includes("DETAILS-END-MARKER") ? r.stdout : null;
      },
      60_000,
      "the details file on macbook-pro",
      1000,
    );
    expect(full).toBe(DETAILS);
    evidence("details", {
      gate: gate.gate,
      title: data.title,
      text_chars: String(data.text).length,
      file,
      file_chars: full.length,
      questions: data.questions,
    });
    expect((await aw(A, ["gate", "answer", gate.gate, "Library A"])).code).toBe(0);
  }, 200_000);

  it("3. AskUserQuestion with 2 questions: macbook-pro answers both, the session gets one text", async () => {
    await waitFor(
      async () => (await gates(A, task.id)).every((g) => g.state === "resolved"),
      60_000,
      "the first question resolved",
      1000,
    );
    await message(task.id, `ask-tool-json ${JSON.stringify(QUESTIONS)}`);
    const gate = await waitFor(
      () => openQuestion(A, task.id, "Which queue library do we use?"),
      120_000,
      "the AskUserQuestion gate on macbook-pro",
      1000,
    );
    const data = (await thread(A, task.id)).events.find(
      (e) => e.type === "gate.opened" && e.event.data.gate === gate.gate,
    )!.event.data;
    const questions = gateQuestions(data);
    expect(questions.map((q) => [q.header, q.multi_select, q.options.length])).toEqual([
      ["Library", false, 2],
      ["Checks", true, 2],
    ]);
    expect(gate.options).toEqual([]);
    expect(gateHasBody(gate.title, String(data.text), questions)).toBe(false);
    const answer = questionAnswer(questions, [["Library B"], ["E2E", "Unit tests"]]);
    expect((await aw(A, ["gate", "answer", gate.gate, answer])).code).toBe(0);
    const delivered = await waitFor(
      async () =>
        (await thread(B, task.id)).events.find(
          (e) => e.type === "message.human" && e.event.data.delivery_id === gate.gate,
        ) ?? null,
      90_000,
      "the answer in the session on ubuntu-01",
      1000,
    );
    expect(delivered.event.data.text).toBe(`[AW answer ${gate.gate}] ${answer}`);
    evidence("two-questions", { gate: gate.gate, questions, delivered: delivered.event.data.text });
  }, 300_000);

  it("4. a question that points at an earlier message has that message as its context", async () => {
    await waitFor(
      async () => (await gates(A, task.id)).every((g) => g.state === "resolved"),
      60_000,
      "the AskUserQuestion gate resolved",
      1000,
    );
    // One Bash call of the agent (one turn): the analysis, then the question that points at it. The
    // fake agent runs one line, so printf makes the line breaks.
    const printf = ANALYSIS.replace(/\n/g, "\\n");
    await message(
      task.id,
      `bash aw message $AW_TASK "$(printf '${printf}')" && aw ask $AW_TASK "Which option? (see the message above)" --options "a|b"`,
    );
    const gate = await waitFor(
      () => openQuestion(A, task.id, "Which option? (see the message above)"),
      120_000,
      "the pointer question on macbook-pro",
      1000,
    );
    const events = (await thread(A, task.id)).events;
    const opened = events.find((e) => e.type === "gate.opened" && e.event.data.gate === gate.gate)!;
    expect(gateHasBody(gate.title, String(opened.event.data.text))).toBe(false);
    const context = gateContext(
      events.map((e) => ({
        id: e.id,
        type: e.type,
        by: e.event.by ?? null,
        text: typeof e.event.data.text === "string" ? e.event.data.text : null,
      })),
      opened.id,
    );
    evidence("context-thread", {
      tail: events
        .slice(-8)
        .map((e) => [
          e.type,
          e.dev,
          e.event.by,
          (typeof e.event.data.text === "string" ? e.event.data.text : "").slice(0, 80),
        ]),
    });
    expect(context.map((c) => c.text)).toEqual([ANALYSIS]);
    evidence("context", { gate: gate.gate, context: context.map((c) => [c.by, c.text]) });
  }, 200_000);
});
