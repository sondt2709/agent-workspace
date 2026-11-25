// The task detail as an issue (openspec task-view-focus): Activity shows the task, Session keeps
// each raw event (principle 8), Terminal keeps only the terminal cards, Files shows the folder, and
// the layout follows the width of the task detail.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import casesJson from "../../../../../contracts/fixtures/activity/cases.json?raw";
import samplesJson from "../../../../../contracts/samples/schema-samples.json?raw";
import type { EventRow, Gate, Task, ThreadReply } from "../../../shared/channels.ts";
import threadJson from "../fixtures/thread-aw-8.json?raw";
import { installBridge, makeGate, makeTask, renderApp } from "../testing.tsx";
import { DialogsProvider } from "./dialogs.tsx";
import { TaskDetail } from "./TaskDetail.tsx";
import { TaskPage } from "./TaskViews.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const AW8 = (JSON.parse(threadJson) as { thread: ThreadReply }).thread;
const created = AW8.events.find((r) => r.type === "task.created")!;
const AW8_TASK = makeTask({
  id: AW8.task.id,
  key: "AW-8",
  project: "web-app",
  title: "Speed up the dashboard query",
  first_message: String(created.event.data.first_message),
  assignee: "claude@macbook-pro",
});

function show(
  task: Task,
  thread: ThreadReply,
  more: Record<string, (args: never) => unknown> = {},
) {
  installBridge({
    task: () => task,
    tasks: () => [task],
    thread: () => thread,
    ...more,
  });
  return renderApp(
    <DialogsProvider ws="ws-1">
      <TaskDetail ws="ws-1" taskId={task.id} />
    </DialogsProvider>,
  );
}

/** A ResizeObserver that reports one width for each observed element. */
function stubWidth(width: number) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      readonly cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe() {
        this.cb([{ contentRect: { width } } as ResizeObserverEntry], this);
      }
      disconnect() {}
      unobserve() {}
    },
  );
}

describe("Session tab", () => {
  it("shows one row with text for each contract event type and an unknown type", async () => {
    const samples = JSON.parse(samplesJson) as {
      event_types: { type: string; valid: EventRow["event"] }[];
      unknown_type: EventRow["event"];
    };
    const events = [...samples.event_types.map((e) => e.valid), samples.unknown_type];
    const rows: EventRow[] = events.map((event, i) => ({
      id: `row-${i}`,
      task: AW8_TASK.id,
      hlc: event.hlc,
      dev: event.dev,
      type: event.type,
      path: `tasks/${AW8_TASK.id}/log/${event.dev}.jsonl`,
      line: i + 1,
      applied: true,
      reason: null,
      event,
    }));
    show(AW8_TASK, { ...AW8, events: rows, ancestors: [] });
    await userEvent.click(await screen.findByRole("tab", { name: "Session" }));
    const list = await screen.findByRole("region", { name: "Session events" });
    const shown = [...list.children];
    expect(shown).toHaveLength(samples.event_types.length + 1);
    for (const row of shown) expect(row.textContent?.trim().length).toBeGreaterThan(5);
    expect(within(list).getByText(/^task\.teleported/)).toBeTruthy();
  });

  it("shows the session lines and each input of the real AW-8 thread", async () => {
    show(AW8_TASK, AW8);
    await userEvent.click(await screen.findByRole("tab", { name: "Session" }));
    const list = await screen.findByRole("region", { name: "Session events" });
    expect(list.children).toHaveLength(AW8.events.length);
    expect(within(list).getByText(/claimed the task \(epoch 1\)/)).toBeTruthy();
    expect(within(list).getByText(/^Session started on macbook-pro in tmux/)).toBeTruthy();
    expect(within(list).getAllByText(/^· first · /)).toHaveLength(1);
  });
});

