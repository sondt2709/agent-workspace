// The merge rules one by one (docs/architecture.md 4.3, docs/workflow.md 3, task-model §5).
import { newId } from "@aw/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../clock.ts";
import { MergeEngine, mergeWorkspace } from "./engine.ts";
import { nextFreeKey } from "./keys.ts";
import { sortByPriority } from "./priority.ts";
import { at, createdData, event, FIXTURE_TASK, TestWorkspace } from "./testing.ts";
import type { TaskView } from "./view.ts";

let ws: TestWorkspace;
let clock: FakeClock;
beforeEach(async () => {
  ws = await TestWorkspace.create();
  clock = new FakeClock("2026-11-22T16:00:00.000Z");
});
afterEach(async () => {
  await ws.remove();
});

const newTask = () => newId({ now: () => Date.parse("2026-11-22T15:00:00.000Z") });
const session = () => newId({ now: () => Date.parse("2026-11-22T15:00:00.000Z") });
const human = (dev: string) => ({ by: `human@${dev}` });

async function merge() {
  return mergeWorkspace(ws.root, { clock });
}

async function taskOf(id: string): Promise<TaskView> {
  const { view } = await merge();
  return view.tasks.find((t) => t.id === id)!;
}

describe("order", () => {
  it("sorts by HLC, then device, then id, and drops a duplicate id", async () => {
    const task = newTask();
    const created = event(
      "macbook-pro",
      "task.created",
      at("15:00:00"),
      createdData("AW-20"),
      human("macbook-pro"),
    );
    const a = event(
      "pixel-9",
      "task.edited",
      at("15:01:00"),
      { field: "title", value: "From pixel-9" },
      human("pixel-9"),
    );
    const b = event(
      "macbook-pro",
      "task.edited",
      at("15:01:00"),
      { field: "title", value: "From macbook-pro" },
      human("macbook-pro"),
    );
    await ws.task(task, created, a, b);
    // Same HLC: "pixel-9" sorts after "macbook-pro", so its edit is the newest.
    expect((await taskOf(task)).title).toBe("From pixel-9");
    // A conflict copy can bring the same event twice.
    await ws.append(`tasks/${task}/log/pixel-9.jsonl`, { ...a, task });
    const { view } = await merge();
    expect(view.issues.map((i) => [i.code, i.line])).toEqual([["duplicate_event", 2]]);
    expect(view.tasks.find((t) => t.id === task)!.event_count).toBe(3);
  });

  it("keeps the winner of a duplicate id and its HLC, whatever the read order", async () => {
    // The workspace line is the loser (larger path) and has the higher HLC.
    const loser = event(
      "ubuntu-01",
      "queue.reordered",
      at("15:50:00"),
      { agent: "claude@ubuntu-01", tasks: [FIXTURE_TASK] },
      human("ubuntu-01"),
    );
    const winner = {
      ...event(
        "ubuntu-01",
        "comment.added",
        at("15:00:00"),
        { text: "same id" },
        human("ubuntu-01"),
      ),
      id: loser.id,
    };
    // The loser arrives first: the engine merges it, then the winner replaces it.
    const before = (await merge()).view.queues;
    const engine = new MergeEngine({ root: ws.root, clock });
    await ws.append("tasks/log/ubuntu-01.jsonl", loser);
    let update = await engine.update();
    expect(update.view.queues).toMatchObject([{ dev: "ubuntu-01", event: loser.id }]);
    expect(engine.lastHlc()).toBe(at("15:50:00"));
    await ws.task(FIXTURE_TASK, winner);
    update = await engine.update();
    expect(update.workspaceChanged).toBe(true);
    expect(update.view.queues).toEqual(before);
    expect(engine.lastHlc()).toBe(at("15:00:00"));
    expect(update.view.issues.map((i) => [i.code, i.path])).toEqual([
      ["duplicate_event", "tasks/log/ubuntu-01.jsonl"],
    ]);
    for (const readOrder of [(p: string[]) => p, (p: string[]) => [...p].reverse()]) {
      const full = await mergeWorkspace(ws.root, { clock, readOrder });
      expect(full.view).toEqual(update.view);
    }
  });
});

describe("priority", () => {
  it("puts local first, then remote in list order, then mobile, then unknown devices", () => {
    const roles = new Map([
      ["pixel-9", "mobile"],
      ["mac-mini-lab", "remote"],
      ["ubuntu-01", "remote"],
      ["macbook-pro", "local"],
    ] as const);
    expect(
      sortByPriority(["pixel-9", "zz-unknown", "ubuntu-01", "mac-mini-lab", "macbook-pro"], {
        roles,
        order: ["macbook-pro", "ubuntu-01", "mac-mini-lab", "pixel-9"],
      }),
    ).toEqual(["macbook-pro", "ubuntu-01", "mac-mini-lab", "pixel-9", "zz-unknown"]);
  });
});

