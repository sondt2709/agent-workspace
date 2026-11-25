import { describe, expect, it, vi } from "vitest";
import type { Task } from "../shared/channels.ts";
import {
  assignNotifications,
  BODY_BYTES,
  cutBytes,
  gateNotification,
  NotificationCenter,
  taskNotifications,
  type DeliveredNotification,
  type NotificationFactory,
  type NotificationHandlers,
  type NotificationSpec,
} from "./notifications.ts";

type Gate = Task["gates"][number];

function gate(overrides: Partial<Gate> = {}): Gate {
  return {
    gate: "g1",
    kind: "question",
    version: 2,
    title: "Which limit per client?",
    options: ["100/min", "1000/min"],
    file: null,
    state: "open",
    answer: null,
    answer_event: null,
    resolved_by: null,
    answers: [],
    ...overrides,
  };
}

function task(overrides: Partial<Task> & Record<string, unknown> = {}): Task {
  return {
    id: "t1",
    key: "AW-3",
    key_state: "ok",
    project: "billing-api",
    title: "Rate limit",
    first_message: "Add a rate limit",
    priority: null,
    stage: "discuss",
    needs_you: [],
    needs_you_reasons: [],
    needs_you_lane: false,
    assignee: "claude@ubuntu-01",
    owner: "ubuntu-01",
    parent: null,
    subtasks: [],
    depends_on: [],
    archived: false,
    gates: [],
    last_hlc: null,
    ...overrides,
  };
}

describe("gateNotification", () => {
  it("gives a question one action per option, with the task key and the gate label", () => {
    const spec = gateNotification("w", task(), gate())!;
    expect(spec).toMatchObject({
      id: "g1:v2",
      groupId: "t1",
      title: "AW-3 · Reply to a question",
      actions: ["100/min", "1000/min"],
      hasReply: false,
      answer: { gate: "g1", version: 2 },
      target: { ws: "w", task: "t1" },
    });
  });

  it("gives Reply an inline reply and no button", () => {
    const spec = gateNotification("w", task(), gate({ kind: "reply", options: [] }))!;
    expect(spec.hasReply).toBe(true);
    expect(spec.actions).toEqual([]);
  });

  it("shows the question line of a question with details, not the details (gate-context)", () => {
    // awd writes the question as the title and the details as the text: the gate view has no text.
    const spec = gateNotification(
      "w",
      task(),
      gate({
        kind: "question",
        title: "Which queue library?",
        options: ["Library A", "Library B"],
      }),
    )!;
    expect(spec.body).toBe("Which queue library?");
  });

  it("gives Allow once only to a command that fits in the body", () => {
    const options = ["Allow once", "Allow for this task", "Deny"];
    const short = gateNotification(
      "w",
      task(),
      gate({ kind: "approve_command", title: "Bash: pnpm test", options }),
    )!;
    expect(short.actions).toEqual(["Allow once"]);
    const long = gateNotification(
      "w",
      task(),
      gate({ kind: "approve_command", title: `Bash: ${"x".repeat(300)}`, options }),
    )!;
    expect(long.actions).toEqual([]);
    expect(long.answer).toBeNull();
    expect(new TextEncoder().encode(long.body).length).toBeLessThanOrEqual(BODY_BYTES);
  });

  it("gives no action to Approve proposal and Approve result", () => {
    for (const [kind, title] of [
      ["approve_proposal", "AW-3 · Approve proposal"],
      ["approve_result", "AW-3 · Approve result"],
    ] as const) {
      const spec = gateNotification(
        "w",
        task(),
        gate({ kind, options: ["Approve", "Request changes"] }),
      )!;
      expect(spec.title).toBe(title);
      expect(spec.actions).toEqual([]);
      expect(spec.hasReply).toBe(false);
    }
  });

  it("shows nothing for knowledge, device and Fix a file gates, or a resolved gate", () => {
    for (const kind of ["approve_knowledge", "approve_device", "fix_file"]) {
      expect(gateNotification("w", task(), gate({ kind }))).toBeNull();
    }
    expect(gateNotification("w", task(), gate({ state: "resolved" }))).toBeNull();
  });
});