describe("Session summary", () => {
  it("shows the session id of an ended session with no claim", async () => {
    const task = {
      ...makeTask({}),
      session: {
        session: "01a20a1c-5e55-7000-8000-000000000009",
        device: "macbook-pro",
        host: "tmux",
        state: "ended",
        reason: "stopped",
      },
      claim: null,
    } as Task;
    show(task, { ...AW8, events: [], ancestors: [] });
    await userEvent.click(await screen.findByRole("tab", { name: "Session" }));
    const summary = await screen.findByRole("region", { name: "Session summary" });
    expect(summary.textContent).toContain("Ended (stopped) on macbook-pro · tmux");
    expect(summary.textContent).toContain("session 01a20a1c");
  });

  it("links the task to the Claude session and the terminal (agent-pushes-updates)", async () => {
    const task = {
      ...makeTask({}),
      session: {
        session: "01a20a1c-5e55-7000-8000-000000000009",
        device: "macbook-pro",
        host: "tmux",
        state: "running",
        reason: null,
        name: "AW-7",
        terminal: { window: "aw-01a2", pane: "%12" },
        pid: 4242,
      },
      claim: null,
    } as Task;
    show(task, { ...AW8, events: [], ancestors: [] });
    await userEvent.click(await screen.findByRole("tab", { name: "Session" }));
    const link = await screen.findByLabelText("Session link");
    expect(link.textContent).toBe(
      "Claude session 01a20a1c-5e55-7000-8000-000000000009 · name AW-7 · tmux window aw-01a2 · pane %12 · pid 4242",
    );
  });
});