describe("claims and ownership", () => {
  it("counts a state event only from the owner at that point", async () => {
    const task = newTask();
    await ws.task(
      task,
      event(
        "macbook-pro",
        "task.created",
        at("15:00:00"),
        createdData("AW-20", { assignee: "claude@ubuntu-01" }),
        human("macbook-pro"),
      ),
      // Before a claim, the creating device owns the task.
      event("ubuntu-01", "task.stage_changed", at("15:00:30"), { from: "backlog", to: "discuss" }),
      event("ubuntu-01", "task.claimed", at("15:01:00"), {
        epoch: 1,
        device: "ubuntu-01",
        session: session(),
        based_on: null,
      }),
      event("ubuntu-01", "task.stage_changed", at("15:01:00", 1), {
        from: "backlog",
        to: "discuss",
      }),
      event("macbook-pro", "task.stage_changed", at("15:02:00"), { from: "discuss", to: "done" }),
    );
    const { view, engine } = await (async () => {
      const engine = new MergeEngine({ root: ws.root, clock });
      return { ...(await engine.update()), engine };
    })();
    const view1 = view.tasks.find((t) => t.id === task)!;
    expect(view1.stage).toBe("discuss");
    expect(view1.owner).toBe("ubuntu-01");
    expect(engine.taskOwner(task)).toBe("ubuntu-01");
    expect(view.issues.filter((i) => i.task === task).map((i) => i.reason)).toEqual([
      "not_owner",
      "not_owner",
    ]);
  });

  it("accepts a claim with a higher epoch only", async () => {
    const task = newTask();
    const first = session();
    await ws.task(
      task,
      event(
        "macbook-pro",
        "task.created",
        at("15:00:00"),
        createdData("AW-20", { assignee: "claude@ubuntu-01" }),
        human("macbook-pro"),
      ),
      event("ubuntu-01", "task.claimed", at("15:01:00"), {
        epoch: 2,
        device: "ubuntu-01",
        session: first,
        based_on: null,
      }),
      event("ubuntu-01", "task.claimed", at("15:02:00"), {
        epoch: 2,
        device: "ubuntu-01",
        session: session(),
        based_on: null,
      }),
      event("ubuntu-01", "task.claimed", at("15:03:00"), {
        epoch: 1,
        device: "ubuntu-01",
        session: session(),
        based_on: null,
      }),
    );
    const { view } = await merge();
    expect(view.tasks.find((t) => t.id === task)!.claim).toMatchObject({
      epoch: 2,
      device: "ubuntu-01",
      session: first,
    });
    expect(view.issues.filter((i) => i.task === task).map((i) => i.reason)).toEqual([
      "stale_claim",
      "stale_claim",
    ]);
  });

  it("keeps a released epoch and the move target until the next claim", async () => {
    // A move is a human task.assigned (docs/decisions/2026-11-23-manual-move.md item 3).
    const task = newTask();
    await ws.task(
      task,
      event(
        "macbook-pro",
        "task.created",
        at("15:00:00"),
        createdData("AW-20", { assignee: "claude@ubuntu-01" }),
        human("macbook-pro"),
      ),
      event("ubuntu-01", "task.claimed", at("15:01:00"), {
        epoch: 1,
        device: "ubuntu-01",
        session: session(),
        based_on: null,
      }),
      event(
        "pixel-9",
        "task.assigned",
        at("15:02:00"),
        { assignee: "claude@macbook-pro" },
        human("pixel-9"),
      ),
      event("ubuntu-01", "task.released", at("15:03:00"), { epoch: 1 }),
    );
    expect(await taskOf(task)).toMatchObject({ moving_to: "macbook-pro", released_epoch: 1 });
    await ws.task(
      task,
      event("macbook-pro", "task.claimed", at("15:04:00"), {
        epoch: 2,
        device: "macbook-pro",
        session: session(),
        based_on: null,
      }),
    );
    expect(await taskOf(task)).toMatchObject({ moving_to: null, owner: "macbook-pro" });
  });

  it("ignores a claim from a device that is not the assignee's: AW never moves a task", async () => {
    // docs/decisions/2026-11-23-manual-move.md items 1 and 4: the laptop is offline, but only a
    // human task.assigned moves the task.
    const task = newTask();
    await ws.task(
      task,
      event(
        "pixel-9",
        "task.created",
        at("15:00:00"),
        createdData("AW-20", { assignee: "claude@macbook-pro" }),
        human("pixel-9"),
      ),
      event(
        "ubuntu-01",
        "task.claimed",
        at("15:20:00"),
        { epoch: 1, device: "ubuntu-01", session: session(), based_on: null },
        { by: "aw@ubuntu-01" },
      ),
      event(
        "ubuntu-01",
        "task.assigned",
        at("15:20:01"),
        { assignee: "claude@ubuntu-01" },
        { by: "aw@ubuntu-01" },
      ),
    );
    const { view } = await merge();
    expect(view.tasks.find((t) => t.id === task)).toMatchObject({
      owner: "pixel-9",
      claim: null,
      moving_to: null,
      assignee: "claude@macbook-pro",
    });
    expect(view.issues.filter((i) => i.task === task).map((i) => i.reason)).toEqual([
      "not_assignee_device",
      "assignment_not_allowed",
    ]);
  });

  it("ignores a claim of a task with no assignee", async () => {
    const task = newTask();
    await ws.task(
      task,
      event(
        "macbook-pro",
        "task.created",
        at("15:00:00"),
        createdData("AW-20"),
        human("macbook-pro"),
      ),
      event("macbook-pro", "task.claimed", at("15:01:00"), {
        epoch: 1,
        device: "macbook-pro",
        session: session(),
        based_on: null,
      }),
    );
    const { view } = await merge();
    expect(view.tasks.find((t) => t.id === task)).toMatchObject({
      owner: "macbook-pro",
      claim: null,
    });
    expect(view.issues.filter((i) => i.task === task).map((i) => i.reason)).toEqual([
      "not_assignee_device",
    ]);
  });

  it("merges the wake-up comment of a former owner with the branch name", async () => {
    // architecture.md 4.3.4.3: the laptop that wakes after a move writes a comment, not a state event.
    const task = newTask();
    const claim = (dev: string, epoch: number, hlc: string) =>
      event(dev, "task.claimed", hlc, { epoch, device: dev, session: session(), based_on: null });
    const text = "Moved to ubuntu-01. Unpushed work is on aw/AW-20-macbook-pro-0315.";
    await ws.task(
      task,
      event(
        "macbook-pro",
        "task.created",
        at("15:00:00"),
        createdData("AW-20", { assignee: "claude@macbook-pro" }),
        human("macbook-pro"),
      ),
      claim("macbook-pro", 1, at("15:01:00")),
      // The laptop sleeps; a human moves the task (docs/decisions/2026-11-23-manual-move.md item 3).
      event(
        "pixel-9",
        "task.assigned",
        at("15:10:00"),
        { assignee: "claude@ubuntu-01" },
        human("pixel-9"),
      ),
      claim("ubuntu-01", 2, at("15:20:00")),
      // The laptop wakes with an old view and claims with a higher epoch: ignored (item 4).
      claim("macbook-pro", 3, at("15:40:00")),
      event("macbook-pro", "comment.added", at("15:40:01"), { text }, { by: "aw@macbook-pro" }),
      event(
        "macbook-pro",
        "message.agent",
        at("15:40:02"),
        { text: "Done.", session: null },
        { by: "claude@macbook-pro" },
      ),
    );
    const { view } = await merge();
    const merged = view.tasks.find((t) => t.id === task)!;
    expect(merged).toMatchObject({
      owner: "ubuntu-01",
      assignee: "claude@ubuntu-01",
      claim: { epoch: 2 },
    });
    expect(merged.comments.map((c) => [c.dev, c.by, c.text])).toEqual([
      ["macbook-pro", "aw@macbook-pro", text],
    ]);
    expect(view.issues.filter((i) => i.task === task).map((i) => [i.reason, i.line])).toEqual([
      ["not_assignee_device", 3],
      ["not_owner", 5],
    ]);
  });
});

