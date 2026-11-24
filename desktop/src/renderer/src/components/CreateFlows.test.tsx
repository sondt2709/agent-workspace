// The create flows around a project (openspec create-flows, review 5.3): New task with no project,
// "Start the agent now", the credential chips, New session on a task page, the top bar with no
// workspace, the empty states and the folder picker of Project settings.
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { BindingsView } from "../../../shared/channels.ts";
import { installBridge, makeTask, PROJECT, renderApp } from "../testing.tsx";
import { AppShell } from "./AppShell.tsx";
import { DialogsProvider, NewSessionDialog, NewTaskDialog, useDialogs } from "./dialogs.tsx";
import { Inbox } from "./Inbox.tsx";
import { ProjectSettingsPage } from "./ProjectSettings.tsx";
import { ProjectTasks } from "./TaskViews.tsx";

afterEach(cleanup);

const REPO = "/Users/example/dev/example-org/billing-api";
const BINDINGS: BindingsView = {
  device: "macbook-pro",
  may_run: true,
  use_orca: false,
  checkouts: [{ project: "billing-api", path: REPO }],
  resources: {},
};

function argsOf(call: ReturnType<typeof installBridge>, method: string) {
  return call.mock.calls.filter(([m]) => m === method).map(([, args]) => args);
}

function OpenNewTask() {
  const dialogs = useDialogs();
  return <button onClick={() => dialogs.newTask(null)}>new task</button>;
}

describe("New task (review F-5)", () => {
  it("asks for a project first in a workspace with no open project", async () => {
    installBridge({ projects: () => [{ ...PROJECT, archived: true }] });
    renderApp(<NewTaskDialog ws="ws-1" project={null} onClose={() => undefined} />);
    expect(await screen.findByRole("dialog", { name: "Add a project first" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a project" })).toBeTruthy();
    expect(screen.queryByLabelText("First message")).toBeNull();
  });

  it("opens Add a project, then New task with the new project", async () => {
    let projects: (typeof PROJECT)[] = [];
    installBridge({
      projects: () => projects,
      workspaces: () => [{ id: "ws-1", name: "Personal", path: "/Users/example/AW/Personal" }],
      bindings: () => ({ ...BINDINGS, checkouts: [] }),
      chooseFolder: () => ({ path: REPO, name: "billing-api", git: true }),
      addProject: () => {
        projects = [{ ...PROJECT, slug: "billing-api", name: "billing-api" }];
        return projects[0];
      },
      editBindings: () => BINDINGS,
    });
    renderApp(
      <DialogsProvider ws="ws-1">
        <OpenNewTask />
      </DialogsProvider>,
      { url: "/w/ws-1/inbox" },
    );
    await userEvent.click(screen.getByRole("button", { name: "new task" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add a project" }));
    await userEvent.click(await screen.findByRole("button", { name: "Choose…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add project" }));
    const dialog = await screen.findByRole("dialog", { name: /^New task/ });
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Project").textContent).toContain("billing-api"),
    );
  });

  it("assigns the default agent on the first device with Start the agent now", async () => {
    const call = installBridge({
      createTask: () => ({ applied: true, task: makeTask({ id: "new-id" }) }),
      bindings: () => BINDINGS,
    });
    renderApp(<NewTaskDialog ws="ws-1" project="billing-api" onClose={() => undefined} />);
    await userEvent.type(screen.getByLabelText("First message"), "Add a CSV export");
    const start = await screen.findByRole("checkbox", { name: "Start the agent now" });
    expect((start as HTMLInputElement).checked).toBe(false);
    await userEvent.click(start);
    expect(screen.getByLabelText("Assignee").textContent).toBe("claude@macbook-pro");
    expect(
      await screen.findByText(
        `Assigns claude@macbook-pro. Works in a git worktree aw-<key> of ${REPO} on the branch aw/<key>.`,
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(argsOf(call, "createTask")[0]).toMatchObject({
        body: { assignee: "claude@macbook-pro" },
      }),
    );
  });

  it("keeps None as the default and shows it in the empty selects (dsc-11)", async () => {
    installBridge({});
    renderApp(<NewTaskDialog ws="ws-1" project="billing-api" onClose={() => undefined} />);
    await screen.findByRole("checkbox", { name: "Start the agent now" });
    expect(screen.getByLabelText("Assignee").textContent).toBe("None · Needs you: assign");
    expect(screen.getByLabelText("Test server").textContent).toBe("None");
    expect(screen.getByLabelText("Parent task").textContent).toBe("None");
  });

  it("sends the credentials picked as chips from the credential list", async () => {
    const call = installBridge({
      credentials: () => [
        { name: "staging-db", added_by: null, imported_on: [], file: false },
        { name: "github-token", added_by: null, imported_on: [], file: false },
      ],
      createTask: () => ({ applied: true, task: makeTask({ id: "new-id" }) }),
    });
    renderApp(<NewTaskDialog ws="ws-1" project="billing-api" onClose={() => undefined} />);
    await userEvent.type(screen.getByLabelText("First message"), "Add a CSV export");
    await userEvent.click(screen.getByLabelText("Credentials"));
    await userEvent.click(await screen.findByRole("option", { name: "staging-db" }));
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(argsOf(call, "createTask")[0]).toMatchObject({
        body: { credentials: ["staging-db"] },
      }),
    );
  });
});

describe("New session (review F-22)", () => {
  it("starts with the task of the page, shows the folder, and links to the Orca switch", async () => {
    const task = makeTask({
      id: "t1",
      key: "AW-1",
      title: "Export",
      assignee: "claude@macbook-pro",
    });
    const { router } = renderWith(task);
    await waitFor(() => expect(screen.getByLabelText("Task").textContent).toBe("AW-1 · Export"));
    expect(
      await screen.findByText(`Works in a git worktree aw-AW-1 of ${REPO} on the branch aw/AW-1.`),
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Turn on Orca in the project settings" }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/w/ws-1/p/billing-api/settings"),
    );
  });

  function renderWith(task: ReturnType<typeof makeTask>) {
    installBridge({
      tasks: () => [task],
      bindings: () => BINDINGS,
      sessionHosts: () => ({
        device: "macbook-pro",
        devices: [
          {
            device: "macbook-pro",
            may_run: true,
            use_orca: false,
            checkouts: [{ project: "billing-api", session_host: null }],
            orca: { available: true, version: "1.4.0", reason: null },
          },
        ],
      }),
    });
    return renderApp(<NewSessionDialog ws="ws-1" task={task.id} onClose={() => undefined} />, {
      url: "/w/ws-1/tasks/t1",
    });
  }
});

describe("Top bar with no workspace (review F-32)", () => {
  it("shows no Sync, New session or New task before the first workspace", async () => {
    installBridge({ workspaces: () => [] });
    renderApp(<AppShell />, { route: "/*", url: "/" });
    await waitFor(() => expect(screen.getAllByRole("navigation").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Sync/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "New session" })).toBeNull();
  });

  it("passes the task of the page to New session", async () => {
    const task = makeTask({ id: "t1", key: "AW-1", title: "Export" });
    installBridge({
      workspaces: () => [{ id: "ws-1", name: "Personal", path: "/Users/example/AW/Personal" }],
      tasks: () => [task],
    });
    renderApp(<AppShell />, { route: "/w/:ws/tasks/:task", url: "/w/ws-1/tasks/t1" });
    await userEvent.click(await screen.findByRole("button", { name: "New session" }));
    const dialog = await screen.findByRole("dialog", { name: "New session" });
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Task").textContent).toBe("AW-1 · Export"),
    );
  });
});

describe("Empty states (review F-33)", () => {
  it("Inbox: no project gives Add a project; a project with no task gives New task", async () => {
    installBridge({ projects: () => [], tasks: () => [] });
    renderApp(<Inbox />, { route: "/w/:ws/inbox", url: "/w/ws-1/inbox" });
    expect(await screen.findByText("No projects yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a project" })).toBeTruthy();
    cleanup();
    installBridge({ tasks: () => [] });
    renderApp(<Inbox />, { route: "/w/:ws/inbox", url: "/w/ws-1/inbox" });
    expect(await screen.findByText("No tasks yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New task" })).toBeTruthy();
    expect(screen.queryByText("Nothing needs you")).toBeNull();
  });

  it("Board: a project with no task gives New task; an empty column says No tasks", async () => {
    installBridge({ tasks: () => [] });
    renderApp(<ProjectTasks view="board" />, {
      route: "/w/:ws/p/:project/board",
      url: "/w/ws-1/p/billing-api/board",
    });
    expect(await screen.findByText("No tasks yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New task" })).toBeTruthy();
    cleanup();
    installBridge({ tasks: () => [makeTask({ stage: "discuss" })] });
    renderApp(<ProjectTasks view="board" />, {
      route: "/w/:ws/p/:project/board",
      url: "/w/ws-1/p/billing-api/board",
    });
    const backlog = await screen.findByRole("region", { name: "Backlog" });
    expect(within(backlog).getByText("No tasks")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Discuss" })).queryByText("No tasks"),
    ).toBeNull();
  });
});

