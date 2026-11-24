// The agent sends its updates through AW (openspec agent-pushes-updates): the text of a turn has
// the source `turn`, a turn with no AW update gets one nudge notice, hook events of another Claude
// session give one comment, and `session.started` names the Claude session and the terminal.
import type { EventRow } from "@aw/core";
import { afterEach, describe, expect, it } from "vitest";
import { NUDGE_TEXT } from "./manager.ts";
import { sessionPaths } from "./records.ts";
import { writeSpool } from "./spool.ts";
import { startSessionDaemon, TEST_TMUX, type SessionTestDaemon } from "./testing.ts";

let awd: SessionTestDaemon | null = null;

afterEach(async () => {
  await awd?.close();
  awd = null;
});

const data = (row: EventRow) => (row.event as { data: Record<string, unknown> }).data;
const text = (row: EventRow) =>
  typeof data(row).text === "string" ? (data(row).text as string) : "";
const isNudge = (r: EventRow) => r.type === "message.sent" && data(r).kind === "nudge";
const OTHER = "0193a7d1-9999-7000-8000-000000000002";

describe.skipIf(!TEST_TMUX)("agent updates through AW", () => {
  it("nudges once after a turn with only text, and not after a turn with a message", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("reply ready");
    const turn = await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r) === "ready",
    );
    expect(data(turn).source).toBe("turn");
    const session = awd.session(task.id);
    const nudge = await awd.waitRow(task.id, isNudge);
    expect(data(nudge)).toMatchObject({ text: NUDGE_TEXT, to_session: session });
    expect(nudge.event).toMatchObject({ by: "aw@macbook-pro" });
    // The agent gets the notice and ends that turn with text only: no second notice.
    const notice = await awd.waitRow(
      task.id,
      (r) => r.type === "message.human" && data(r).delivery_id === data(nudge).id,
    );
    expect(data(notice).source).toBe("notice");
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).startsWith("Got: Your turn ended"),
    );
    await awd.waitChecks(session, 3);
    expect((await awd.rows(task.id)).filter(isNudge)).toHaveLength(1);

    // A turn with `message`: the update is in the thread, so no notice.
    await awd.sendMessage("pixel-9", task.id, session, 'mcp message {"text":"Tests pass."}');
    const sent = await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r) === "Tests pass.",
    );
    expect(data(sent).source).toBe("tool");
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r).startsWith("MCP "));
    await awd.waitChecks(session, 3);
    expect((await awd.rows(task.id)).filter(isNudge)).toHaveLength(1);

    // The same with `aw message` and a long turn text: the text is Session only.
    await awd.sendMessage(
      "pixel-9",
      task.id,
      session,
      "message-then-reply Done: 2 files changed. | ## Summary\\n\\nI changed 2 files.",
    );
    const cli = await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r) === "Done: 2 files changed.",
    );
    expect(data(cli).source).toBe("tool");
    const long = await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r) === "## Summary\n\nI changed 2 files.",
    );
    expect(data(long).source).toBe("turn");
    await awd.waitChecks(session, 3);
    expect((await awd.rows(task.id)).filter(isNudge)).toHaveLength(1);

    // Text that a person typed in the terminal: that person reads the terminal, so no notice.
    const spool = sessionPaths(awd.home, session).spool;
    const at = Date.now();
    const hook = (event: string, payload: Record<string, unknown>, ms: number) =>
      writeSpool(
        spool,
        {
          event,
          at: ms,
          payload: { hook_event_name: event, session_id: session, ...payload },
          gate: null,
        },
        ms * 1000,
      );
    await hook("UserPromptSubmit", { prompt: "explain the diff" }, at);
    await hook("Stop", { last_assistant_message: "The diff adds a limit." }, at + 1);
    await awd.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r) === "The diff adds a limit.",
    );
    await awd.waitChecks(session, 3);
    expect((await awd.rows(task.id)).filter(isNudge)).toHaveLength(1);
  }, 90_000);

  it("writes no nudge while a gate waits for the person", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("ask Which limit? | 100/min|1000/min");
    await awd.waitRow(task.id, (r) => r.type === "gate.opened" && data(r).kind === "question");
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && data(r).source === "turn");
    const session = awd.session(task.id);
    await awd.waitChecks(session, 3);
    expect((await awd.rows(task.id)).filter(isNudge)).toHaveLength(0);
    // A later turn with text only while the question waits for the person: no notice either.
    await awd.sendMessage("pixel-9", task.id, session, "reply noted");
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "noted");
    await awd.waitChecks(session, 3);
    expect((await awd.rows(task.id)).filter(isNudge)).toHaveLength(0);
  }, 60_000);

  it("warns once for hook events of another Claude session and keeps them", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("ask Which limit? | 100/min|1000/min");
    await awd.waitRow(task.id, (r) => r.type === "gate.opened");
    const session = awd.session(task.id);
    const started = await awd.waitRow(task.id, (r) => r.type === "session.started");
    // The link of the task to the Claude session and the terminal.
    const info = awd.server.daemon.sessions!.list().find((s) => s.id === session)!;
    expect(data(started)).toMatchObject({ name: task.key, terminal: { window: info.window } });
    expect(String((data(started).terminal as { pane: unknown }).pane)).toMatch(/^%\d+$/);
    const spool = sessionPaths(awd.home, session).spool;
    const at = Date.now();
    for (const [i, message] of ["first", "second"].entries()) {
      await writeSpool(
        spool,
        {
          event: "Stop",
          at: at + i,
          payload: { hook_event_name: "Stop", session_id: OTHER, last_assistant_message: message },
          gate: null,
        },
        (at + i) * 1000,
      );
    }
    // A subagent event of this session: no comment.
    await writeSpool(
      spool,
      {
        event: "PostToolUse",
        at: at + 2,
        payload: {
          hook_event_name: "PostToolUse",
          session_id: session,
          agent_id: "a1b2c3",
          tool_name: "Read",
          tool_use_id: "toolu_sub",
        },
        gate: null,
      },
      (at + 2) * 1000,
    );
    await awd.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "second");
    await awd.waitChecks(session, 2);
    const comments = (await awd.rows(task.id)).filter(
      (r) => r.type === "comment.added" && text(r).startsWith("Hook events of another"),
    );
    expect(comments.map(text)).toEqual([
      "Hook events of another Claude session (0193a7d1) arrive in this session. AW keeps them. Check the terminal of this task.",
    ]);
    expect(
      (await awd.rows(task.id)).some((r) => r.type === "message.agent" && text(r) === "first"),
    ).toBe(true);
  }, 60_000);
});