describe("gates", () => {
  const gate = newId({ now: () => 1 });

  async function openGate(task: string, kind: string, by = "ubuntu-01") {
    await ws.task(
      task,
      event(
        "macbook-pro",
        "task.created",
        at("15:00:00"),
        createdData("AW-20", { assignee: "claude@ubuntu-01" }),
        human("macbook-pro"),
      ),
      event("ubuntu-01", "task.claimed", at("15:01:00"), {
        epoch: 1,
        device: "ubuntu-01",
        session: session(),
        based_on: null,
      }),
      event(by, "gate.opened", at("15:02:00"), {
        gate,
        kind,
        version: 1,
        title: "Which columns?",
        text: "",
        options: ["All", "Totals only"],
        request_id: null,
        file: null,
      }),
    );
  }

  it("shows a pending answer as waiting for the owner", async () => {
    const task = newTask();
    await openGate(task, "question");
    await ws.task(
      task,
      event(
        "pixel-9",
        "gate.answered",
        at("15:03:00"),
        { gate, version: 1, answer: "yes", comment: null },
        human("pixel-9"),
      ),
    );
    const view = await taskOf(task);
    expect(view.needs_you_reasons).toEqual([
      { reason: "gate", gate, kind: "question", waiting_for_owner: true },
    ]);
    expect(view.gates[0]!.answers[0]!.use).toBe("pending");
  });

  it("keeps an open gate of an archived or done task out of the Needs you lane", async () => {
    const task = newTask();
    await openGate(task, "question");
    await ws.task(
      task,
      event("macbook-pro", "task.archived", at("15:03:00"), {}, human("macbook-pro")),
    );
    let view = await taskOf(task);
    expect(view.archived).toBe(true);
    expect(view.needs_you).toEqual([gate]);
    expect(view.needs_you_reasons).toEqual([]);
    expect(view.needs_you_lane).toBe(false);

    const done = newTask();
    await openGate(done, "question");
    await ws.task(done, event("ubuntu-01", "task.done", at("15:03:00"), {}));
    view = await taskOf(done);
    expect(view.stage).toBe("done");
    expect(view.needs_you_lane).toBe(false);
  });

  it("refuses a gate.resolved of another device", async () => {
    const task = newTask();
    await openGate(task, "question");
    await ws.task(
      task,
      event("macbook-pro", "gate.resolved", at("15:03:00"), {
        gate,
        version: 1,
        answer_event: null,
        answer: "x",
      }),
    );
    expect((await taskOf(task)).gates[0]!.state).toBe("open");
  });

  it("ignores a gate that another device than the owner opens: the answer becomes a comment", async () => {
    // No gate kind is open to each device (docs/decisions/2026-11-23-manual-move.md item 2).
    const task = newTask();
    await openGate(task, "question", "macbook-pro");
    await ws.task(
      task,
      event(
        "pixel-9",
        "gate.answered",
        at("15:05:00"),
        { gate, version: 1, answer: "All", comment: null },
        human("pixel-9"),
      ),
    );
    const { view } = await merge();
    const merged = view.tasks.find((t) => t.id === task)!;
    expect(merged.gates).toEqual([]);
    expect(merged.comments.map((c) => [c.source, c.text])).toEqual([["late_answer", "All"]]);
    expect(view.issues.filter((i) => i.task === task).map((i) => i.reason)).toEqual(["not_owner"]);
  });

  it("approves the proposal version of the gate file with Approve", async () => {
    const task = newTask();
    await ws.task(
      task,
      event(
        "macbook-pro",
        "task.created",
        at("15:00:00"),
        createdData("AW-20", { assignee: "claude@ubuntu-01" }),
        human("macbook-pro"),
      ),
      event("ubuntu-01", "task.claimed", at("15:01:00"), {
        epoch: 1,
        device: "ubuntu-01",
        session: session(),
        based_on: null,
      }),
      event("ubuntu-01", "proposal.proposed", at("15:02:00"), {
        version: 2,
        file: "proposal/v2.md",
      }),
      event("ubuntu-01", "gate.opened", at("15:02:00", 1), {
        gate,
        kind: "approve_proposal",
        version: 1,
        title: "",
        text: "",
        options: [],
        request_id: null,
        file: "proposal/v2.md",
      }),
      event("ubuntu-01", "gate.resolved", at("15:03:00"), {
        gate,
        version: 1,
        answer_event: null,
        answer: "Approve",
      }),
    );
    expect((await taskOf(task)).proposal).toEqual({ latest: 2, approved: 2 });
  });

  it("approves the version of a gate from before the rename (approach, Confirm)", async () => {
    const task = newTask();
    await ws.task(
      task,
      event(
        "macbook-pro",
        "task.created",
        at("15:00:00"),
        createdData("AW-20", { assignee: "claude@ubuntu-01" }),
        human("macbook-pro"),
      ),
      event("ubuntu-01", "task.claimed", at("15:01:00"), {
        epoch: 1,
        device: "ubuntu-01",
        session: session(),
        based_on: null,
      }),
      event("ubuntu-01", "approach.proposed", at("15:02:00"), {
        version: 2,
        file: "approach/v2.md",
      }),
      event("ubuntu-01", "gate.opened", at("15:02:00", 1), {
        gate,
        kind: "confirm_approach",
        version: 1,
        title: "",
        text: "",
        options: [],
        request_id: null,
        file: "approach/v2.md",
      }),
      event("ubuntu-01", "gate.resolved", at("15:03:00"), {
        gate,
        version: 1,
        answer_event: null,
        answer: "Confirm",
      }),
    );
    expect((await taskOf(task)).proposal).toEqual({ latest: 2, approved: 2 });
  });
});

