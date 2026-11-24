// The terminal view journey on 2 awd containers (e2e/compose.yaml with e2e/compose.redaction.yaml;
// openspec task-terminal-view, gaps M12 and M18). ubuntu-01 pairs with a code and runs a session of
// the fake agent with the credential staging-api-key. The agent shows the value on its screen, waits
// 40 s, then asks a question. macbook-pro reads the snapshot of ubuntu-01 through the terminal route
// and in the synced file: the value shows as the marker, a periodic snapshot comes first, and the gate
// writes a new snapshot at once. The route gives the ssh commands of "Open the terminal" and
// "Sign in". Run it with "task e2e". Each step writes one "EVIDENCE {json}" line to stdout.
import type { SyncStatusReply, Task, ThreadReply } from "@aw/client";
import type { PairingView } from "@aw/client/identity";
import type { TerminalReply } from "@aw/client/terminal";
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
const GIT_USER = ["-c", "user.name=Agent", "-c", "user.email=agent@example.com"];
const OVERRIDE = fileURLToPath(new URL("../compose.redaction.yaml", import.meta.url));
// A synthetic value for the test: not a real key.
const VALUE = "stg_live_9f8e7d6c5b4a_terminal";
const MARKER = "[redacted:staging-api-key]";
/** The screen line of the `aw ask` tool call: only the gate screen has it (the first input does not). */
const ASK_CALL = '"command":"aw ask';
const FIRST = [
  "steps",
  "use-credential staging-api-key 120",
  "wait 40000",
  "ask Which region? | eu|us",
].join("\n");

function evidence(step: string, data: Record<string, unknown>): void {
  process.stdout.write(`EVIDENCE ${JSON.stringify({ step, ...data })}\n`);
}

const status = (device: Device) => awJson<SyncStatusReply>(device, ["sync", "status"]);
const git = (device: Device, args: string[]) => exec(device, ["git", ...args]);
const terminal = (device: Device, task: string) =>
  awJson<TerminalReply>(device, ["terminal", task]);
const header = (content: string) => {
  try {
    return JSON.parse(content.split("\n")[0]!) as { captured_at?: string; device?: string };
  } catch {
    return {};
  }
};

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

describe("terminal view of a session on another device", () => {
  let task: Task;

  it("1. pairs ubuntu-01 with a code, binds the project on it, and adds the credential", async () => {
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
    const bound = await aw(B, ["binding", "set", PROJECT_SLUG, CHECKOUT]);
    expect(bound.code, bound.stderr).toBe(0);
    // The value comes from stdin, never from an argument.
    const added = await exec(A, ["aw", "credential", "add", "staging-api-key"], `${VALUE}\n`);
    expect(added.code, added.stderr).toBe(0);
    await waitFor(
      async () =>
        (await awJson<{ name: string }[]>(B, ["credential", "list"])).some(
          (c) => c.name === "staging-api-key",
        ),
      60_000,
      "the credential on B",
    );
  }, 400_000);

  it("2. the session on ubuntu-01 shows the value; macbook-pro gets a periodic snapshot with the marker", async () => {
    const reply = await awJson<{ task: Task }>(A, [
      "task",
      "create",
      "--project",
      PROJECT_SLUG,
      "--title",
      "Call the staging API",
      "--first-message",
      FIRST,
      "--assignee",
      `claude@${B}`,
      "--credential",
      "staging-api-key",
    ]);
    task = reply.task;
    const file = `${WORKSPACE}/tasks/${task.id}/terminal/${B}.txt`;
    let periodic = "";
    await waitFor(
      async () => {
        periodic = (await exec(A, ["cat", file])).stdout;
        return periodic.includes(MARKER);
      },
      120_000,
      "a periodic snapshot of ubuntu-01 with the marker on macbook-pro",
      1000,
    );
    evidence("periodic-snapshot", {
      header: header(periodic),
      has_ask_call: periodic.includes(ASK_CALL),
      tail: periodic.split("\n").slice(-4),
    });
    expect(periodic).not.toContain(VALUE);
    expect(periodic).not.toContain(ASK_CALL);
    expect(header(periodic).device).toBe(B);
  }, 200_000);

  it("3. the gate writes a new snapshot at once, and macbook-pro reads it through the route", async () => {
    const thread = () =>
      awJson<ThreadReply>(B, ["thread", task.id, "--limit", "1000"]).then((t) => t.events);
    await waitFor(
      async () =>
        (await thread()).some(
          (r) =>
            r.type === "gate.opened" && (r.event.data as { kind?: string }).kind === "question",
        ),
      120_000,
      "the gate on ubuntu-01",
      1000,
    );
    const gate = (await thread()).find(
      (r) => r.type === "gate.opened" && (r.event.data as { kind?: string }).kind === "question",
    )!;
    const gateMs = Date.parse(gate.hlc.slice(0, 24));
    let reply: TerminalReply | null = null;
    await waitFor(
      async () => {
        reply = await terminal(A, task.key!);
        return reply.snapshot?.text.includes(ASK_CALL) ?? false;
      },
      60_000,
      "the gate snapshot through the route on macbook-pro",
      1000,
    );
    const got = reply!;
    const capturedMs = Date.parse(got.snapshot!.captured_at!);
    evidence("gate-snapshot", {
      gate_hlc: gate.hlc,
      captured_at: got.snapshot!.captured_at,
      delay_ms: capturedMs - gateMs,
      device: got.snapshot!.device,
      text_tail: got.snapshot!.text.split("\n").slice(-4),
      open: got.open,
      sign_in: got.sign_in,
      note: got.note,
    });
    expect(got.snapshot!.device).toBe(B);
    expect(got.snapshot!.text).toContain(`I used the key ${MARKER} for the staging call.`);
    expect(capturedMs - gateMs).toBeGreaterThanOrEqual(-50);
    expect(capturedMs - gateMs).toBeLessThan(3000);
    expect(got.open).toEqual({
      kind: "copy",
      device: B,
      local: false,
      command: `ssh -t ${B} tmux -L aw attach -t aw:aw-${task.id}`,
      text: `Run this command to open the terminal of ${B}:`,
    });
    expect(got.sign_in).toMatchObject({ command: `ssh -t ${B} claude auth login` });

    const text = await aw(A, ["terminal", task.key!]);
    evidence("aw-terminal", { stdout: text.stdout.split("\n").slice(0, 3) });
    expect(text.stdout.split("\n")[0]).toMatch(/^ubuntu-01 · captured /);
  }, 200_000);

  it("4. no file on either computer has the value", async () => {
    const result: Record<string, string[]> = {};
    for (const device of [A, B]) {
      const grep = await exec(device, ["grep", "-rlF", "--", VALUE, WORKSPACE]);
      result[device] = grep.stdout.split("\n").filter(Boolean);
    }
    evidence("grep-value", result);
    expect(result[A]).toEqual([]);
    // ubuntu-01: only the binary artifact of the fake agent is not in the task folder (it stays in
    // the worktree), so the workspace folder has no file with the value.
    expect(result[B]).toEqual([]);
  }, 60_000);
});