describe("Project settings folder picker (review F-30)", () => {
  it("fills the checkout folder from the picker and saves it", async () => {
    const call = installBridge({
      bindings: () => ({ ...BINDINGS, checkouts: [] }),
      devices: () => [],
      chooseFolder: () => ({ path: REPO, name: "billing-api", git: true }),
      editBindings: () => BINDINGS,
    });
    renderApp(<ProjectSettingsPage />, {
      route: "/w/:ws/p/:project/settings",
      url: "/w/ws-1/p/billing-api/settings",
    });
    await userEvent.click(await screen.findByRole("button", { name: "Choose…" }));
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("Checkout folder").value).toBe(REPO),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save checkout" }));
    await waitFor(() =>
      expect(argsOf(call, "editBindings")[0]).toEqual({
        ws: "ws-1",
        body: { checkouts: [{ project: "billing-api", path: REPO, session_host: null }] },
      }),
    );
  });

  it("shows the checkout folder of the new project after a move to its settings (fc1-d2)", async () => {
    installBridge({
      projects: () => [PROJECT, { ...PROJECT, slug: "web", name: "Web" }],
      bindings: () => BINDINGS,
      devices: () => [],
    });
    const { router } = renderApp(<ProjectSettingsPage />, {
      route: "/w/:ws/p/:project/settings",
      url: "/w/ws-1/p/billing-api/settings",
    });
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("Checkout folder").value).toBe(REPO),
    );
    await act(() => router.navigate("/w/ws-1/p/web/settings"));
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("Checkout folder").value).toBe(""),
    );
    expect(screen.queryByRole("button", { name: "Remove checkout" })).toBeNull();
  });
});
