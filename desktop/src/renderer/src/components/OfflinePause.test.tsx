// The pause of an offline device from the presence (openspec move-paused-task): the task of
// macbook-pro has no pause event (the offline device cannot write one), and the presence lists it.
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { DeviceEntryView, PresenceReply } from "../../../shared/channels.ts";
import { installBridge, makeTask, renderApp } from "../testing.tsx";
import { DialogsProvider } from "./dialogs.tsx";
import { Inbox } from "./Inbox.tsx";
import { TaskDetail } from "./TaskDetail.tsx";
import { ProjectTasks } from "./TaskViews.tsx";

afterEach(cleanup);

const task = makeTask({
  id: "t21",
  key: "AW-21",
  title: "Add rate limit",
  stage: "implement",
  assignee: "claude@macbook-pro",
  owner: "macbook-pro",
});
const other = makeTask({ id: "t22", key: "AW-22", title: "Fix rounding", stage: "implement" });
const presence: PresenceReply = {
  now: "2026-11-23T23:05:00.000Z",
  devices: [],
  offline_tasks: [
    { task: "t21", device: "macbook-pro", cause: "device_offline", since: "2026-11-23T23:01:30Z" },
  ],
};
const device = (slug: string, name: string): DeviceEntryView => ({
  slug,
  name,
  role: "local",
  state: "valid",
  sync_device_id: "X",
  seq: 1,
  paired_at: "2026-11-23T10:00:00.000Z",
  revoked_at: null,
  this_device: slug === "ubuntu-01",
});
const handlers = {
  tasks: () => [task, other],
  task: () => task,
  presence: () => presence,
  devices: () => [device("macbook-pro", "MacBook Pro"), device("ubuntu-01", "ubuntu-01")],
};

describe("pause of an offline device", () => {
  it("puts the task in the Paused group of the List with the device name", async () => {
    installBridge(handlers);
    renderApp(<ProjectTasks view="list" />, {
      route: "/w/:ws/p/:project/list",
      url: "/w/ws-1/p/billing-api/list",
    });
    const paused = await screen.findByRole("list", { name: "Paused" });
    expect(await within(paused).findByText("Paused · MacBook Pro offline")).toBeTruthy();
    expect(within(paused).getByText("Add rate limit")).toBeTruthy();
    expect(
      within(screen.getByRole("list", { name: "Running" })).getByText("Fix rounding"),
    ).toBeTruthy();
  });

  it("shows the pause and Assign to another device… on the task detail", async () => {
    installBridge(handlers);
    renderApp(
      <DialogsProvider ws="ws-1">
        <TaskDetail ws="ws-1" taskId="t21" />
      </DialogsProvider>,
    );
    expect(await screen.findByText("Paused · MacBook Pro offline.")).toBeTruthy();
    expect(
      screen.getByText(
        "It continues when MacBook Pro is back. Assign it to another device to continue now.",
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Assign to another device…" }));
    expect(await screen.findByText(/^Paused: MacBook Pro offline\./)).toBeTruthy();
  });
});

describe("pause of a revoked device (openspec revoke-device)", () => {
  const revoked: PresenceReply = {
    ...presence,
    offline_tasks: [
      { task: "t21", device: "ubuntu-01", cause: "device_revoked", since: "2026-11-23T22:00:00Z" },
    ],
  };
  const onUbuntu = { ...task, assignee: "claude@ubuntu-01", owner: "ubuntu-01" };
  const revokedHandlers = {
    ...handlers,
    tasks: () => [onUbuntu, other],
    task: () => onUbuntu,
    presence: () => revoked,
    devices: () => [device("macbook-pro", "MacBook Pro"), device("ubuntu-01", "ubuntu-01")],
  };

  it("puts the task in the Needs you group of the List", async () => {
    installBridge(revokedHandlers);
    renderApp(<ProjectTasks view="list" />, {
      route: "/w/:ws/p/:project/list",
      url: "/w/ws-1/p/billing-api/list",
    });
    const needsYou = await screen.findByRole("list", { name: "Needs you" });
    expect(await within(needsYou).findByText("Paused · ubuntu-01 was revoked")).toBeTruthy();
    expect(within(needsYou).getByText("Add rate limit")).toBeTruthy();
  });

  it("shows the Inbox card with Change assignee…, which opens the Assign dialog", async () => {
    installBridge(revokedHandlers);
    renderApp(
      <DialogsProvider ws="ws-1">
        <Inbox />
      </DialogsProvider>,
      { route: "/w/:ws/inbox", url: "/w/ws-1/inbox" },
    );
    // The Inbox is a list and a detail: the row opens the detail with the card.
    await userEvent.click(await screen.findByRole("button", { name: /AW-21/ }));
    const card = await screen.findByRole("region", { name: "AW-21 needs you" });
    expect(within(card).getByText("Paused · ubuntu-01 was revoked.")).toBeTruthy();
    expect(
      within(card).getByText("Change the assignee to continue on another device."),
    ).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^Needs you\s*1$/ })).toBeTruthy();
    await userEvent.click(within(card).getByRole("button", { name: "Change assignee…" }));
    expect(await screen.findByText(/^Paused: ubuntu-01 was revoked\./)).toBeTruthy();
  });
});