describe("fields and assignment", () => {
  it("takes the newest edit per field and locks the first message after the first session", async () => {
    const task = newTask();
    await ws.task(
      task,
      event(
        "macbook-pro",
        "task.created",
        at("15:00:00"),
        createdData("AW-20", { assignee: "claude@ubuntu-01" }),
        human("macbook-pro"),
      ),
      event(
        "pixel-9",
        "task.edited",
        at("15:00:10"),
        { field: "title", value: "New title" },
        human("pixel-9"),
      ),
      event(
        "macbook-pro",
        "task.edited",
        at("15:00:05"),
        { field: "title", value: "Older title" },
        human("macbook-pro"),
      ),
      event(
        "pixel-9",
        "task.edited",
        at("15:00:20"),
        { field: "first_message", value: "/my-team:implement it" },
        human("pixel-9"),
      ),
      event(
        "macbook-pro",
        "task.edited",
        at("15:00:30"),
        { field: "priority", value: "high" },
        human("macbook-pro"),
      ),
      event("ubuntu-01", "task.claimed", at("15:01:00"), {
        epoch: 1,
        device: "ubuntu-01",
        session: session(),
        based_on: null,
      }),
      event("ubuntu-01", "session.started", at("15:01:01"), {
        session: session(),
        host: "tmux",
        cwd: "/w",
        plugin_dir: null,
        branch: "aw/AW-20",
        credentials: [],
        pids: { pane: null, claude: null, pgid: null },
      }),
      event(
        "pixel-9",
        "task.edited",
        at("15:02:00"),
        { field: "first_message", value: "too late" },
        human("pixel-9"),
      ),
    );
    const view = await taskOf(task);
    expect(view).toMatchObject({
      title: "New title",
      first_message: "/my-team:implement it",
      priority: "high",
      branch: "aw/AW-20",
    });
    const { view: all } = await merge();
    expect(all.issues.filter((i) => i.task === task).map((i) => i.reason)).toEqual([
      "first_message_locked",
    ]);
  });

  it("keeps the link to the Claude session and takes the new pane of a resume (agent-pushes-updates)", async () => {
    const task = newTask();
    const s = session();
    await ws.task(
      task,
      event(
        "macbook-pro",
        "task.created",
        at("15:00:00"),
        createdData("AW-21", { assignee: "claude@ubuntu-01" }),
        human("macbook-pro"),
      ),
      event("ubuntu-01", "task.claimed", at("15:01:00"), {
        epoch: 1,
        device: "ubuntu-01",
        session: s,
        based_on: null,
      }),
      event("ubuntu-01", "session.started", at("15:01:01"), {
        session: s,
        host: "tmux",
        cwd: "/w",
        pids: { pane: 4242, claude: 4242, pgid: 4242 },
        name: "AW-21",
        terminal: { window: "aw-01a2", pane: "%12" },
      }),
    );
    expect((await taskOf(task)).session).toMatchObject({
      name: "AW-21",
      terminal: { window: "aw-01a2", pane: "%12" },
      pid: 4242,
    });
    // A resume opens a new pane; "Resume again" names none and keeps the values.
    await ws.task(
      task,
      event("ubuntu-01", "session.resumed", at("15:05:00"), {
        session: s,
        text: "[AW resume] …",
        terminal: { window: "aw-01a2", pane: "%15" },
        pids: { pane: 5151, claude: 5151, pgid: 5151 },
      }),
      event("ubuntu-01", "session.resumed", at("15:06:00"), { session: s, text: "" }),
    );
    expect((await taskOf(task)).session).toMatchObject({
      name: "AW-21",
      terminal: { window: "aw-01a2", pane: "%15" },
      pid: 5151,
    });
  });

  it("accepts a human assignment and refuses an agent assignment with the switch off", async () => {
    const task = newTask();
    await ws.task(
      task,
      event(
        "macbook-pro",
        "task.created",
        at("15:00:00"),
        createdData("AW-20"),
        human("macbook-pro"),
      ),
      event(
        "ubuntu-01",
        "task.assigned",
        at("15:01:00"),
        { assignee: "claude@ubuntu-01" },
        { by: "claude@ubuntu-01" },
      ),
    );
    expect(await taskOf(task)).toMatchObject({
      assignee: null,
      needs_you_reasons: [{ reason: "assign" }],
    });
    await ws.task(
      task,
      event(
        "pixel-9",
        "task.assigned",
        at("15:02:00"),
        { assignee: "claude@ubuntu-01" },
        human("pixel-9"),
      ),
    );
    expect(await taskOf(task)).toMatchObject({
      assignee: "claude@ubuntu-01",
      needs_you_lane: false,
    });
  });

  it("with the project switch on, accepts a subtask assignment from the owner of the parent only", async () => {
    await ws.write(
      "tasks/projects/billing-api/project.yaml",
      "kind: project\nschema: 1\nslug: billing-api\nname: Billing API\ndevices: [ubuntu-01, macbook-pro]\nswitches:\n  assign_new_subtasks_to_default_device: true\n",
    );
    // The parent is the fixture task AW-7, owned by ubuntu-01 (claim epoch 1).
    const ok = newTask();
    const refused = newTask();
    await ws.task(
      ok,
      event(
        "ubuntu-01",
        "task.created",
        at("15:00:00"),
        createdData("AW-20", { parent: FIXTURE_TASK, assignee: "claude@ubuntu-01" }),
        { by: "claude@ubuntu-01" },
      ),
    );
    await ws.task(
      refused,
      event(
        "macbook-pro",
        "task.created",
        at("15:00:00"),
        createdData("AW-21", { parent: FIXTURE_TASK, assignee: "claude@macbook-pro" }),
        { by: "claude@macbook-pro" },
      ),
    );
    const { view } = await merge();
    expect(view.tasks.find((t) => t.id === ok)!.assignee).toBe("claude@ubuntu-01");
    expect(view.tasks.find((t) => t.id === refused)!.assignee).toBeNull();
    // Subtasks sort by the merge order of task.created: the same HLC, then "macbook-pro" first.
    expect(view.tasks.find((t) => t.id === FIXTURE_TASK)!.subtasks).toEqual([refused, ok]);
  });

  it("lists the open dependencies and the comments in order", async () => {
    const dep = newTask();
    const task = newTask();
    await ws.task(
      dep,
      event(
        "macbook-pro",
        "task.created",
        at("15:00:00"),
        createdData("AW-20"),
        human("macbook-pro"),
      ),
    );
    await ws.task(
      task,
      event(
        "macbook-pro",
        "task.created",
        at("15:00:01"),
        createdData("AW-21", { depends_on: [dep, FIXTURE_TASK] }),
        human("macbook-pro"),
      ),
      event("pixel-9", "comment.added", at("15:00:03"), { text: "second" }, human("pixel-9")),
      event(
        "macbook-pro",
        "comment.added",
        at("15:00:02"),
        { text: "first" },
        human("macbook-pro"),
      ),
      event("macbook-pro", "task.archived", at("15:00:04"), {}, human("macbook-pro")),
    );
    const view = await taskOf(task);
    expect(view.open_dependencies).toEqual([dep, FIXTURE_TASK]);
    expect(view.comments.map((c) => c.text)).toEqual(["first", "second"]);
    expect(view).toMatchObject({ archived: true, needs_you_lane: false });
  });
});