describe("Task actions menu (openspec task-actions)", () => {
  const running = (overrides: Partial<Task> = {}) =>
    ({
      ...makeTask({ id: "t1", key: "AW-7", ...overrides }),
      session: {
        session: "01a20a1c-5e55-7000-8000-000000000009",
        device: "ubuntu-01",
        host: "tmux",
        state: "running",
        reason: null,
      },
    }) as Task;
  const empty = { ...AW8, events: [], ancestors: [] };
  const reply = (a: Record<string, unknown>) => ({ ...a, applied: true });
  /** The task detail with the fake bridge; returns the call spy of the bridge. */
  function open(task: Task, more: Record<string, (args: never) => unknown>) {
    const call = installBridge({
      task: () => task,
      tasks: () => [task],
      thread: () => empty,
      ...more,
    });
    renderApp(
      <DialogsProvider ws="ws-1">
        <TaskDetail ws="ws-1" taskId={task.id} />
      </DialogsProvider>,
    );
    return call;
  }

  it("stops a session on another device after a confirm that names the device", async () => {
    const call = open(running(), { stopTaskSession: reply });
    await userEvent.click(await screen.findByRole("button", { name: "Task actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Stop session…" }));
    const dialog = screen.getByRole("dialog", { name: "Stop the session on ubuntu-01?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Stop session" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("stopTaskSession", { ws: "ws-1", task: "t1" }),
    );
    expect(call).not.toHaveBeenCalledWith("stopSession", expect.anything());
    // One way: the Session summary has no Stop button.
    await userEvent.click(screen.getByRole("tab", { name: "Session" }));
    const summary = await screen.findByRole("region", { name: "Session summary" });
    expect(within(summary).queryByRole("button")).toBeNull();
  });

  it("archives with a running session in one confirm that names the device and stops it", async () => {
    const call = open(running(), { archiveTask: reply });
    await userEvent.click(await screen.findByRole("button", { name: "Task actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Archive task…" }));
    const dialog = screen.getByRole("dialog", { name: "Stop the session and archive AW-7?" });
    expect(dialog.textContent).toContain("A session of this task runs on ubuntu-01");
    await userEvent.click(within(dialog).getByRole("button", { name: "Stop and archive" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("archiveTask", {
        ws: "ws-1",
        task: "t1",
        stop: true,
      }),
    );
  });

  it("archives with no session without a stop, and has no Stop session item", async () => {
    const call = open(makeTask({ id: "t1", key: "AW-7" }), { archiveTask: reply });
    await userEvent.click(await screen.findByRole("button", { name: "Task actions" }));
    expect(screen.queryByRole("menuitem", { name: "Stop session…" })).toBeNull();
    await userEvent.click(screen.getByRole("menuitem", { name: "Archive task…" }));
    const dialog = screen.getByRole("dialog", { name: "Archive AW-7?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("archiveTask", {
        ws: "ws-1",
        task: "t1",
        stop: false,
      }),
    );
  });

  it("unarchives an archived task from the menu", async () => {
    const call = open(makeTask({ id: "t1", key: "AW-7", archived: true }), {
      unarchiveTask: reply,
    });
    expect(await screen.findByText("Archived")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Task actions" }));
    expect(screen.queryByRole("menuitem", { name: "Archive task…" })).toBeNull();
    await userEvent.click(screen.getByRole("menuitem", { name: "Unarchive task" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("unarchiveTask", { ws: "ws-1", task: "t1" }),
    );
  });
});

describe("Activity tab", () => {
  it("shows the task: the description once, the messages, and no session detail", async () => {
    show(AW8_TASK, AW8);
    const activity = await screen.findByRole("region", { name: "Activity" });
    const description = screen.getByRole("region", { name: "Description" });
    expect(description.textContent).toContain("reply I read the query plan.");
    expect(within(activity).getByText(/^Created by human@macbook-pro/)).toBeTruthy();
    expect(within(activity).queryByText(/claimed the task/)).toBeNull();
    expect(within(activity).queryByText(/^Session started/)).toBeNull();
    expect(within(activity).queryByText(/^Progress:/)).toBeNull();
    expect(within(activity).queryByText(/^· first( message)? · /)).toBeNull();
    // The 3 messages of the person, not delivered yet.
    expect(
      within(activity).getAllByText(/^Please also check the query of the weekly report/),
    ).toHaveLength(3);
    // The agent replies stay.
    expect(
      within(activity).getByText("The p95 went from 1.8 s to 220 ms on the test data."),
    ).toBeTruthy();
    // The rows of the Activity rule only.
    const rows = AW8.events.filter(
      (r) =>
        ["task.created", "task.stage_changed", "message.agent", "message.sent"].includes(r.type) ||
        (r.type === "message.human" && r.event.data.source === "typed"),
    );
    expect(activity.children).toHaveLength(rows.length);
  });

  it("renders the description as Markdown, and the exact text with Show raw", async () => {
    const text = "# Plan\n\nUse **cents**.";
    show(makeTask({ first_message: text }), { ...AW8, events: [], ancestors: [] });
    const description = await screen.findByRole("region", { name: "Description" });
    expect(within(description).getByRole("heading", { name: "Plan" })).toBeTruthy();
    await userEvent.click(within(description).getByRole("switch", { name: "Show raw" }));
    expect(screen.getByTestId("description-raw").textContent).toBe(text);
  });

  it("does not say 'No activity yet' when older events can have activity", async () => {
    const claim = AW8.events.find((r) => r.type === "task.claimed")!;
    show(AW8_TASK, { ...AW8, events: [claim], prev: "older-page", ancestors: [] });
    expect(await screen.findByText(/^No activity in the newest 1 events\./)).toBeTruthy();
    expect(screen.queryByText(/No activity yet/)).toBeNull();
    expect(screen.getByRole("button", { name: "Show older" })).toBeTruthy();
  });

  it("cuts a long agent reply to 6 lines with Show more", async () => {
    const agent = AW8.events.find((r) => r.type === "message.agent")!;
    const long = { ...agent, event: { ...agent.event, data: { text: "1\n2\n3\n4\n5\n6\n7\n8" } } };
    show(AW8_TASK, { ...AW8, events: [long], ancestors: [] });
    const activity = await screen.findByRole("region", { name: "Activity" });
    expect(within(activity).getByText(/^1\s2\s3\s4\s5\s6$/)).toBeTruthy();
    await userEvent.click(within(activity).getByRole("button", { name: "Show more" }));
    expect(within(activity).getByText(/^1\s2\s3\s4\s5\s6\s7\s8$/)).toBeTruthy();
  });
});

describe("Terminal tab", () => {
  it("keeps the Take over terminal card and shows the other gates as one line", async () => {
    const question = makeGate({ title: "Which limit per client?" });
    const takeOver = makeGate({
      gate: "0193a000-0000-7000-8000-000000000002",
      kind: "take_over_terminal",
      title: "The agent needs the terminal",
      options: [],
    });
    const task = makeTask({
      gates: [question, takeOver],
      needs_you: ["question", "take_over_terminal"],
    });
    show(
      task,
      { ...AW8, events: [], ancestors: [] },
      {
        terminal: () => ({ snapshot: null, note: null, open: null, sign_in: null }),
      },
    );
    expect(await screen.findByText("Which limit per client?")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    expect(await screen.findByText("1 item needs you")).toBeTruthy();
    expect(screen.getByText("The agent needs the terminal")).toBeTruthy();
    expect(screen.queryByText("Which limit per client?")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show in Activity" }));
    expect(screen.getByRole("tab", { name: "Activity", selected: true })).toBeTruthy();
    expect(await screen.findByText("Which limit per client?")).toBeTruthy();
  });
});

describe("Open items on the other tabs", () => {
  it("shows one line on Session, Files and Properties when a gate is open", async () => {
    stubWidth(700);
    const task = makeTask({
      gates: [makeGate({ title: "Which limit per client?" })],
      needs_you: ["question"],
    });
    show(task, { ...AW8, events: [], ancestors: [] });
    expect(await screen.findByText("Which limit per client?")).toBeTruthy();
    for (const name of ["Session", "Files", "Properties"]) {
      await userEvent.click(screen.getByRole("tab", { name }));
      expect(await screen.findByText("1 item needs you")).toBeTruthy();
      expect(screen.queryByText("Which limit per client?")).toBeNull();
    }
    await userEvent.click(screen.getByRole("button", { name: "Show in Activity" }));
    expect(screen.getByRole("tab", { name: "Activity", selected: true })).toBeTruthy();
  });

  it("moves the focus to the Activity tab after Show in Activity", async () => {
    const task = makeTask({ gates: [makeGate()], needs_you: ["question"] });
    show(task, { ...AW8, events: [], ancestors: [] });
    await userEvent.click(await screen.findByRole("tab", { name: "Session" }));
    screen.getByRole("button", { name: "Show in Activity" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Activity" }));
  });

  it("shows no line when nothing needs the person", async () => {
    show(AW8_TASK, AW8);
    await userEvent.click(await screen.findByRole("tab", { name: "Session" }));
    await screen.findByRole("region", { name: "Session events" });
    expect(screen.queryByText(/needs? you$/)).toBeNull();
  });
});

describe("Layout", () => {
  it("has a Properties tab when the task detail is narrow", async () => {
    stubWidth(700);
    show(AW8_TASK, AW8);
    await userEvent.click(await screen.findByRole("tab", { name: "Properties" }));
    const properties = screen.getByRole("region", { name: "Properties" });
    expect(within(properties).getByText("claude@macbook-pro")).toBeTruthy();
    expect(within(properties).queryByText("First message")).toBeNull();
    expect(within(properties).queryByText(AW8_TASK.id)).toBeNull();
  });

  it("shows the properties as a panel when the task detail is wide", async () => {
    stubWidth(1200);
    show(AW8_TASK, AW8);
    expect(await screen.findByRole("region", { name: "Properties" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Properties" })).toBeNull();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Activity",
      "Session",
      "Terminal",
      "Files",
    ]);
  });

  it("shows the task list on request from 700 px, and the Properties tab next to it", async () => {
    stubWidth(1208);
    const other = makeTask({
      id: "0193a000-0000-7000-8000-0000000000cc",
      key: "AW-4",
      title: "Fix the date picker",
      needs_you_lane: true,
    });
    installBridge({ task: () => AW8_TASK, tasks: () => [AW8_TASK, other], thread: () => AW8 });
    renderApp(
      <DialogsProvider ws="ws-1">
        <TaskDetail ws="ws-1" taskId={AW8_TASK.id} />
      </DialogsProvider>,
    );
    expect(await screen.findByRole("region", { name: "Properties" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show list" }));
    const list = screen.getByRole("navigation", { name: "Task list" });
    expect(within(list).getByText("Needs you · 1")).toBeTruthy();
    expect(within(list).getByText("Fix the date picker")).toBeTruthy();
    // 1208 - 300 = 908 px: Properties is a tab again.
    expect(screen.getByRole("tab", { name: "Properties" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide list" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("has no Show list below 700 px", async () => {
    stubWidth(699);
    show(AW8_TASK, AW8);
    expect(await screen.findByRole("tab", { name: "Properties" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show list" })).toBeNull();
  });

  it("has one tab panel, labelled by the selected tab", async () => {
    show(AW8_TASK, AW8);
    const panel = await screen.findByRole("tabpanel", { name: "Activity" });
    expect(within(panel).getByRole("region", { name: "Description" })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Session" }));
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("tabpanel", { name: "Session" })).toBeTruthy();
  });

  it("shows the stage progress", async () => {
    show(makeTask({ stage: "implement" }), { ...AW8, events: [], ancestors: [] });
    expect(await screen.findByRole("img", { name: "Stage 4 of 6: Implement" })).toBeTruthy();
  });
});

describe("Files tab", () => {
  it("shows the folder of the task and a file", async () => {
    const root = `tasks/${AW8_TASK.id}`;
    show(AW8_TASK, AW8, {
      taskFiles: () => ({
        task: AW8_TASK.id,
        root,
        truncated: false,
        entries: [
          { path: `${root}/task.yaml`, name: "task.yaml", kind: "file", size: 80, modified: "x" },
        ],
      }),
      taskFile: () => ({
        path: `${root}/task.yaml`,
        size: 80,
        modified: "x",
        text: "kind: task\n",
        reason: null,
      }),
    });
    await userEvent.click(await screen.findByRole("tab", { name: "Files" }));
    await userEvent.click(await screen.findByText("task.yaml"));
    expect((await screen.findByLabelText("File text")).textContent).toBe("kind: task\n");
  });
});

describe("Task route Back", () => {
  it("opens the Inbox when the task is the first page of the app", async () => {
    installBridge({ task: () => AW8_TASK, tasks: () => [AW8_TASK], thread: () => AW8 });
    const { router } = renderApp(
      <DialogsProvider ws="ws-1">
        <TaskPage />
      </DialogsProvider>,
      { route: "/w/:ws/tasks/:task", url: `/w/ws-1/tasks/${AW8_TASK.id}` },
    );
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    expect(router.state.location.pathname).toBe("/w/ws-1/inbox");
  });
});

describe("Task route", () => {
  it("goes to the next task that needs the person, in the Inbox order", async () => {
    const a = { ...AW8_TASK, needs_you_lane: true };
    const b = makeTask({
      id: "0193a000-0000-7000-8000-0000000000dd",
      key: "AW-4",
      needs_you_lane: true,
    });
    installBridge({
      task: (args: { task: string }) => (args.task === b.id ? b : a),
      tasks: () => [a, makeTask({ id: "0193a000-0000-7000-8000-0000000000ee" }), b],
      thread: () => AW8,
    });
    const { router } = renderApp(
      <DialogsProvider ws="ws-1">
        <TaskPage />
      </DialogsProvider>,
      { route: "/w/:ws/tasks/:task", url: `/w/ws-1/tasks/${a.id}` },
    );
    expect(await screen.findByText("1 of 2 need you")).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Previous task that needs you" })
        .disabled,
    ).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Next task that needs you" }));
    expect(router.state.location.pathname).toBe(`/w/ws-1/tasks/${b.id}`);
    expect(await screen.findByText("2 of 2 need you")).toBeTruthy();
  });

  it("goes back with Esc, except in a text field", async () => {
    installBridge({ task: () => AW8_TASK, tasks: () => [AW8_TASK], thread: () => AW8 });
    const { router } = renderApp(
      <DialogsProvider ws="ws-1">
        <TaskPage />
      </DialogsProvider>,
      { route: "/w/:ws/tasks/:task", url: `/w/ws-1/tasks/${AW8_TASK.id}` },
    );
    const box = await screen.findByRole("textbox", { name: "Message to claude@macbook-pro" });
    box.focus();
    await userEvent.keyboard("{Escape}");
    expect(router.state.location.pathname).toBe(`/w/ws-1/tasks/${AW8_TASK.id}`);
    screen.getByRole("button", { name: "Back" }).focus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/w/ws-1/inbox"));
  });

  it("opens another task on its Activity tab, with Back", async () => {
    const other = makeTask({ id: "0193a000-0000-7000-8000-0000000000bb", key: "AW-9" });
    installBridge({
      task: (args: { task: string }) => (args.task === other.id ? other : AW8_TASK),
      tasks: () => [AW8_TASK, other],
      thread: () => AW8,
    });
    const { router } = renderApp(
      <DialogsProvider ws="ws-1">
        <TaskPage />
      </DialogsProvider>,
      { route: "/w/:ws/tasks/:task", url: `/w/ws-1/tasks/${AW8_TASK.id}` },
    );
    expect(await screen.findByRole("button", { name: "Back" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close the task" })).toBeNull();
    await userEvent.click(await screen.findByRole("tab", { name: "Files" }));
    await router.navigate(`/w/ws-1/tasks/${other.id}`);
    expect(await screen.findByText("AW-9")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Activity", selected: true })).toBeTruthy();
  });
});

describe("session options (session-options)", () => {
  it("shows the red chip, the rows and opens the folder of a session of this device", async () => {
    stubWidth(1200);
    const task: Task = {
      ...AW8_TASK,
      session: {
        session: "01a20400-0000-7001-8000-0000000000a1",
        device: "macbook-pro",
        host: "tmux",
        state: "running",
        reason: null,
        cwd: "/Users/example/.aw/worktrees/aw-AW-8",
        branch: "aw/AW-8",
        permission_mode: "skip",
        agent_teams: true,
        work_in: "worktree",
      },
    };
    const call = installBridge({
      task: () => task,
      tasks: () => [task],
      thread: () => AW8,
      openSessionFolder: () => ({ opened: true, path: "/Users/example/.aw/worktrees/aw-AW-8" }),
    });
    renderApp(
      <DialogsProvider ws="ws-1">
        <TaskDetail ws="ws-1" taskId={task.id} />
      </DialogsProvider>,
    );
    expect(await screen.findByText("Skips permissions")).toBeTruthy();
    expect(screen.getAllByText("Agent teams").length).toBe(2);
    const properties = screen.getByRole("region", { name: "Properties" });
    expect(within(properties).getByText("Skip permissions")).toBeTruthy();
    expect(within(properties).getByText("On · experimental")).toBeTruthy();
    expect(
      within(properties).getByText("/Users/example/.aw/worktrees/aw-AW-8 · branch aw/AW-8"),
    ).toBeTruthy();
    await userEvent.click(within(properties).getByRole("button", { name: "Open" }));
    await waitFor(() =>
      expect(call.mock.calls.find(([m]) => m === "openSessionFolder")?.[1]).toEqual({
        ws: "ws-1",
        task: task.id,
      }),
    );
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await userEvent.click(within(properties).getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("/Users/example/.aw/worktrees/aw-AW-8");
    expect(await within(properties).findByRole("button", { name: "Copied" })).toBeTruthy();
  });
});

// ---- openspec proposal-and-discussion ----

interface FixtureRow {
  id: string;
  type: string;
  dev: string;
  by: string;
  hlc: string;
  data: Record<string, unknown>;
}
const ACTIVITY = JSON.parse(casesJson) as { threads: { name: string; rows: FixtureRow[] }[] };

/** The rows of a thread of contracts/fixtures/activity/cases.json, as a thread reply. */
function fixtureThread(name: string): ThreadReply {
  const rows = ACTIVITY.threads.find((t) => t.name.startsWith(name))!.rows;
  return {
    task: { id: AW8_TASK.id, key: "AW-12", title: "Rate limits" },
    events: rows.map((r) => ({
      id: r.id,
      task: AW8_TASK.id,
      hlc: r.hlc,
      dev: r.dev,
      type: r.type,
      path: `tasks/${AW8_TASK.id}/log/${r.dev}.jsonl`,
      line: 1,
      applied: true,
      reason: null,
      event: { v: 1, id: r.id, hlc: r.hlc, dev: r.dev, type: r.type, by: r.by, data: r.data },
    })),
    next: null,
    prev: null,
    ancestors: [],
  };
}

function openGate(reply: ThreadReply, at: number): Gate {
  const opened = reply.events[at]!;
  const d = opened.event.data;
  return makeGate({
    gate: String(d.gate),
    kind: String(d.kind),
    title: String(d.title),
    options: d.options as string[],
    file: typeof d.file === "string" ? d.file : null,
    opened: { event: opened.id, dev: opened.dev, hlc: opened.hlc },
  });
}

const RUNNING = {
  session: "01a2038e-8100-7000-8000-000000000001",
  device: "ubuntu-01",
  host: "tmux",
  state: "running",
  reason: null,
};

describe("Activity of a Discuss stage (proposal-and-discussion)", () => {
  it("scrolls to the row that needs the person from the header chip, also from another tab", async () => {
    const reply = fixtureThread("an open proposal waits");
    const gate = openGate(reply, 1);
    const task = makeTask({
      ...AW8_TASK,
      gates: [gate],
      needs_you: [gate.gate],
      needs_you_lane: true,
      needs_you_reasons: [{ reason: "gate", kind: "approve_proposal" }],
    });
    const scrolled: Element[] = [];
    const scroll = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    Element.prototype.scrollIntoView = scroll;
    try {
      show(task, reply);
      const card = await screen.findByRole("article", { name: "Proposal v3" });
      const chip = screen.getByRole("button", { name: "Needs you: approve proposal" });
      await userEvent.click(chip);
      await waitFor(() => expect(scrolled).toEqual([card]));
      await userEvent.click(screen.getByRole("tab", { name: "Session" }));
      await userEvent.click(screen.getByRole("button", { name: "Needs you: approve proposal" }));
      expect(screen.getByRole("tab", { name: "Activity", selected: true })).toBeTruthy();
      await waitFor(() => expect(scrolled).toHaveLength(2));
      expect(scrolled[1]).toBe(screen.getByRole("article", { name: "Proposal v3" }));
    } finally {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });

  it("closes the full screen view with Discuss and puts the cursor in the message box", async () => {
    const reply = fixtureThread("an open proposal waits");
    const task = makeTask({ ...AW8_TASK, gates: [openGate(reply, 1)], session: RUNNING });
    show(task, reply);
    const card = await screen.findByRole("article", { name: "Proposal v3" });
    await userEvent.click(
      within(card).getByRole("button", { name: "Open the proposal in full screen" }),
    );
    const view = await screen.findByRole("dialog", { name: "Proposal v3" });
    await userEvent.click(within(view).getByRole("button", { name: "Discuss" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "Message to claude@macbook-pro" }),
      ),
    );
  });

  it("sends the message box as the answer of an open question, also with no running session", async () => {
    const reply = fixtureThread("question, answer");
    const short = { ...reply, events: reply.events.slice(0, 2) };
    const gate = openGate(short, 1);
    const task = makeTask({ ...AW8_TASK, gates: [gate] });
    const call = installBridge({
      task: () => task,
      tasks: () => [task],
      thread: () => short,
      answerGate: () => ({ applied: true }),
      sendMessage: () => ({ applied: true }),
    });
    renderApp(
      <DialogsProvider ws="ws-1">
        <TaskDetail ws="ws-1" taskId={task.id} />
      </DialogsProvider>,
    );
    const box = await screen.findByRole("textbox", { name: "Message to claude@macbook-pro" });
    expect(
      screen.getByText(/your message answers the question “Where do the counters live\?”/),
    ).toBeTruthy();
    await userEvent.type(box, "Redis, with a TTL");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(call.mock.calls.filter(([m]) => m === "answerGate").map(([, a]) => a)).toEqual([
        {
          ws: "ws-1",
          gate: gate.gate,
          body: { answer: "Redis, with a TTL", comment: null, version: 1 },
        },
      ]),
    );
    expect(call.mock.calls.some(([m]) => m === "sendMessage")).toBe(false);
  });

  it("sends a message to the session while a proposal waits, and the card keeps Approve proposal", async () => {
    const reply = fixtureThread("an open proposal waits");
    const task = makeTask({ ...AW8_TASK, gates: [openGate(reply, 1)], session: RUNNING });
    const call = installBridge({
      task: () => task,
      tasks: () => [task],
      thread: () => reply,
      answerGate: () => ({ applied: true }),
      sendMessage: () => ({ applied: true }),
    });
    renderApp(
      <DialogsProvider ws="ws-1">
        <TaskDetail ws="ws-1" taskId={task.id} />
      </DialogsProvider>,
    );
    const box = await screen.findByRole("textbox", { name: "Message to claude@macbook-pro" });
    expect(box.getAttribute("placeholder")).toBe("Discuss the proposal, or ask the agent…");
    await userEvent.type(box, "Also send Retry-After");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(call.mock.calls.filter(([m]) => m === "sendMessage").map(([, a]) => a)).toEqual([
        { ws: "ws-1", task: task.id, text: "Also send Retry-After" },
      ]),
    );
    expect(call.mock.calls.some(([m]) => m === "answerGate")).toBe(false);
    const card = screen.getByRole("article", { name: "Proposal v3" });
    expect(within(card).getByRole("button", { name: "Approve proposal" })).toBeTruthy();
  });

  it("keeps the Assign card at the top of Activity, above the description and the rows", async () => {
    const reply = fixtureThread("question, answer");
    const task = makeTask({
      ...AW8_TASK,
      assignee: null,
      needs_you_lane: true,
      needs_you_reasons: [{ reason: "assign" }],
    });
    show(task, reply);
    const activity = await screen.findByRole("region", { name: "Activity" });
    const assign = screen.getByText("Assign task");
    const description = screen.getByRole("region", { name: "Description" });
    expect(
      assign.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      assign.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(activity).queryByText("Assign task")).toBeNull();
  });

  it("keeps an open Assign gate at the top of Activity", async () => {
    const task = makeTask({
      ...AW8_TASK,
      assignee: null,
      gates: [makeGate({ kind: "assign", title: "Assign task", options: [] })],
      needs_you_lane: true,
      needs_you_reasons: [{ reason: "gate", kind: "assign" }],
    });
    show(task, fixtureThread("question, answer"));
    const activity = await screen.findByRole("region", { name: "Activity" });
    const assign = screen.getByText("Assign task");
    expect(
      assign.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByText("Assign task")).toHaveLength(1);
  });

  it("lists the proposal versions in Properties, with the file of an old version", async () => {
    stubWidth(700);
    const reply: ThreadReply = {
      ...fixtureThread("an open proposal waits"),
      events: [
        {
          ...fixtureThread("an open proposal waits").events[0]!,
          id: "old",
          event: {
            ...fixtureThread("an open proposal waits").events[0]!.event,
            id: "old",
            data: { version: 2, file: "approach/v2.md" },
          },
        },
        ...fixtureThread("an open proposal waits").events,
      ],
    };
    const task = makeTask({ ...AW8_TASK, proposal: { latest: 3, approved: 2 } });
    const call = installBridge({
      task: () => task,
      tasks: () => [task],
      thread: () => reply,
      taskFile: (args: { path: string }) => ({
        path: args.path,
        size: 10,
        modified: "2026-11-26T10:00:00.000Z",
        text: "OLD-VERSION-TEXT",
        reason: null,
      }),
    });
    renderApp(
      <DialogsProvider ws="ws-1">
        <TaskDetail ws="ws-1" taskId={task.id} />
      </DialogsProvider>,
    );
    await userEvent.click(await screen.findByRole("tab", { name: "Properties" }));
    const properties = screen.getByRole("region", { name: "Properties" });
    expect(within(properties).getByText("Proposal")).toBeTruthy();
    expect(within(properties).getByText("Approved")).toBeTruthy();
    expect(within(properties).getByText("Waits for you")).toBeTruthy();
    await userEvent.click(within(properties).getByRole("button", { name: "v2" }));
    expect(await within(properties).findByText("OLD-VERSION-TEXT")).toBeTruthy();
    expect(call.mock.calls.filter(([m]) => m === "taskFile").map(([, a]) => a)).toContainEqual({
      ws: "ws-1",
      task: task.id,
      path: `tasks/${task.id}/approach/v2.md`,
    });
  });
});
