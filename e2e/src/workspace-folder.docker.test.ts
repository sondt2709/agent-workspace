// The workspace folder rule on 2 awd containers (e2e/compose.yaml; openspec workspace-folder,
// docs/decisions/2026-11-24-workspace-folder.md). ubuntu-01 joins 2 workspaces of macbook-pro
// into a location that holds other files, and the name "demo" is taken. Run it with "task e2e".
// Each step writes one "EVIDENCE {json}" line to stdout.
import type { SyncStatusReply, WorkspaceSummary } from "@aw/client";
import type { PairingView } from "@aw/client/identity";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { aw, awJson, compose, exec, waitFor, type Device } from "./compose.ts";

const A: Device = "macbook-pro";
const B: Device = "ubuntu-01";
/** The location on ubuntu-01: it holds files of the person. */
const WORK = "/aw/work";
const FIRST = "/aw/ws-demo";
const SECOND = "/aw/ws-demo-2";

function evidence(step: string, data: Record<string, unknown>): void {
  process.stdout.write(`EVIDENCE ${JSON.stringify({ step, ...data })}\n`);
}

async function sh(device: Device, script: string, ...args: string[]): Promise<string> {
  const result = await exec(device, ["sh", "-c", script, "sh", ...args]);
  if (result.code !== 0) throw new Error(`${script}: ${result.stderr}`);
  return result.stdout;
}

const status = (device: Device) => awJson<SyncStatusReply>(device, ["sync", "status"]);