describe("archive and unarchive (openspec task-actions)", () => {
  it("folds task.archived and task.unarchived in merge order: the newest wins", async () => {
    const task = newTask();
    const created = event(
      "macbook-pro",
      "task.created",
      at("15:00:00"),
      createdData("AW-40"),
      human("macbook-pro"),
    );
    await ws.task(
      task,
      created,
      event("macbook-pro", "task.archived", at("15:00:01"), {}, human("macbook-pro")),
      // Another device unarchives later: its event is the newest.
      event("pixel-9", "task.unarchived", at("15:00:02"), {}, human("pixel-9")),
    );
    expect((await taskOf(task)).archived).toBe(false);
    await ws.append(`tasks/${task}/log/macbook-pro.jsonl`, {
      ...event("macbook-pro", "task.archived", at("15:00:03"), {}, human("macbook-pro")),
      task,
    });
    expect((await taskOf(task)).archived).toBe(true);
  });
});

describe("task keys", () => {
  it("keeps the key of the earlier task of the same device, and gives the next free key", async () => {
    const a = newTask();
    const b = newTask();
    await ws.task(
      a,
      event("ubuntu-01", "task.created", at("15:00:00"), createdData("AW-7"), human("ubuntu-01")),
    );
    await ws.task(
      b,
      event(
        "macbook-pro",
        "task.created",
        at("15:00:01"),
        createdData("AW-30"),
        human("macbook-pro"),
      ),
    );
    const { view } = await merge();
    // AW-7 of the fixture is from macbook-pro (local): it keeps the key.
    expect(view.tasks.find((t) => t.id === a)).toMatchObject({
      key_state: "duplicate",
      rekey_by: "ubuntu-01",
    });
    expect(view.tasks.find((t) => t.id === FIXTURE_TASK)!.key_state).toBe("ok");
    expect(nextFreeKey(view, "AW")).toBe("AW-31");
  });

  it("refuses a rekey with a stale from key", async () => {
    const a = newTask();
    await ws.task(
      a,
      event("pixel-9", "task.created", at("15:00:00"), createdData("AW-20"), human("pixel-9")),
      event("pixel-9", "task.rekeyed", at("15:01:00"), { from: "AW-19", to: "AW-21" }),
    );
    expect((await taskOf(a)).key).toBe("AW-20");
  });
});

