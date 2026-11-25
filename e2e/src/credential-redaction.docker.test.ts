// The redaction journey on 2 awd containers (e2e/compose.yaml with e2e/compose.redaction.yaml;
// openspec credential-redaction, gap M13). macbook-pro runs a session of the fake agent with the
// credential staging-api-key. The agent writes the value in a long reply, proposal versions, a
// copied text file, a result, a handoff and a binary file, and its token in a long message. On both
// computers, no synced text file has the value or the token: each has the redaction marker. The
// binary keeps its bytes. Run it with "task e2e". Each step writes one "EVIDENCE {json}" line.
import type { SyncStatusReply, Task, ThreadReply } from "@aw/client";
import { execa } from "execa";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aw,
  awJson,
  compose,
  COMPOSE_FILE,
  copyBetween,
  exec,
  PROJECT,
  waitFor,
  WORKSPACE,
  type Device,
} from "./compose.ts";

const A: Device = "macbook-pro";
const B: Device = "ubuntu-01";
const PROJECT_SLUG = "demo-api";
const REPO = "/aw/repo";
const OVERRIDE = fileURLToPath(new URL("../compose.redaction.yaml", import.meta.url));
// A synthetic value for the test: not a real key.
const VALUE = "stg_live_9f8e7d6c5b4a_docker";
const MARKER = "[redacted:staging-api-key]";

/** The first message: a script of turns of the fake agent (`steps`). */
const STEPS = [
  "steps",
  "use-credential staging-api-key 40000",
  'bash aw proposal "$AW_TASK" --file proposal.md',
  'bash aw artifact add "$AW_TASK" notes.txt',
  'bash aw handoff "$AW_TASK" --file handoff.md',
  'bash aw result "$AW_TASK" --file result.md --artifact image.bin',
  "plan-file proposal.md",
  "plan-file notes.txt",
  // A long message with the session token: it goes to a text file of the task.
  `bash aw message "$AW_TASK" "token $AW_MCP_TOKEN $(head -c 40000 /dev/zero | tr '\\0' y)"`,
  "reply All steps done.",
].join("\n");

function evidence(step: string, data: Record<string, unknown>): void {
  process.stdout.write(`EVIDENCE ${JSON.stringify({ step, ...data })}\n`);
}

const status = (device: Device) => awJson<SyncStatusReply>(device, ["sync", "status"]);

/** The files of a folder in a container that have a text (grep -rlF), relative to the folder. */
async function filesWith(device: Device, folder: string, text: string): Promise<string[]> {
  const result = await exec(device, ["grep", "-rlF", "--", text, folder]);
  if (result.code > 1) throw new Error(`grep on ${device} failed: ${result.stderr}`);
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((path) => path.slice(folder.length + 1))
    .sort();
}

/** The sha256 of each file of a task folder in a container (tasks/<id>/...), without the logs. */
async function digests(device: Device, task: string): Promise<Record<string, string>> {
  const folder = `${WORKSPACE}/tasks/${task}`;
  const list = await exec(device, ["find", folder, "-type", "f", "-not", "-path", "*/log/*"]);
  const out: Record<string, string> = {};
  for (const path of list.stdout.split("\n").filter(Boolean).sort()) {
    const bytes = await execa(
      "docker",
      ["compose", "-f", COMPOSE_FILE, "-p", PROJECT, "exec", "-T", device, "cat", path],
      { encoding: "buffer", stripFinalNewline: false },
    );
    out[path.slice(folder.length + 1)] = createHash("sha256").update(bytes.stdout).digest("hex");
  }
  return out;
}

const shortName = (path: string) =>
  path.replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|\d{8}T\d{6}/g, "*");

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
      async () => (await status(device)).engine === "running",
      60_000,
      `engine on ${device}`,
    );
  }
}, 900_000);

afterAll(async () => {
  await compose(["down", "-v", "--remove-orphans"]);
});

