// The queue of a waiting task on the desktop (openspec queue-and-assign): the List group Queued,
// the chip "Queued · 2nd for claude@ubuntu-01" with the cause on the List, the Board and the task
// detail, from the queues route.
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { QueuesReply } from "../../../shared/channels.ts";
import { queueIndex, queueLine } from "../queue-model.ts";
import { installBridge, makeTask, renderApp } from "../testing.tsx";
import { DialogsProvider } from "./dialogs.tsx";
import { TaskDetail } from "./TaskDetail.tsx";
import { ProjectTasks } from "./TaskViews.tsx";

afterEach(cleanup);

const working = makeTask({
  id: "t1",
  key: "AW-1",
  title: "Rate limit",
  stage: "implement",
  assignee: "claude@ubuntu-01",
});
const queued = makeTask({
  id: "t4",
  key: "AW-4",
  title: "Write the docs",
  stage: "backlog",
  assignee: "claude@ubuntu-01",
});
const parked = makeTask({ id: "t9", key: "AW-9", title: "Parked idea", stage: "backlog" });
const queues: QueuesReply = {
  device: "macbook-pro",
  agents: [
    {
      agent: "claude@ubuntu-01",
      device: "ubuntu-01",
      max_working: 2,
      working: 2,
      tasks: [
        {
          task: "t4",
          key: "AW-4",
          title: "Write the docs",
          position: 2,
          text: "Queued · 2nd for claude@ubuntu-01",
          cause: { code: "max_working", text: "2 sessions working" },
        },
      ],
    },
  ],
  unassigned: [],
};
const handlers = {
  tasks: () => [working, queued, parked],
  task: () => queued,
  queues: () => queues,
};

describe("queue on the desktop", () => {
  it("indexes the queues route by task and joins the label and the cause", () => {
    const index = queueIndex(queues);
    expect(index.get("t4")).toEqual({
      agent: "claude@ubuntu-01",
      position: 2,
      label: "Queued · 2nd for claude@ubuntu-01",
      cause: "2 sessions working",
    });
    expect(queueLine(index.get("t4")!)).toBe(
      "Queued · 2nd for claude@ubuntu-01 · 2 sessions working",
    );
    expect(queueIndex(undefined).size).toBe(0);
  });

  it("puts the task in the Queued group of the List with its position and cause", async () => {
    installBridge(handlers);
    renderApp(<ProjectTasks view="list" />, {
      route: "/w/:ws/p/:project/list",
      url: "/w/ws-1/p/billing-api/list",
    });
    const group = await screen.findByRole("list", { name: "Queued" });
    expect(within(group).getByText("Write the docs")).toBeTruthy();
    expect(within(group).getByText("Queued · 2nd for claude@ubuntu-01")).toBeTruthy();
    expect(within(group).getByText("2 sessions working")).toBeTruthy();
    const lists = screen.getAllByRole("list").map((l) => l.getAttribute("aria-label"));
    expect(lists).toEqual(["Running", "Queued", "Backlog"]);
  });

  it("shows the chip on the Board card in its stage column", async () => {
    installBridge(handlers);
    renderApp(<ProjectTasks view="board" />, {
      route: "/w/:ws/p/:project/board",
      url: "/w/ws-1/p/billing-api/board",
    });
    const backlog = await screen.findByRole("region", { name: "Backlog" });
    expect(await within(backlog).findByText("Queued · 2nd for claude@ubuntu-01")).toBeTruthy();
    expect(within(backlog).queryAllByText(/^Queued/)).toHaveLength(1);
  });

  it("shows the queue in the task detail", async () => {
    installBridge(handlers);
    renderApp(
      <DialogsProvider ws="ws-1">
        <TaskDetail ws="ws-1" taskId="t4" />
      </DialogsProvider>,
    );
    expect(await screen.findByText("Queued · 2nd for claude@ubuntu-01")).toBeTruthy();
  });

  it("shows the field Queue of a task with open dependencies in the details", async () => {
    const waiting: QueuesReply = {
      ...queues,
      agents: [
        {
          ...queues.agents[0]!,
          tasks: [
            {
              task: "t4",
              key: "AW-4",
              title: "Write the docs",
              position: null,
              text: "Queued for claude@ubuntu-01",
              cause: { code: "dependencies", text: "waits for AW-3" },
            },
          ],
        },
      ],
    };
    installBridge({ ...handlers, queues: () => waiting });
    renderApp(
      <DialogsProvider ws="ws-1">
        <TaskDetail ws="ws-1" taskId="t4" />
      </DialogsProvider>,
    );
    await userEvent.click(await screen.findByRole("tab", { name: "Properties" }));
    expect(await screen.findByText("Queued for claude@ubuntu-01 · waits for AW-3")).toBeTruthy();
  });
});