describe("HLC bound", () => {
  it("holds a far-future event until the local clock comes within the bound", async () => {
    const engine = new MergeEngine({ root: ws.root, clock, maxSkewMs: 60_000 });
    await ws.task(
      FIXTURE_TASK,
      event(
        "pixel-9",
        "comment.added",
        "2026-11-22T16:05:00.000Z#0000",
        { text: "early" },
        human("pixel-9"),
      ),
    );
    let update = await engine.update();
    expect(update.view.issues.map((i) => i.code)).toEqual(["future_hlc"]);
    expect(engine.lastHlc()).toBe("2026-11-22T14:22:00.000Z#0000");
    clock.advance(4 * 60_000);
    update = await engine.update();
    expect(update.view.issues).toEqual([]);
    expect(engine.lastHlc()).toBe("2026-11-22T16:05:00.000Z#0000");
    expect(update.view.tasks[0]!.comments.at(-1)!.text).toBe("early");
  });

  it("holds a far-future heartbeat, so presence ignores it", async () => {
    await ws.append(
      "tasks/devices/pixel-9/heartbeat/2026-11-22.jsonl",
      event("pixel-9", "device.heartbeat", "2027-01-01T00:00:00.000Z#0000", {
        boot_time: "2026-11-21T22:40:00.000Z",
      }),
    );
    const { presence, view } = await merge();
    expect(presence.devices.find((d) => d.device === "pixel-9")!.last_heartbeat_hlc).toBe(
      "2026-11-22T14:21:00.000Z#0000",
    );
    expect(view.issues.map((i) => i.code)).toEqual(["future_hlc"]);
  });
});

describe("unknown event types", () => {
  it("keeps an unknown type and does not apply it", async () => {
    const before = await merge();
    await ws.task(
      FIXTURE_TASK,
      event("ubuntu-01", "task.future_thing", at("14:30:00"), { stage: "done" }),
    );
    const engine = new MergeEngine({ root: ws.root, clock });
    const after = await engine.update();
    const strip = (t: TaskView) => ({ ...t, event_count: 0, includes: {}, last_hlc: null });
    expect(strip(after.view.tasks[0]!)).toEqual(strip(before.view.tasks[0]!));
    expect(after.view.issues.map((i) => [i.code, i.reason])).toEqual([
      ["unknown_type", "unknown_type"],
    ]);
    expect(engine.eventRows(FIXTURE_TASK).at(-1)).toMatchObject({
      type: "task.future_thing",
      applied: false,
      reason: "unknown_type",
    });
  });
});

