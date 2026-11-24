// Test plan 3: awd as a real child process gets SIGKILL during a session. The tmux window keeps the
// same agent pid, the hook events of the downtime stay in the spool, and the new awd delivers the
// answer that arrived while it was down, with no resume.
import { FAKE_CLAUDE } from "@aw/agent-claude/testing";
import { AwClient } from "@aw/client";
import { openWorkspace, systemClock, type EventRow } from "@aw/core";
import { TmuxHost } from "@aw/host-tmux";
import { execa } from "execa";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadSettings } from "../settings.ts";
import { otherDevice, tempDir, waitFor, writeTestConfig } from "../testing.ts";
import { TEST_TMUX } from "./testing.ts";

const AWD = fileURLToPath(new URL("../bin/awd.ts", import.meta.url));
const socket = `aw-test-${process.pid}-restart`;
let home = "";
let folder = "";
let awd: ChildProcess | null = null;
let stderr = "";

const env = () => ({
  ...process.env,
  AW_HOME: home,
  HOME: home,
  AW_LOG_LEVEL: "info",
  AW_CLAUDE: FAKE_CLAUDE,
  AW_TMUX: TEST_TMUX ?? "",
  AW_TMUX_SOCKET: socket,
  // A full disk of the test computer must not stop the session (add-continuity).
  AW_DISK_FULL_PERCENT: "100",
});

function startAwd(): ChildProcess {
  const child = spawn(process.execPath, [AWD], { env: env(), stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  return child;
}

const data = (row: EventRow) => (row.event as { data: Record<string, unknown> }).data;

afterAll(async () => {
  awd?.kill("SIGKILL");
  if (TEST_TMUX) {
    await new TmuxHost({ binary: TEST_TMUX, socket, configFile: "/dev/null" }).killServer();
  }
  if (home) await rm(home, { recursive: true, force: true });
  if (folder) await rm(folder, { recursive: true, force: true });
});

describe.skipIf(!TEST_TMUX)("awd restart during a session", () => {
  it("keeps the agent alive, loses no hook event, and delivers the missed answer", async () => {
    home = await tempDir("awr-");
    folder = await tempDir("awf-");
    await writeTestConfig(loadSettings({ AW_HOME: home, HOME: home }));
    const checkout = join(home, "checkout");
    await mkdir(checkout);
    await writeFile(join(checkout, "README.md"), "x\n");
    for (const args of [
      ["init", "-q", "-b", "main"],
      ["add", "."],
      ["-c", "user.name=AW Test", "-c", "user.email=test@example.com", "commit", "-qm", "init"],
    ]) {
      await execa("git", ["-C", checkout, ...args]);
    }
    awd = startAwd();
    const client = new AwClient({ socketPath: join(home, "run", "awd.sock") });
    const ready = async () =>
      waitFor(async () => (await client.ready().catch(() => null))?.ready ?? false, 15_000);
    await ready();
    await client.initWorkspace({ path: folder, name: "acme" });
    await client.addProject("-", { slug: "billing-api", permission_mode: "default" });
    await openWorkspace({
      root: folder,
      device: "macbook-pro",
      role: "local",
      clock: systemClock,
    }).writeDocument("tasks/devices/macbook-pro/bindings.yaml", {
      kind: "bindings",
      schema: 1,
      device: "macbook-pro",
      may_run: true,
      checkouts: [{ project: "billing-api", path: checkout }],
    });
    const created = await client.createTask("-", {
      project: "billing-api",
      title: "Restart test",
      first_message: "ask Which region? | eu|us",
      assignee: "claude@macbook-pro",
    });
    const task = created.task.id;
    const rows = async () =>
      (await client.thread("-", task, { limit: 1000 })).events as unknown as EventRow[];
    let gate = "";
    await waitFor(async () => {
      const row = (await rows()).find((r) => r.type === "gate.opened");
      gate = row ? String(data(row).gate) : "";
      return gate !== "";
    }, 20_000);
    await waitFor(async () => (await rows()).some((r) => r.type === "message.agent"), 10_000);
    const [session] = await client.sessions();
    const host = new TmuxHost({ binary: TEST_TMUX, socket, configFile: "/dev/null" });
    const pid = session!.pid!;

    awd.kill("SIGKILL");
    await new Promise((resolve) => awd!.once("exit", resolve));

    // While awd is down: a person types into the pane, and the answer arrives from pixel-9.
    const pane = (await host.list()).find((p) => p.pid === pid)!;
    expect(pane.dead).toBe(false);
    const ref = { host: "tmux", window: pane.window, pane: pane.pane, pid, pgid: pid };
    await host.paste(ref, "typed while awd is down");
    await host.keys(ref, ["Enter"]);
    const spool = join(home, "sessions", session!.id, "spool");
    await waitFor(async () => (await readdir(spool)).some((n) => n.endsWith("-Stop.json")), 10_000);
    const files = otherDevice(folder, "pixel-9", { role: "mobile" });
    await files.writeEvent(
      `tasks/${task}/log/pixel-9.jsonl`,
      "gate.answered",
      { gate, version: 1, answer: "eu", comment: null },
      { task, by: "human@pixel-9" },
    );

    awd = startAwd();
    await ready();
    await waitFor(
      async () =>
        (await rows()).some((r) => r.type === "message.human" && data(r).delivery_id === gate),
      20_000,
    );
    await waitFor(
      async () =>
        (await rows()).some((r) => r.type === "message.agent" && data(r).text === "Got: eu."),
      10_000,
    );
    const all = await rows();
    const typed = all.find(
      (r) => r.type === "message.human" && data(r).text === "typed while awd is down",
    );
    expect(typed && data(typed).source).toBe("typed");
    expect(
      all.some(
        (r) => r.type === "message.agent" && data(r).text === "Got: typed while awd is down.",
      ),
    ).toBe(true);
    expect(all.some((r) => r.type === "session.resumed")).toBe(false);
    expect((await host.list()).find((p) => p.pid === pid)?.dead).toBe(false);
    const launch = JSON.parse(
      await readFile(join(home, "sessions", session!.id, "launch.json"), "utf8"),
    ) as { mode: string };
    expect(launch.mode).toBe("new");
    expect(stderr).not.toContain('"level":50');

    // SIGTERM stops awd and its managers, never a session.
    awd.kill("SIGTERM");
    await new Promise((resolve) => awd!.once("exit", resolve));
    awd = null;
    expect((await host.list()).find((p) => p.pid === pid)?.dead).toBe(false);
  }, 90_000);
});