describe("taskNotifications", () => {
  it("adds done and a pause that needs the human, not a pause that continues alone", () => {
    const ids = (t: Task) => taskNotifications("w", t).map((s) => s.id);
    expect(ids(task({ stage: "done" }))).toEqual(["done:t1"]);
    expect(
      ids(task({ paused: { cause: "login_expired", needs_human: true, next_step: "Log in" } })),
    ).toEqual(["paused:t1:login_expired"]);
    expect(
      ids(task({ paused: { cause: "device_offline", needs_human: false, next_step: "Waits" } })),
    ).toEqual([]);
    expect(ids(task({ archived: true, stage: "done" }))).toEqual([]);
  });

  it("names each pause cause of the continuity rules in the title (add-continuity)", () => {
    const title = (cause: string) =>
      taskNotifications("w", task({ paused: { cause, needs_human: true, next_step: "x" } }))[0]
        ?.title;
    expect(title("usage_limit")).toMatch(/Paused: usage limit$/);
    expect(title("usage_limit_weekly")).toMatch(/Paused: weekly usage limit$/);
    expect(title("continue_cap")).toMatch(/Paused: continue limit$/);
    expect(title("agent_error")).toMatch(/Paused: agent error$/);
    expect(title("device_restart")).toMatch(/Paused: device restart$/);
    expect(title("login_expired")).toMatch(/Paused: login expired$/);
  });

  it("names the revoked device of a presence pause (openspec revoke-device)", () => {
    const [spec] = taskNotifications(
      "w",
      task({
        paused: {
          cause: "device_revoked",
          since: "2026-11-23T10:00:00.000Z",
          resumes_at: null,
          needs_human: true,
          next_step: "Change the assignee to continue on another device.",
          device: "ubuntu-01",
          device_name: "ubuntu-01",
        },
      }),
    );
    expect(spec).toMatchObject({
      id: "paused:t1:device_revoked",
      title: "AW-3 · Paused: ubuntu-01 was revoked",
      body: "Change the assignee to continue on another device.",
      actions: [],
    });
  });
});

describe("cutBytes", () => {
  it("cuts on a character border", () => {
    const text = "é".repeat(200);
    const cut = cutBytes(text, 11);
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(11);
    expect(cut.endsWith("…")).toBe(true);
    expect(cutBytes("short", 11)).toBe("short");
  });
});

function fakeFactory(delivered: DeliveredNotification[] = [], supported = true) {
  const shown: { spec: NotificationSpec; handlers: NotificationHandlers; close: () => void }[] = [];
  const factory: NotificationFactory = {
    supported: () => supported,
    show: (spec, handlers) => {
      const close = vi.fn();
      shown.push({ spec, handlers, close });
      return { close };
    },
    history: () => Promise.resolve(delivered),
  };
  return { factory, shown };
}

