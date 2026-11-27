import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { installBridge, makeTask, renderApp, stubWindowWidth } from "../testing.tsx";
import { Board, TaskList, TaskScreen } from "./TaskViews.tsx";

let restore: (() => void) | null = null;
afterEach(() => {
  cleanup();
  restore?.();
  restore = null;
});

const tasks = [
  makeTask({
    id: "a",
    key: "AW-1",
    title: "Answer me",
    stage: "discuss",
    needs_you_lane: true,
    needs_you_reasons: [{ reason: "gate", kind: "question" }],
  }),
  makeTask({
    id: "b",
    key: "AW-2",
    title: "Laptop task",
    stage: "implement",
    paused: {
      cause: "device_offline",
      since: "x",
      resumes_at: null,
      next_step: "Wait",
      needs_human: false,
    },
  }),
  makeTask({ id: "c", key: "AW-3", title: "Shipped", stage: "done" }),
];

describe("Board", () => {
  it("shows the 6 stage columns, and Needs you as a row in the column of the stage", () => {
    installBridge();
    renderApp(<Board tasks={tasks} selected={null} onOpen={() => undefined} />);
    const columns = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(columns).toEqual(["Backlog", "Discuss", "Ready", "Implement", "Review", "Done"]);
    expect(screen.getByText("Needs you · 1")).toBeTruthy();
    expect(screen.getByText("Everything else · 2")).toBeTruthy();
    // The task keeps its stage: its card is in the Needs you row of Discuss.
    const discuss = screen.getByRole("region", { name: "Discuss" });
    const lane = within(discuss).getByLabelText("Discuss · Needs you");
    expect(within(lane).getByText("Answer me")).toBeTruthy();
    expect(within(lane).getByText("Reply to a question")).toBeTruthy();
    expect(within(discuss).getByText("1")).toBeTruthy();
    expect(within(discuss).getByText(/writes a proposal/)).toBeTruthy();
    const implement = screen.getByRole("region", { name: "Implement" });
    expect(within(implement).getByText("Paused · device offline")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Review" })).getByText("No tasks"),
    ).toBeTruthy();
  });

  it("has no Needs you row when no task needs the person", () => {
    installBridge();
    renderApp(<Board tasks={tasks.slice(1)} selected={null} onOpen={() => undefined} />);
    expect(screen.queryByText(/^Needs you ·/)).toBeNull();
    expect(screen.queryByText(/^Everything else ·/)).toBeNull();
  });

  it("shows the age and the assignee on a quiet card, and no stage chip", () => {
    installBridge();
    renderApp(
      <Board
        tasks={[
          makeTask({ title: "Quiet", stage: "review", last_hlc: "2026-11-23T09:55:00.000Z#0001" }),
        ]}
        selected={null}
        onOpen={() => undefined}
      />,
    );
    const card = screen.getByRole("button", { name: "AW-3 Quiet" });
    expect(within(card).getByText("5 min ago")).toBeTruthy();
    expect(within(card).getByText("claude@ubuntu-01")).toBeTruthy();
    expect(within(card).queryByText("Review")).toBeNull();
  });
});

describe("TaskList", () => {
  it("groups the tasks in one-line rows", () => {
    installBridge();
    renderApp(<TaskList ws="acme" tasks={tasks} selected={null} onOpen={() => undefined} />);
    const lists = screen.getAllByRole("list").map((l) => l.getAttribute("aria-label"));
    expect(lists).toEqual(["Needs you", "Paused", "Done"]);
    const row = screen.getByRole("button", { name: "AW-2 Laptop task" });
    expect(within(row).getByText("Paused · device offline")).toBeTruthy();
    expect(within(row).getByText("claude@ubuntu-01")).toBeTruthy();
  });

  it("shows the archived tasks in a closed group Archived, with Unarchive on each row", async () => {
    const unarchive = (a: { ws: string; task: string }) => ({ ...a, applied: true });
    const call = installBridge({ unarchiveTask: unarchive });
    const archived = makeTask({ id: "z", key: "AW-9", title: "Old work", archived: true });
    renderApp(
      <TaskList ws="acme" tasks={[...tasks, archived]} selected={null} onOpen={() => undefined} />,
    );
    const header = screen.getByRole("button", { name: "Archived · 1" });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Old work")).toBeNull();
    await userEvent.click(header);
    expect(screen.getByText("Old work")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Unarchive AW-9" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("unarchiveTask", { ws: "acme", task: "z" }),
    );
  });

  it("collapses a group with its header", async () => {
    installBridge();
    renderApp(<TaskList ws="acme" tasks={tasks} selected={null} onOpen={() => undefined} />);
    const header = screen.getByRole("button", { name: "Done · 1" });
    await userEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Shipped")).toBeNull();
    await userEvent.click(header);
    expect(screen.getByText("Shipped")).toBeTruthy();
  });

  it("moves the focus with Up and Down, and Enter opens the task page", async () => {
    restore = stubWindowWidth(1280);
    installBridge({
      tasks: () => tasks,
      task: (a: { task: string }) => tasks.find((t) => t.id === a.task),
    });
    const { router } = renderApp(<TaskScreen view="list" projects={["billing-api"]} />, {
      route: "/w/:ws/p/:project/list",
      url: "/w/ws-1/p/billing-api/list",
    });
    const first = await screen.findByRole("button", { name: "AW-1 Answer me" });
    first.focus();
    await userEvent.keyboard("{ArrowDown}");
    const second = screen.getByRole("button", { name: "AW-2 Laptop task" });
    expect(document.activeElement).toBe(second);
    await userEvent.keyboard("{Enter}");
    // A task opens as the task page at each width: no split (openspec task-review-layout).
    expect(router.state.location.pathname).toBe("/w/ws-1/tasks/b");
  });

  it("opens the task page for an old link with ?task=", async () => {
    restore = stubWindowWidth(1440);
    installBridge({ tasks: () => tasks });
    const { router } = renderApp(<TaskScreen view="board" projects={["billing-api"]} />, {
      route: "/w/:ws/p/:project/board",
      url: "/w/ws-1/p/billing-api/board?task=a",
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/w/ws-1/tasks/a"));
  });
});