describe("redaction of agent files on 2 computers", () => {
  let task: Task;

  it("1. pairs the 2 devices; macbook-pro has the project, its checkout and the credential", async () => {
    expect((await aw(A, ["workspace", "init", WORKSPACE, "--name", "demo"])).code).toBe(0);
    expect((await aw(A, ["project", "add", PROJECT_SLUG])).code).toBe(0);
    expect((await exec(A, ["git", "init", "-q", "-b", "main", REPO])).code).toBe(0);
    const commit = await exec(A, [
      "git",
      "-C",
      REPO,
      "-c",
      "user.name=AW Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    ]);
    expect(commit.code).toBe(0);
    expect((await aw(A, ["binding", "set", PROJECT_SLUG, REPO])).code).toBe(0);
    // The value comes from stdin, never from an argument.
    const added = await exec(A, ["aw", "credential", "add", "staging-api-key"], `${VALUE}\n`);
    expect(added.code, added.stderr).toBe(0);

    await exec(B, ["mkdir", "-p", `${WORKSPACE}/tasks`]);
    await copyBetween(A, B, WORKSPACE, ["tasks/workspace.yaml", "tasks/schemas"]);
    expect((await aw(B, ["workspace", "init", WORKSPACE])).code).toBe(0);
    const [idA, idB] = [(await status(A)).sync_id!, (await status(B)).sync_id!];
    const peer = (device: Device, id: string, name: Device, role: string) =>
      aw(device, [
        "sync",
        "peer",
        "add",
        id,
        `tcp://${name}:22300`,
        "--name",
        name,
        "--role",
        role,
      ]);
    expect((await peer(A, idB, B, "remote")).code).toBe(0);
    expect((await peer(B, idA, A, "local")).code).toBe(0);
    await waitFor(async () => (await status(A)).peers[0]?.connected, 30_000, "A connected to B");
  }, 120_000);

  it("2. the agent of macbook-pro writes the value and its token in its files", async () => {
    const reply = await awJson<{ task: Task }>(A, [
      "task",
      "create",
      "--project",
      PROJECT_SLUG,
      "--title",
      "Call the staging API",
      "--first-message",
      STEPS,
      "--assignee",
      `claude@${A}`,
      "--credential",
      "staging-api-key",
    ]);
    task = reply.task;
    const thread = () =>
      awJson<ThreadReply>(A, ["thread", task.id, "--limit", "1000"]).then((t) => t.events);
    try {
      await waitFor(
        async () =>
          (await thread()).some(
            (r) =>
              r.type === "message.agent" &&
              (r.event.data as { text?: string }).text === "All steps done.",
          ),
        120_000,
        "the last step of the agent",
      );
    } finally {
      const screen = await exec(A, [
        "tmux",
        "-L",
        "aw",
        "capture-pane",
        "-p",
        "-t",
        `aw-${task.id}`,
      ]);
      evidence("agent-screen", { screen: screen.stdout.slice(-1500) });
    }
    const rows = await thread();
    evidence("agent-thread", {
      types: rows.map((r) => r.type),
      proposal_gates: rows
        .filter((r) => r.type === "gate.opened")
        .map((r) => (r.event.data as { file?: string }).file ?? null),
    });
    expect(
      rows
        .filter(
          (r) =>
            r.type === "gate.opened" &&
            (r.event.data as { kind?: string }).kind === "approve_proposal",
        )
        .map((r) => (r.event.data as { file?: string }).file),
    ).toEqual(["proposal/v1.md", "proposal/v1.md", "proposal/v2.md"]);
    expect(rows.filter((r) => r.type === "artifact.added")).toHaveLength(2);
  }, 180_000);

  it("3. on both computers, no text file has the value or the token; the binary keeps its bytes", async () => {
    const sessions = await exec(A, ["ls", "/aw/state/sessions"]);
    const session = sessions.stdout.split("\n").find((s) => /^[0-9a-f-]{36}$/.test(s))!;
    const token = (await exec(A, ["cat", `/aw/state/sessions/${session}/mcp-token`])).stdout.trim();
    expect(token).toMatch(/^awt_/);

    // B gets the same task files (the artifacts sync between computers).
    const onA = await digests(A, task.id);
    await waitFor(
      async () => JSON.stringify(await digests(B, task.id)) === JSON.stringify(onA),
      90_000,
      "the task files on B",
    );
    const result: Record<string, unknown> = { files: Object.keys(onA).map(shortName) };
    for (const device of [A, B]) {
      result[`value_${device}`] = (await filesWith(device, WORKSPACE, VALUE)).map(shortName);
      result[`token_${device}`] = (await filesWith(device, WORKSPACE, token)).map(shortName);
      result[`marker_${device}`] = (await filesWith(device, WORKSPACE, MARKER)).map(shortName);
      result[`token_marker_${device}`] = (
        await filesWith(device, WORKSPACE, "[redacted:mcp-token]")
      ).map(shortName);
    }
    evidence("grep", result);
    const binary = `tasks/*/artifacts/${A}/image.bin`;
    for (const device of [A, B]) {
      // Only the binary artifact keeps the value: AW writes a binary file as it is.
      expect(result[`value_${device}`]).toEqual([binary]);
      expect(result[`token_${device}`]).toEqual([]);
      expect(result[`marker_${device}`]).toEqual(
        expect.arrayContaining([
          "tasks/*/proposal/v1.md",
          "tasks/*/proposal/v2.md",
          `tasks/*/artifacts/${A}/handoff-*.md`,
          `tasks/*/artifacts/${A}/notes.txt`,
          `tasks/*/artifacts/${A}/result-*.md`,
          `tasks/*/artifacts/${A}/text-*.md`,
        ]),
      );
      expect(result[`token_marker_${device}`]).toEqual(
        expect.arrayContaining([`tasks/*/artifacts/${A}/text-*.md`]),
      );
    }
    // The binary has the same bytes as the file of the agent, and artifact.added has its sha256.
    const worktree = await execa(
      "docker",
      [
        "compose",
        "-f",
        COMPOSE_FILE,
        "-p",
        PROJECT,
        "exec",
        "-T",
        A,
        "cat",
        `/aw/state/worktrees/aw-${task.key}/image.bin`,
      ],
      { encoding: "buffer", stripFinalNewline: false },
    );
    const source = createHash("sha256").update(worktree.stdout).digest("hex");
    expect(onA[`artifacts/${A}/image.bin`]).toBe(source);
    const added = (await awJson<ThreadReply>(B, ["thread", task.id, "--limit", "1000"])).events
      .filter((r) => r.type === "artifact.added")
      .map((r) => r.event.data as { path: string; sha256: string });
    evidence("artifact-added-on-b", { added });
    for (const row of added) expect(row.sha256).toBe(onA[row.path]);
  }, 180_000);
});