describe("NotificationCenter", () => {
  it("shows nothing at the first update, then each new gate once", () => {
    const { factory, shown } = fakeFactory();
    const center = new NotificationCenter({ factory, answer: vi.fn(), open: vi.fn() });
    center.update([{ ws: "w", tasks: [task({ gates: [gate()] })] }]);
    expect(shown).toHaveLength(0);
    const two = [gate(), gate({ gate: "g2", kind: "reply", options: [] })];
    center.update([{ ws: "w", tasks: [task({ gates: two })] }]);
    center.update([{ ws: "w", tasks: [task({ gates: two })] }]);
    expect(shown.map((s) => s.spec.id)).toEqual(["g2:v2"]);
  });

  it("shows a gate again when it opens with a higher version (fix list 0-12)", () => {
    const { factory, shown } = fakeFactory();
    const answer = vi.fn(() => Promise.resolve());
    const center = new NotificationCenter({ factory, answer, open: vi.fn() });
    center.update([{ ws: "w", tasks: [task()] }]);
    center.update([{ ws: "w", tasks: [task({ gates: [gate()] })] }]);
    const v3 = gate({ version: 3, title: "Which window?", options: ["1 min", "1 h"] });
    center.update([{ ws: "w", tasks: [task({ gates: [v3] })] }]);
    expect(shown.map((s) => [s.spec.id, s.spec.body, s.spec.actions])).toEqual([
      ["g1:v2", "Which limit per client?", ["100/min", "1000/min"]],
      ["g1:v3", "Which window?", ["1 min", "1 h"]],
    ]);
    expect(shown[0]!.close).toHaveBeenCalledTimes(1);
    shown[1]!.handlers.action(1);
    expect(answer).toHaveBeenCalledWith("w", "g1", { answer: "1 h", version: 3 });
  });

  it("closes the notification of a gate that another device answered", () => {
    const { factory, shown } = fakeFactory();
    const center = new NotificationCenter({ factory, answer: vi.fn(), open: vi.fn() });
    center.update([{ ws: "w", tasks: [task()] }]);
    center.update([{ ws: "w", tasks: [task({ gates: [gate()] })] }]);
    center.update([{ ws: "w", tasks: [task({ gates: [gate({ state: "resolved" })] })] }]);
    expect(shown[0]!.close).toHaveBeenCalledTimes(1);
  });

  it("answers an action with the option and the version, and opens the task on a click", () => {
    const { factory, shown } = fakeFactory();
    const answer = vi.fn(() => Promise.resolve());
    const open = vi.fn();
    const center = new NotificationCenter({ factory, answer, open });
    center.update([{ ws: "w", tasks: [task()] }]);
    center.update([{ ws: "w", tasks: [task({ gates: [gate()] })] }]);
    shown[0]!.handlers.action(1);
    expect(answer).toHaveBeenCalledWith("w", "g1", { answer: "1000/min", version: 2 });
    expect(open).not.toHaveBeenCalled();
    shown[0]!.handlers.reply("not a reply gate");
    expect(answer).toHaveBeenCalledTimes(1);
    shown[0]!.handlers.click();
    expect(open).toHaveBeenCalledWith({ ws: "w", task: "t1" });
  });

  it("attaches the handlers to delivered notifications and closes the answered ones", async () => {
    const attach = vi.fn();
    const keep = { id: "g1:v2", attach, close: vi.fn() };
    const gone = { id: "g-old", attach: vi.fn(), close: vi.fn() };
    const { factory, shown } = fakeFactory([keep, gone]);
    const answer = vi.fn(() => Promise.resolve());
    const center = new NotificationCenter({ factory, answer, open: vi.fn() });
    await center.start();
    center.update([{ ws: "w", tasks: [task({ gates: [gate()] })] }]);
    expect(shown).toHaveLength(0);
    expect(gone.close).toHaveBeenCalledTimes(1);
    const handlers = attach.mock.calls[0]![0] as NotificationHandlers;
    handlers.action(0);
    expect(answer).toHaveBeenCalledWith("w", "g1", { answer: "100/min", version: 2 });
    center.update([{ ws: "w", tasks: [task()] }]);
    expect(keep.close).toHaveBeenCalledTimes(1);
  });

  it("shows nothing for the first listing of a workspace that was not ready at the start (fix list 0-12)", () => {
    const { factory, shown } = fakeFactory();
    const center = new NotificationCenter({ factory, answer: vi.fn(), open: vi.fn() });
    const gatesA = [gate(), gate({ gate: "g2" }), gate({ gate: "g3" })];
    // The first load has only workspace B: A is not ready.
    center.update([{ ws: "b", tasks: [task({ id: "tb" })] }], { complete: false });
    center.update([
      { ws: "a", tasks: [task({ gates: gatesA }), task({ id: "t2", stage: "done" })] },
      { ws: "b", tasks: [task({ id: "tb" })] },
    ]);
    expect(shown).toHaveLength(0);
    // A new gate of A after its first listing shows.
    center.update([
      { ws: "a", tasks: [task({ gates: [...gatesA, gate({ gate: "g4" })] })] },
      { ws: "b", tasks: [task({ id: "tb" })] },
    ]);
    expect(shown.map((s) => s.spec.id)).toEqual(["g4:v2"]);
  });

  it("closes the notifications of a workspace that is no longer listed", () => {
    const { factory, shown } = fakeFactory();
    const center = new NotificationCenter({ factory, answer: vi.fn(), open: vi.fn() });
    center.update([{ ws: "a", tasks: [task()] }]);
    center.update([{ ws: "a", tasks: [task({ gates: [gate()] })] }]);
    center.update([]);
    expect(shown[0]!.close).toHaveBeenCalledTimes(1);
  });

  it("keeps a delivered notification open while a workspace was not loaded", async () => {
    const other = { id: "g9:v1", attach: vi.fn(), close: vi.fn() };
    const { factory } = fakeFactory([other]);
    const center = new NotificationCenter({ factory, answer: vi.fn(), open: vi.fn() });
    await center.start();
    center.update([{ ws: "b", tasks: [] }], { complete: false });
    expect(other.close).not.toHaveBeenCalled();
    center.update([
      { ws: "a", tasks: [task({ gates: [gate({ gate: "g9", version: 1 })] })] },
      { ws: "b", tasks: [] },
    ]);
    expect(other.attach).toHaveBeenCalledTimes(1);
    expect(other.close).not.toHaveBeenCalled();
  });

  it("does nothing when notifications are not supported", async () => {
    const { factory, shown } = fakeFactory([], false);
    const history = vi.spyOn(factory, "history");
    const center = new NotificationCenter({ factory, answer: vi.fn(), open: vi.fn() });
    await center.start();
    center.update([{ ws: "w", tasks: [] }]);
    center.update([{ ws: "w", tasks: [task({ gates: [gate()] })] }]);
    expect(shown).toHaveLength(0);
    expect(history).not.toHaveBeenCalled();
  });
});

