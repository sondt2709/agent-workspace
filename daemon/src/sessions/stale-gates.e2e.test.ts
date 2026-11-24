// End-to-end tests of the gates with no session (openspec stale-gates, fix list ux-5): awd, a real
// tmux on a private socket and the fake claude. The owner device closes each open gate that no
// session can use, and a late answer becomes a comment.
import { afterEach, describe, expect, it } from "vitest";
import { startSessionDaemon, TEST_TMUX, waitFor, type SessionTestDaemon } from "./testing.ts";

let awd: SessionTestDaemon | null = null;

afterEach(async () => {
  await awd?.close();
  awd = null;
});

const text = (row: { event: unknown }) =>
  String((row.event as { data: { text?: string } }).data.text ?? "");
const data = (row: { event: unknown }) => (row.event as { data: Record<string, unknown> }).data;

describe.skipIf(!TEST_TMUX)("gates with no session", () => {
  it("closes the open gates of a stopped session, and a late phone answer is a comment", async () => {
    awd = await startSessionDaemon({ permissionTimeoutMs: 60_000 });
    const d = awd;
    const task = await d.createTask("ask Which region? | eu|us");
    const question = await d.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "question",
    );
    await d.waitRow(task.id, (r) => r.type === "message.agent" && text(r).includes("I asked"));
    const session = d.session(task.id);
    // A second turn asks for a permission, and the hook waits for the answer.
    await d.sendMessage("pixel-9", task.id, session, "write stuck.txt x");
    const command = await d.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
    );
    const gates = [String(data(question).gate), String(data(command).gate)];
    // The person stops the session while both gates are open.
    await d.aw(["session", "stop", session]);
    await d.waitRow(task.id, (r) => r.type === "session.ended" && data(r).session === session);
    for (const gate of gates) {
      const resolved = await d.waitRow(
        task.id,
        (r) => r.type === "gate.resolved" && data(r).gate === gate,
        20_000,
      );
      expect(data(resolved)).toMatchObject({ answer: "Session ended", answer_event: null });
    }
    const view = await d.task(task.id);
    expect(view.needs_you).toEqual([]);
    expect(view.needs_you_lane).toBe(false);
    // The phone did not see the close yet: its answer becomes a late-answer comment.
    await d.answerFrom("pixel-9", task.id, gates[1]!, "Allow once");
    await waitFor(async () =>
      (await d.task(task.id)).comments.some(
        (c) => c.source === "late_answer" && c.gate === gates[1],
      ),
    );
    const after = await d.task(task.id);
    const gate = after.gates.find((g) => g.gate === gates[1])!;
    expect(gate.answers.map((a) => a.use)).toEqual(["comment"]);
    expect(await d.client.gates("-", { task: task.id })).toEqual([]);
  }, 90_000);

  it("closes a timed-out permission gate when the session starts a new turn", async () => {
    awd = await startSessionDaemon({ permissionTimeoutMs: 1500 });
    const d = awd;
    const task = await d.createTask("write late.txt y");
    const opened = await d.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
    );
    const gate = String(data(opened).gate);
    await d.waitRow(
      task.id,
      (r) => r.type === "message.agent" && text(r).includes("No answer from the human in 2 s"),
    );
    // The gate stays open while the agent waits on it.
    expect((await d.task(task.id)).gates.find((g) => g.gate === gate)?.state).toBe("open");
    // The person writes to the agent instead: the agent goes on, the gate has no use any more.
    await d.sendMessage("pixel-9", task.id, d.session(task.id), "reply I go on.");
    const resolved = await d.waitRow(
      task.id,
      (r) => r.type === "gate.resolved" && data(r).gate === gate,
      20_000,
    );
    expect(data(resolved)).toMatchObject({ answer: "Denied after 2 s", answer_event: null });
    await d.waitRow(task.id, (r) => r.type === "message.agent" && text(r) === "I go on.");
    // No "[AW answer]" goes to the session for the close.
    expect(
      (await d.rows(task.id)).some(
        (r) => r.type === "message.human" && data(r).delivery_id === gate,
      ),
    ).toBe(false);
  }, 60_000);
});