describe("workspace log", () => {
  const task = FIXTURE_TASK;
  const lease = (type: string, hlc: string, data: Record<string, unknown>, dev = "ubuntu-01") =>
    event(dev, type, hlc, { resource: "k3d", slot: 0, fencing_token: 4, ...data });

  it("keeps the newest queue order and the credential names", async () => {
    await ws.append(
      "tasks/log/pixel-9.jsonl",
      event(
        "pixel-9",
        "queue.reordered",
        at("15:00:00"),
        { agent: "claude@ubuntu-01", tasks: [] },
        human("pixel-9"),
      ),
      event(
        "pixel-9",
        "credential.added",
        at("15:00:01"),
        { name: "github-bot" },
        human("pixel-9"),
      ),
      event(
        "pixel-9",
        "credential.removed",
        at("15:00:02"),
        { name: "stripe-test" },
        human("pixel-9"),
      ),
    );
    const { view } = await merge();
    expect(view.queues).toMatchObject([{ agent: "claude@ubuntu-01", tasks: [], dev: "pixel-9" }]);
    expect(view.credentials.map((c) => c.name)).toEqual(["github-bot"]);
  });

  it("refuses a lease of a resource named like an object property (final check fc1-15)", async () => {
    await ws.append(
      "tasks/log/ubuntu-01.jsonl",
      lease("slot.acquired", at("15:00:00"), {
        resource: "constructor",
        ttl_ms: 1000,
        task,
        session: session(),
      }),
    );
    const { view } = await merge();
    expect(view.slots).toEqual([]);
    expect(view.issues.map((i) => i.reason)).toEqual(["not_resource_device"]);
  });

  it("accepts leases only from the resource device, with a fencing token that never goes back", async () => {
    await ws.append(
      "tasks/log/ubuntu-01.jsonl",
      lease("slot.acquired", at("15:00:00"), { ttl_ms: 1_800_000, task, session: session() }),
      lease("slot.renewed", at("15:10:00"), { ttl_ms: 1_800_000 }),
      lease("slot.acquired", at("15:11:00"), {
        fencing_token: 4,
        ttl_ms: 1000,
        task,
        session: session(),
      }),
      lease("slot.acquired", at("15:12:00"), { slot: 1, ttl_ms: 1000, task, session: session() }),
    );
    await ws.append(
      "tasks/log/macbook-pro.jsonl",
      lease(
        "slot.acquired",
        at("15:00:00"),
        { ttl_ms: 1000, task, session: session() },
        "macbook-pro",
      ),
    );
    const { view } = await merge();
    expect(view.slots).toMatchObject([
      {
        device: "ubuntu-01",
        resource: "k3d",
        slot: 0,
        fencing_token: 4,
        expires_at: "2026-11-22T15:40:00.000Z",
      },
    ]);
    expect(view.issues.map((i) => i.reason)).toEqual([
      "not_resource_device",
      "stale_fencing_token",
      "no_such_slot",
    ]);
  });
});

