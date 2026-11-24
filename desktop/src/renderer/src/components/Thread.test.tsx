// The thread line of a rekeyed task (docs/architecture.md 4.3.3 item 3, openspec offline-task-keys).
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import agentMessageJson from "../../../../../contracts/fixtures/activity/agent-message.json?raw";
import type { EventRow } from "../../../shared/channels.ts";
import { fixedClock, installBridge, makeTask, renderApp } from "../testing.tsx";
import { Thread } from "./Thread.tsx";

afterEach(cleanup);

const HLC = "2026-11-23T10:00:00.000Z#0000";

function rekeyRow(task: string): EventRow {
  return {
    id: "row-rekey",
    task,
    hlc: HLC,
    dev: "ubuntu-01",
    type: "task.rekeyed",
    path: `tasks/${task}/log/ubuntu-01.jsonl`,
    line: 2,
    applied: true,
    reason: null,
    event: {
      v: 1,
      id: "row-rekey",
      hlc: HLC,
      dev: "ubuntu-01",
      type: "task.rekeyed",
      by: "aw@ubuntu-01",
      data: { from: "AW-1", to: "AW-2" },
    },
  };
}

describe("Thread", () => {
  it("shows the old and the new key of a rekey", async () => {
    const task = makeTask({ key: "AW-2" });
    installBridge({
      thread: () => ({
        task: { id: task.id, key: task.key, title: task.title },
        events: [rekeyRow(task.id)],
        next: null,
        ancestors: [],
      }),
    });
    renderApp(<Thread ws="ws-1" task={task} />, {
      clock: fixedClock(Date.parse("2026-11-23T10:01:00.000Z")),
    });
    expect((await screen.findByText(/^AW-1 is now AW-2 · /)).textContent).toBe(
      "AW-1 is now AW-2 · 1 min ago",
    );
  });

  it("shows a stopped session with its cause in Activity, and the raw line in Session (decision 37)", async () => {
    const task = makeTask({ key: "AW-1" });
    const ended = (reason: string, n: number): EventRow => ({
      ...rekeyRow(task.id),
      id: `row-ended-${n}`,
      type: "session.ended",
      event: {
        v: 1,
        id: `row-ended-${n}`,
        hlc: HLC,
        dev: "ubuntu-01",
        type: "session.ended",
        by: "aw@ubuntu-01",
        data: { session: "01a2038e-8100-7000-8000-000000000001", reason },
      },
    });
    installBridge({
      thread: () => ({
        task: { id: task.id, key: task.key, title: task.title },
        events: [ended("moved", 1), ended("stopped", 2)],
        next: null,
        ancestors: [],
      }),
    });
    const clock = fixedClock(Date.parse("2026-11-23T10:01:00.000Z"));
    renderApp(<Thread ws="ws-1" task={task} mode="activity" />, { clock });
    expect((await screen.findByText(/^Session stopped on /)).textContent).toBe(
      "Session stopped on ubuntu-01: a person stopped it or ended the agent. AW starts no new session until a person starts one. · 1 min ago",
    );
    expect(screen.queryByText(/moved/)).toBeNull();
    cleanup();
    renderApp(<Thread ws="ws-1" task={task} mode="session" />, { clock });
    expect(await screen.findByText(/^Session ended \(stopped\) · /)).toBeTruthy();
    expect(screen.getByText(/^Session ended \(moved\) · /)).toBeTruthy();
  });

  it("shows an agent message as Markdown in Activity and as raw text in Session (polish-prototype-style)", async () => {
    const task = makeTask({ key: "AW-1" });
    const text = "Plan:\n\n- Use **cents**\n\n<script>window.awPwned = 1</script>";
    const agent: EventRow = {
      ...rekeyRow(task.id),
      id: "row-agent",
      type: "message.agent",
      event: {
        v: 1,
        id: "row-agent",
        hlc: HLC,
        dev: "ubuntu-01",
        type: "message.agent",
        by: "claude@ubuntu-01",
        data: { text },
      },
    };
    installBridge({
      thread: () => ({
        task: { id: task.id, key: task.key, title: task.title },
        events: [agent],
        next: null,
        ancestors: [],
      }),
    });
    const clock = fixedClock(Date.parse("2026-11-23T10:01:00.000Z"));
    const { container } = renderApp(<Thread ws="ws-1" task={task} mode="activity" />, { clock });
    expect((await screen.findByRole("listitem")).textContent).toBe("Use cents");
    expect(container.querySelector("li strong")?.textContent).toBe("cents");
    // Raw HTML stays off: no script element, and the tag shows as no element.
    expect(container.querySelector("script")).toBeNull();
    expect((window as { awPwned?: number }).awPwned).toBeUndefined();
    cleanup();
    renderApp(<Thread ws="ws-1" task={task} mode="session" />, { clock });
    expect(await screen.findByText(/Use \*\*cents\*\*/)).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});

describe("Thread: person messages and agent messages (task-review-layout)", () => {
  const FIXTURE = JSON.parse(agentMessageJson) as {
    cases: { name: string; text: string; expected: { kind: string; body: string } | null }[];
  };
  function humanRow(task: string, text: string): EventRow {
    return {
      ...rekeyRow(task),
      id: "row-human",
      type: "message.human",
      event: {
        v: 1,
        id: "row-human",
        hlc: HLC,
        dev: "macbook-pro",
        type: "message.human",
        by: "human@macbook-pro",
        data: { text, source: "typed", session: "s1", delivery_id: null },
      },
    };
  }
  function show(text: string, mode: "activity" | "session") {
    const task = makeTask({ key: "AW-1" });
    installBridge({
      thread: () => ({
        task: { id: task.id, key: task.key, title: task.title },
        events: [humanRow(task.id, text)],
        next: null,
        ancestors: [],
      }),
    });
    const clock = fixedClock(Date.parse("2026-11-23T10:01:00.000Z"));
    return renderApp(<Thread ws="ws-1" task={task} mode={mode} />, { clock });
  }

  it("shows a typed person message as Markdown in Activity", async () => {
    const { container } = show("Use **cents**.\n\n- one\n- two", "activity");
    expect(await screen.findByText(/typed in the terminal/)).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toBe("cents");
    expect(screen.getAllByRole("listitem").length).toBe(2);
  });

  it("shows a subagent report with its label and the report as Markdown", async () => {
    const report = FIXTURE.cases.find((c) => c.expected?.kind === "subagent_report")!;
    const { container } = show(report.text, "activity");
    expect(await screen.findByText("Subagent report")).toBeTruthy();
    expect(screen.getByText(/arrived in the terminal/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Gateway: what runs today" })).toBeTruthy();
    expect(container.textContent).not.toContain("<agent-message");
    expect(container.textContent).not.toContain("[Subagent hand-back]");
  });

  it("keeps the raw text of a subagent report in the Session tab", async () => {
    const report = FIXTURE.cases.find((c) => c.expected?.kind === "subagent_report")!;
    show(report.text, "session");
    expect(await screen.findByText(/<agent-message from=/)).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});

function learnedRow(task: string, data: Record<string, unknown>): EventRow {
  return {
    ...rekeyRow(task),
    id: "row-learned",
    type: "task.learned",
    event: {
      v: 1,
      id: "row-learned",
      hlc: HLC,
      dev: "macbook-pro",
      type: "task.learned",
      by: "claude@macbook-pro",
      data,
    },
  };
}

describe("Thread: the learning step (agent-learning)", () => {
  const CHANGE = "01a20790-0000-7000-8000-000000000001";
  const PATH = "projects/billing-api/learned/2026-11-23-use-cents.md";

  function show(data: Record<string, unknown>) {
    const task = makeTask({ key: "AW-1" });
    const bridge = installBridge({
      thread: () => ({
        task: { id: task.id, key: task.key, title: task.title },
        events: [learnedRow(task.id, data)],
        next: null,
        ancestors: [],
      }),
      kbUndo: () => ({ change: { id: "c2" }, suggestion: null, unchanged: false }),
    });
    renderApp(<Thread ws="ws-1" task={task} />, {
      clock: fixedClock(Date.parse("2026-11-23T10:01:00.000Z")),
    });
    return bridge;
  }

  it('shows "Nothing new learned" with no Undo', async () => {
    show({ nothing_new: true });
    expect((await screen.findByText(/^Nothing new learned by /)).textContent).toBe(
      "Nothing new learned by claude@macbook-pro · 1 min ago",
    );
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("shows the learned file with Undo of its change", async () => {
    const bridge = show({ nothing_new: false, path: PATH, change: CHANGE, suggestion: null });
    expect((await screen.findByText(/^Learned by /)).textContent).toBe(
      `Learned by claude@macbook-pro: ${PATH} · 1 min ago`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(bridge).toHaveBeenCalledWith("kbUndo", { ws: "ws-1", change: CHANGE }),
    );
    expect(await screen.findByText("Undone.")).toBeTruthy();
  });

  it("says that a shared item waits for approval", async () => {
    show({ nothing_new: false, path: "shared/learned/x.md", change: null, suggestion: CHANGE });
    expect((await screen.findByText(/^Learned by /)).textContent).toBe(
      "Learned by claude@macbook-pro: shared/learned/x.md (waits for approval) · 1 min ago",
    );
  });
});