describe("Assign task notifications (queue-and-assign)", () => {
  const agentTask = {
    task: "t5",
    key: "AW-5",
    title: "Write the tests",
    created_by: "claude@ubuntu-01",
    by_agent: true,
  };
  const personTask = {
    task: "t6",
    key: "AW-6",
    title: "Parked idea",
    created_by: "human@macbook-pro",
    by_agent: false,
  };

  it("gives one notification for a task that an agent created, none for a person task", () => {
    expect(assignNotifications("w", [agentTask, personTask])).toEqual([
      {
        id: "assign:t5",
        groupId: "t5",
        title: "AW-5 · Assign task",
        body: "Write the tests",
        actions: [],
        hasReply: false,
        target: { ws: "w", task: "t5" },
        answer: null,
      },
    ]);
  });

  it("shows it once, opens the task on a click and closes it after the assignment", () => {
    const { factory, shown } = fakeFactory();
    const open = vi.fn();
    const center = new NotificationCenter({ factory, answer: vi.fn(), open });
    center.update([{ ws: "w", tasks: [], unassigned: [] }]);
    center.update([{ ws: "w", tasks: [], unassigned: [agentTask, personTask] }]);
    center.update([{ ws: "w", tasks: [], unassigned: [agentTask, personTask] }]);
    expect(shown.map((s) => s.spec.title)).toEqual(["AW-5 · Assign task"]);
    shown[0]!.handlers.click();
    expect(open).toHaveBeenCalledWith({ ws: "w", task: "t5" });
    center.update([{ ws: "w", tasks: [], unassigned: [personTask] }]);
    expect(shown[0]!.close).toHaveBeenCalledTimes(1);
  });
});