/** Shows a code on A for a workspace, joins it on B with --in, approves it, waits for the folder. */
async function joinInto(
  ws: string,
  location: string,
): Promise<{ joined: PairingView; ms: number }> {
  const started = Date.now();
  const offer = await awJson<PairingView>(A, ["-w", ws, "device", "add", "--no-wait"]);
  const joined = await awJson<PairingView>(B, ["pair", offer.code!, "--in", location, "--no-wait"]);
  await waitFor(
    async () => {
      const result = await aw(A, ["--json", "device", "approve", offer.id, joined.check_code!]);
      return result.code === 0 ? true : null;
    },
    60_000,
    `the approval of ${ws}`,
    1000,
  );
  await waitFor(
    async () => {
      const list = await aw(B, ["--json", "workspace", "list"]);
      if (list.code !== 0) return null;
      const spaces = JSON.parse(list.stdout) as WorkspaceSummary[];
      return spaces.some((s) => s.id === ws && s.ready) ? true : null;
    },
    120_000,
    `the workspace ${ws} registered on ubuntu-01`,
  );
  return { joined, ms: Date.now() - started };
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

describe("workspace folder rule between 2 awd containers", () => {
  let first: string;
  let second: string;

  it("1. refuses the old --path form for a folder with other files, and names --in", async () => {
    expect((await aw(A, ["workspace", "init", FIRST, "--name", "demo"])).code).toBe(0);
    expect((await aw(A, ["project", "add", "demo-api"])).code).toBe(0);
    first = (await awJson<{ id: string }[]>(A, ["workspace", "list"]))[0]!.id;
    await waitFor(
      async () =>
        (await exec(A, ["test", "-f", `${FIRST}/tasks/devices/macbook-pro/device.yaml`])).code ===
        0,
      30_000,
      "the own record of A",
    );
    // The location of the person: a file, and a folder "demo" with a file.
    await sh(
      B,
      'mkdir -p "$1/demo" && echo "notes of the person" > "$1/readme.txt" && echo "x" > "$1/demo/report.pdf"',
      WORK,
    );
    const offer = await awJson<PairingView>(A, ["device", "add", "--no-wait"]);
    const exact = await aw(B, ["pair", offer.code!, "--path", WORK, "--no-wait"]);
    expect(exact.code).toBe(1);
    expect(exact.stderr).toContain(`--in ${WORK}`);
    expect((await awJson<unknown[]>(B, ["workspace", "list"])).length).toBe(0);
    await aw(A, ["device", "cancel", offer.id]);
    evidence("old-path-refused", { code: exact.code, stderr: exact.stderr.trim() });
  });

  it("2. joins into <location>/demo-aw1, keeps the files of the person, shows the folder", async () => {
    const { joined, ms } = await joinInto(first, WORK);
    expect(joined.folder).toBe(`${WORK}/demo-aw1`);
    expect(joined.folder_note).toBe(
      `${WORK}/demo is in use (other files), so AW uses ${WORK}/demo-aw1.`,
    );
    const list = await awJson<WorkspaceSummary[]>(B, ["workspace", "list"]);
    expect(list.map((w) => [w.id, w.path])).toEqual([[first, `${WORK}/demo-aw1`]]);
    expect((await sh(B, 'ls -A "$1"', WORK)).trim().split("\n").sort()).toEqual([
      "demo",
      "demo-aw1",
      "readme.txt",
    ]);
    expect((await sh(B, 'ls -A "$1/demo"', WORK)).trim()).toBe("report.pdf");
    const yaml = parse(await sh(B, 'cat "$1/demo-aw1/tasks/workspace.yaml"', WORK)) as {
      id: string;
    };
    expect(yaml.id).toBe(first);
    const text = await aw(B, ["status"]);
    expect(text.stdout).toContain(`  Folder: ${WORK}/demo-aw1`);
    // A task of A arrives in the folder on B.
    const created = await awJson<{ task: { id: string } }>(A, [
      "task",
      "create",
      "--project",
      "demo-api",
      "--title",
      "After the join",
      "--first-message",
      "Run the tests.",
    ]);
    await waitFor(
      async () => (await aw(B, ["-w", first, "task", "show", created.task.id])).code === 0,
      60_000,
      "the task on ubuntu-01",
    );
    evidence("join-location", {
      folder: joined.folder,
      note: joined.folder_note,
      registered_after_ms: ms,
      status: text.stdout.trim(),
    });
  });

  it("3. joins a second workspace with the same name into demo-aw2", async () => {
    expect(
      (await aw(A, ["workspace", "init", SECOND, "--name", "demo", "--key-prefix", "DM"])).code,
    ).toBe(0);
    const spaces = await awJson<WorkspaceSummary[]>(A, ["workspace", "list"]);
    second = spaces.find((w) => w.path === SECOND)!.id;
    await waitFor(
      async () =>
        (await exec(A, ["test", "-f", `${SECOND}/tasks/devices/macbook-pro/device.yaml`])).code ===
        0,
      30_000,
      "the own record of A in the second workspace",
    );
    const { joined, ms } = await joinInto(second, WORK);
    expect(joined.folder).toBe(`${WORK}/demo-aw2`);
    expect(joined.folder_note).toBe(
      `${WORK}/demo is in use (other files), ${WORK}/demo-aw1 is in use (another workspace), so AW uses ${WORK}/demo-aw2.`,
    );
    const list = await awJson<WorkspaceSummary[]>(B, ["workspace", "list"]);
    expect(list.map((w) => w.path).sort()).toEqual([`${WORK}/demo-aw1`, `${WORK}/demo-aw2`]);
    const text = await aw(B, ["status"]);
    expect(text.stdout).toContain(`  Folder: ${WORK}/demo-aw2`);
    evidence("second-workspace", { folder: joined.folder, note: joined.folder_note, ms });
  });

  it("4. refuses a location inside a workspace folder and in AW_HOME", async () => {
    const inside = await aw(B, [
      "workspace",
      "init",
      "--in",
      `${WORK}/demo-aw1/sub`,
      "--name",
      "x",
    ]);
    expect(inside.code).toBe(1);
    expect(inside.stderr).toContain(`the workspace folder ${WORK}/demo-aw1`);
    const state = await aw(B, ["workspace", "init", "--in", "/aw/state", "--name", "x"]);
    expect(state.code).toBe(1);
    expect(state.stderr).toContain("state folder");
    expect((await awJson<unknown[]>(B, ["workspace", "list"])).length).toBe(2);
    evidence("safety", { inside: inside.stderr.trim(), state: state.stderr.trim() });
  });
});