describe("presence", () => {
  it("drops a duplicate heartbeat id and reports it, whatever the read order", async () => {
    const path = "tasks/devices/pixel-9/heartbeat/2026-11-22.jsonl";
    const { readFile } = await import("node:fs/promises");
    const lines = (await readFile(`${ws.root}/${path}`, "utf8")).trim().split("\n");
    const beats = lines.map((line) => JSON.parse(line) as { id: string; hlc: string });
    // A conflict copy brings the first heartbeat twice in the same file.
    await ws.appendText(path, `${lines[0]}\n`);
    // An older file has the id of the last heartbeat with an older HLC. Its path is smaller, so
    // it wins: the last heartbeat of the newer file is then the second one.
    await ws.append("tasks/devices/pixel-9/heartbeat/2026-11-21.jsonl", {
      ...beats[2],
      hlc: at("14:19:00"),
    });
    const sorted = await merge();
    const reversed = await mergeWorkspace(ws.root, {
      clock,
      readOrder: (paths) => [...paths].reverse(),
    });
    expect(reversed.view).toEqual(sorted.view);
    expect(sorted.view.devices.find((d) => d.slug === "pixel-9")!.heartbeat).toMatchObject({
      count: 3,
      last_hlc: beats[1]!.hlc,
    });
    expect(sorted.view.issues.map((i) => [i.code, i.path, i.line])).toEqual([
      ["duplicate_event", path, 3],
      ["duplicate_event", path, 4],
    ]);
  });

  it("starts the receipts again at a rebuild (first receipt rule)", async () => {
    clock.set("2026-11-22T14:30:00.000Z");
    const engine = new MergeEngine({ root: ws.root, clock });
    await engine.update();
    // ubuntu-01 has a clock 5 min late: the receipt of its new heartbeat is the local time.
    await ws.append(
      "tasks/devices/ubuntu-01/heartbeat/2026-11-22.jsonl",
      event("ubuntu-01", "device.heartbeat", at("14:25:00"), {
        boot_time: "2026-11-19T03:12:00.000Z",
      }),
    );
    let update = await engine.update();
    expect(update.presence.devices.find((d) => d.device === "ubuntu-01")).toMatchObject({
      online: true,
      received_at: "2026-11-22T14:30:00.000Z",
    });
    clock.set("2026-11-22T14:31:00.000Z");
    update = await engine.rebuild();
    // After a rebuild, the first receipt is the earlier of the local time and the HLC time.
    expect(update.presence.devices.find((d) => d.device === "ubuntu-01")).toMatchObject({
      online: false,
      received_at: "2026-11-22T14:25:00.000Z",
    });
  });

  it("uses the receive time for later heartbeats; a task of an offline device only waits", async () => {
    clock.set("2026-11-22T14:21:30.000Z");
    const engine = new MergeEngine({ root: ws.root, clock });
    let update = await engine.update();
    expect(update.presence.devices.every((d) => d.online)).toBe(true);
    // ubuntu-01 has a clock 5 min late: its new heartbeat has an old HLC, but it is new.
    clock.set("2026-11-22T14:30:00.000Z");
    await ws.append(
      "tasks/devices/ubuntu-01/heartbeat/2026-11-22.jsonl",
      event("ubuntu-01", "device.heartbeat", at("14:25:00"), {
        boot_time: "2026-11-19T03:12:00.000Z",
      }),
    );
    update = await engine.update();
    expect(update.presence.devices.find((d) => d.device === "ubuntu-01")).toMatchObject({
      online: true,
      received_at: "2026-11-22T14:30:00.000Z",
    });
    // After 2 h offline, the task still only waits (docs/decisions/2026-11-23-manual-move.md).
    clock.set("2026-11-22T16:31:30.000Z");
    update = await engine.update();
    expect(update.presence.offline_tasks).toEqual([
      {
        task: FIXTURE_TASK,
        device: "ubuntu-01",
        cause: "device_offline",
        since: "2026-11-22T14:31:30.000Z",
      },
    ]);
    const fixture = update.view.tasks.find((t) => t.id === FIXTURE_TASK)!;
    expect(fixture).toMatchObject({ owner: "ubuntu-01", assignee: "claude@ubuntu-01" });
    expect(fixture.needs_you_reasons).toEqual([]);
  });
});

describe("start failure (openspec restart-agent)", () => {
  const aw = (dev: string) => ({ by: `aw@${dev}` });
  const failure = (hlc: string, text = "The session did not start on ubuntu-01: no commit yet.") =>
    event("ubuntu-01", "comment.added", hlc, { text, kind: "start_failed" }, aw("ubuntu-01"));

  it("keeps the last failed start, marks a person assignment as a retry, and clears it at a claim", async () => {
    const task = newTask();
    const created = event(
      "macbook-pro",
      "task.created",
      at("15:00:00"),
      createdData("AW-40", { assignee: "claude@ubuntu-01" }),
      human("macbook-pro"),
    );
    await ws.task(task, created, failure(at("15:01:00")));
    expect((await taskOf(task)).start_failure).toEqual({
      device: "ubuntu-01",
      text: "The session did not start on ubuntu-01: no commit yet.",
      at: at("15:01:00"),
      retrying: false,
    });
    // An agent assignment is no restart; a person assignment ("Restart agent") is one.
    await ws.task(
      task,
      event(
        "ubuntu-01",
        "task.assigned",
        at("15:01:30"),
        { assignee: "claude@ubuntu-01" },
        { by: "claude@ubuntu-01" },
      ),
    );
    expect((await taskOf(task)).start_failure?.retrying).toBe(false);
    await ws.task(
      task,
      event(
        "pixel-9",
        "task.assigned",
        at("15:02:00"),
        { assignee: "claude@ubuntu-01" },
        human("pixel-9"),
      ),
    );
    expect((await taskOf(task)).start_failure?.retrying).toBe(true);
    // A new failure after the restart: retrying is false again, with the new text.
    await ws.task(task, failure(at("15:02:05"), "The session did not start on ubuntu-01: again."));
    expect((await taskOf(task)).start_failure).toMatchObject({
      text: "The session did not start on ubuntu-01: again.",
      retrying: false,
    });
    await ws.task(
      task,
      event("ubuntu-01", "task.claimed", at("15:03:00"), {
        epoch: 1,
        device: "ubuntu-01",
        session: session(),
        based_on: null,
      }),
    );
    expect((await taskOf(task)).start_failure).toBeNull();
  });

  it("takes a start_failed comment only from awd of its own device, and no plain comment", async () => {
    const task = newTask();
    await ws.task(
      task,
      event(
        "macbook-pro",
        "task.created",
        at("15:00:00"),
        createdData("AW-41"),
        human("macbook-pro"),
      ),
      event(
        "ubuntu-01",
        "comment.added",
        at("15:01:00"),
        { text: "x", kind: "start_failed" },
        { by: "claude@ubuntu-01" },
      ),
      event(
        "ubuntu-01",
        "comment.added",
        at("15:01:01"),
        { text: "The session did not start" },
        aw("ubuntu-01"),
      ),
    );
    expect((await taskOf(task)).start_failure).toBeNull();
  });
});
