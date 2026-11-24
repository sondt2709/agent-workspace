// End-to-end test of the terminal snapshot (openspec task-terminal-view) with tmux and the fake
// agent: the agent shows a credential value on its screen, then opens a gate. awd writes the
// snapshot at once, with the redaction marker and the time of the gate; the route gives it with the
// local tmux target; `aw terminal` in the session is refused.
import { DesktopClient } from "@aw/client/desktop";
import { hlcMs, type EventRow } from "@aw/core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSnapshot } from "./terminal-snapshot.ts";
import { startSessionDaemon, TEST_TMUX, waitFor, type SessionTestDaemon } from "./testing.ts";

let awd: SessionTestDaemon | null = null;

afterEach(async () => {
  await awd?.close();
  awd = null;
});

const VALUE = "stg_live_9f8e7d6c5b4a_e2e";
const MARKER = "[redacted:staging-api-key]";
const data = (row: EventRow) => (row.event as { data: Record<string, unknown> }).data;

describe.skipIf(!TEST_TMUX)("terminal snapshot", () => {
  it("writes the snapshot at a gate with the marker, and the route gives it", async () => {
    awd = await startSessionDaemon();
    const added = await awd.aw(["credential", "add", "staging-api-key"], {
      stdin: () => Promise.resolve(`${VALUE}\n`),
    });
    expect(added.code).toBe(0);
    const created = await awd.client.createTask("-", {
      project: "billing-api",
      title: "Call the staging API",
      first_message: "steps\nuse-credential staging-api-key 120\nask Which region? | eu|us",
      assignee: "claude@macbook-pro",
      credentials: ["staging-api-key"],
    });
    const task = created.task.id;
    const gate = await awd.waitRow(
      task,
      (r) => r.type === "gate.opened" && data(r).kind === "question",
      30_000,
    );
    // The gate write runs right after the gate event: wait for the snapshot of the gate screen.
    const file = join(awd.folder, "tasks", task, "terminal", "macbook-pro.txt");
    const read = () => readFile(file, "utf8").catch(() => "");
    await waitFor(async () => (await read()).includes('"command":"aw ask'), 10_000);
    const content = await read();
    const snapshot = parseSnapshot(content);
    expect(content).not.toContain(VALUE);
    expect(snapshot.text).toContain(`I used the key ${MARKER} for the staging call.`);
    expect(snapshot.text).toContain('"command":"aw ask');
    expect(snapshot.header).toMatchObject({
      device: "macbook-pro",
      session: awd.session(task),
      host: "tmux",
      socket: awd.socket,
      window: `aw-${task}`,
    });
    const captured = Date.parse(snapshot.header!.captured_at);
    const opened = hlcMs(gate.hlc);
    expect(captured).toBeGreaterThanOrEqual(opened - 50);
    expect(captured - opened).toBeLessThan(5000);

    const reply = await new DesktopClient(awd.client).terminal("-", task);
    expect(reply.snapshot).toMatchObject({ device: "macbook-pro", text: snapshot.text });
    expect(reply.open).toEqual({
      kind: "terminal",
      device: "macbook-pro",
      local: true,
      argv: [TEST_TMUX, "-L", awd.socket, "attach", "-t", `aw:aw-${task}`],
      command: `${TEST_TMUX} -L ${awd.socket} attach -t aw:aw-${task}`,
    });

    // A value that the screen wraps with a real line break (a TUI) is redacted as one value.
    await awd.answerFrom("pixel-9", task, String(data(gate).gate), "eu");
    await awd.sendMessage(
      "pixel-9",
      task,
      awd.session(task),
      "show-credential-wrapped staging-api-key 9",
    );
    await waitFor(async () => (await awd!.screen(task)).includes("(wrapped)"), 15_000);
    // The real screen has the 2 parts of the value on 2 lines.
    expect(await awd.screen(task)).toContain(`  ${VALUE.slice(9)} (wrapped).`);
    await awd.sendMessage("pixel-9", task, awd.session(task), "ask Which size? | s|m");
    await waitFor(async () => (await read()).includes("Which size"), 15_000);
    const wrapped = await read();
    expect(wrapped).toContain(`● The key is ${MARKER} (wrapped).`);
    expect(wrapped).not.toContain(VALUE.slice(0, 9));
    expect(wrapped).not.toContain(VALUE.slice(9));

    // A person command: the CLI refuses it in the session.
    const inSession = await awd.aw(["terminal", task], { env: await awd.agentEnv(task) });
    expect(inSession.code).toBe(1);
  }, 60_000);
});
