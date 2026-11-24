import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { installBridge, makeTask, PROJECT, renderApp } from "../testing.tsx";
import {
  createTaskBody,
  DialogsProvider,
  NewSessionDialog,
  NewTaskDialog,
  useDialogs,
} from "./dialogs.tsx";

afterEach(cleanup);

describe("createTaskBody", () => {
  it("makes the title from the first message and leaves out empty fields", () => {
    expect(
      createTaskBody({
        first_message: "/my-team:implement Add a CSV export\nKeep the order.",
        project: "billing-api",
        title: "  ",
        assignee: "",
        test_server: "",
        credentials: [" staging-db", "github-token", "staging-db"],
        parent: "",
      }),
    ).toEqual({
      project: "billing-api",
      title: "/my-team:implement Add a CSV export",
      first_message: "/my-team:implement Add a CSV export\nKeep the order.",
      assignee: null,
      credentials: ["staging-db", "github-token"],
    });
  });
});

describe("NewTaskDialog project (desktop-shell review 11)", () => {
  it("selects the first project when the projects load after the dialog opens", async () => {
    const call = installBridge({
      createTask: () => ({ applied: true, task: makeTask({ id: "new-id" }) }),
    });
    renderApp(<NewTaskDialog ws="ws-1" project={null} onClose={() => undefined} />);
    await userEvent.type(screen.getByLabelText("First message"), "Add a CSV export");
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(call.mock.calls.find(([m]) => m === "createTask")?.[1]).toMatchObject({
        body: { project: "billing-api" },
      }),
    );
  });
});

describe("NewTaskDialog first message (desktop-shell review 10)", () => {
  it("sends the first message as the person wrote it", async () => {
    const call = installBridge({
      createTask: () => ({ applied: true, task: makeTask({ id: "new-id" }) }),
    });
    renderApp(<NewTaskDialog ws="ws-1" project="billing-api" onClose={() => undefined} />);
    await userEvent.type(screen.getByLabelText("First message"), "  Fix the build  ");
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(call.mock.calls.find(([m]) => m === "createTask")?.[1]).toMatchObject({
        body: { first_message: "  Fix the build  ", title: "Fix the build" },
      }),
    );
  });
});

describe("NewTaskDialog", () => {
  it("creates the task with the title from the first message and no assignee", async () => {
    const call = installBridge({
      createTask: () => ({ applied: true, task: makeTask({ id: "new-id" }) }),
    });
    const { router } = renderApp(
      <NewTaskDialog ws="ws-1" project="billing-api" onClose={() => undefined} />,
    );
    await userEvent.type(
      screen.getByLabelText("First message"),
      "/my-team:implement Add a CSV export",
    );
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(call.mock.calls.find(([m]) => m === "createTask")?.[1]).toEqual({
        ws: "ws-1",
        body: {
          project: "billing-api",
          title: "/my-team:implement Add a CSV export",
          first_message: "/my-team:implement Add a CSV export",
          assignee: null,
          // New task preselects Skip permissions (openspec polish-skip-default).
          session_options: {
            permission_mode: "skip",
            agent_teams: false,
            work_in: "worktree",
            folder: null,
          },
        },
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/w/ws-1/tasks/new-id"));
  });

  it("lists no archived project (gap-setup M3)", async () => {
    installBridge({
      projects: () => [
        { ...PROJECT, slug: "old-api", name: "Old API", archived: true },
        { ...PROJECT, slug: "billing-api" },
      ],
    });
    renderApp(<NewTaskDialog ws="ws-1" project="old-api" onClose={() => undefined} />);
    await userEvent.click(await screen.findByRole("combobox", { name: "Project" }));
    expect(await screen.findByRole("option", { name: /billing-api|Billing API/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /old-api|Old API/ })).toBeNull();
  });

  it("refuses a first message shorter than 3 characters", async () => {
    const call = installBridge();
    renderApp(<NewTaskDialog ws="ws-1" project="billing-api" onClose={() => undefined} />);
    await userEvent.type(screen.getByLabelText("First message"), "hi");
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));
    // The error under the field, and the status line of the footer.
    await waitFor(() =>
      expect(screen.getAllByText("Write a first message of 3 or more characters.")).toHaveLength(2),
    );
    expect(call.mock.calls.some(([m]) => m === "createTask")).toBe(false);
  });
});

describe("NewSessionDialog", () => {
  it("writes a human task.assigned for the selected agent", async () => {
    const task = makeTask({ assignee: "claude@ubuntu-01" });
    const call = installBridge({
      tasks: () => [task],
      assignTask: () => ({ applied: true }),
      sessionHosts: () => ({ device: "macbook-pro", devices: [] }),
    });
    renderApp(<NewSessionDialog ws="ws-1" task={task.id} onClose={() => undefined} />);
    const start = await screen.findByRole("button", { name: "Start session" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(start);
    await waitFor(() =>
      expect(call.mock.calls.find(([m]) => m === "assignTask")?.[1]).toEqual({
        ws: "ws-1",
        task: task.id,
        assignee: "claude@ubuntu-01",
        session_host: "tmux",
      }),
    );
  });

  it("sends no session_host when the host list fails, and waits while it loads (fix list 0-11)", async () => {
    const task = makeTask({ assignee: "claude@ubuntu-01" });
    let release: (value: unknown) => void = () => undefined;
    const hosts = new Promise((resolve) => {
      release = resolve;
    });
    const call = installBridge({
      tasks: () => [task],
      assignTask: () => ({ applied: true }),
      sessionHosts: () => hosts,
    });
    renderApp(<NewSessionDialog ws="ws-1" task={task.id} onClose={() => undefined} />);
    const start = await screen.findByRole("button", { name: "Start session" });
    await screen.findByRole("radio", { name: "Orca · checking…" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    release({ device: "macbook-pro", devices: [] });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    cleanup();
    const failed = installBridge({ tasks: () => [task], assignTask: () => ({ applied: true }) });
    renderApp(<NewSessionDialog ws="ws-1" task={task.id} onClose={() => undefined} />);
    const again = await screen.findByRole("button", { name: "Start session" });
    await waitFor(() => expect((again as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(again);
    await waitFor(() =>
      expect(failed.mock.calls.find(([m]) => m === "assignTask")?.[1]).toEqual({
        ws: "ws-1",
        task: task.id,
        assignee: "claude@ubuntu-01",
      }),
    );
    expect(call.mock.calls.some(([m]) => m === "assignTask")).toBe(false);
  });

  it("drops the agent of the task that was selected before (fix list 0-9)", async () => {
    const a = makeTask({ id: "ta", key: "AW-1", title: "Billing", assignee: null });
    const b = makeTask({
      id: "tb",
      key: "AW-2",
      title: "Web",
      project: "web",
      assignee: null,
      owner: null,
    });
    const call = installBridge({
      tasks: () => [a, b],
      projects: () => [
        PROJECT,
        { ...PROJECT, slug: "web", name: "Web", devices: ["mac-mini-lab"] },
      ],
      assignTask: () => ({ applied: true }),
    });
    renderApp(<NewSessionDialog ws="ws-1" task={null} onClose={() => undefined} />);
    await userEvent.click(await screen.findByLabelText("Task"));
    await userEvent.click(await screen.findByRole("option", { name: /AW-1/ }));
    await userEvent.click(screen.getByLabelText("Agent"));
    await userEvent.click(await screen.findByRole("option", { name: "claude@ubuntu-01" }));
    await userEvent.click(screen.getByLabelText("Task"));
    await userEvent.click(await screen.findByRole("option", { name: /AW-2/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    await waitFor(() =>
      expect(call.mock.calls.find(([m]) => m === "assignTask")?.[1]).toMatchObject({
        task: "tb",
        assignee: "claude@mac-mini-lab",
      }),
    );
  });

  it("offers Orca where the device turned it on, and sends the chosen host", async () => {
    const task = makeTask({ assignee: "claude@ubuntu-01" });
    const call = installBridge({
      tasks: () => [task],
      assignTask: () => ({ applied: true }),
      sessionHosts: () => ({
        device: "macbook-pro",
        devices: [
          { device: "ubuntu-01", may_run: true, use_orca: true, checkouts: [], orca: null },
        ],
      }),
    });
    renderApp(<NewSessionDialog ws="ws-1" task={task.id} onClose={() => undefined} />);
    const orca = await screen.findByRole("radio", { name: "Orca" });
    await waitFor(() => expect((orca as HTMLInputElement).checked).toBe(true));
    expect((orca as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText(/If Orca is missing on ubuntu-01/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    await waitFor(() =>
      expect(call.mock.calls.find(([m]) => m === "assignTask")?.[1]).toEqual({
        ws: "ws-1",
        task: task.id,
        assignee: "claude@ubuntu-01",
        session_host: "orca",
      }),
    );
  });

  it("keeps Orca off on a device with no use_orca", async () => {
    const task = makeTask({ assignee: "claude@ubuntu-01" });
    installBridge({
      tasks: () => [task],
      sessionHosts: () => ({
        device: "macbook-pro",
        devices: [
          { device: "ubuntu-01", may_run: true, use_orca: false, checkouts: [], orca: null },
        ],
      }),
    });
    renderApp(<NewSessionDialog ws="ws-1" task={task.id} onClose={() => undefined} />);
    const orca = await screen.findByRole("radio", { name: "Orca · not turned on on ubuntu-01" });
    expect((orca as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "tmux · default" }).checked).toBe(
      true,
    );
  });
});

describe("session options (session-options)", () => {
  it("New task preselects Skip permissions; Project default sends no options (polish-skip-default)", async () => {
    const call = installBridge({
      createTask: () => ({ applied: true, task: makeTask({ id: "new-id" }) }),
    });
    renderApp(<NewTaskDialog ws="ws-1" project="billing-api" onClose={() => undefined} />);
    const permissions = await screen.findByLabelText("Permissions");
    expect(permissions.textContent).toBe("Skip permissions");
    expect(await screen.findByText(/runs each command as you, with no gate/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText("First message"), "Add a CSV export");
    await userEvent.click(permissions);
    await userEvent.click(await screen.findByRole("option", { name: /^Project default/ }));
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(call.mock.calls.find(([m]) => m === "createTask")?.[1]).toBeTruthy(),
    );
    const body = (call.mock.calls.find(([m]) => m === "createTask")?.[1] as { body: object }).body;
    expect(body).not.toHaveProperty("session_options");
  });

  it("New task sends skip permissions and the project checkout, with the warnings", async () => {
    const call = installBridge({
      createTask: () => ({ applied: true, task: makeTask({ id: "new-id" }) }),
    });
    renderApp(<NewTaskDialog ws="ws-1" project="billing-api" onClose={() => undefined} />);
    await userEvent.type(screen.getByLabelText("First message"), "Add a CSV export");
    await userEvent.click(screen.getByLabelText("Permissions"));
    await userEvent.click(await screen.findByRole("option", { name: "Skip permissions" }));
    expect(
      await screen.findByText(
        /runs each command as you, with no gate. A hidden command can still act as you in AW/,
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Project checkout"));
    expect(screen.getByText(/This changes the branch and the files of your checkout/)).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Agent teams · experimental"));
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(call.mock.calls.find(([m]) => m === "createTask")?.[1]).toMatchObject({
        body: {
          session_options: {
            permission_mode: "skip",
            agent_teams: true,
            work_in: "checkout",
            folder: null,
          },
        },
      }),
    );
  });

  it("New task shows Permissions next to the assignee, not in the Session block (ux-2)", async () => {
    installBridge();
    renderApp(<NewTaskDialog ws="ws-1" project="billing-api" onClose={() => undefined} />);
    const permissions = await screen.findByLabelText("Permissions");
    const assignee = screen.getByLabelText("Assignee");
    const row = (el: HTMLElement) => el.closest(".MuiStack-root");
    expect(row(permissions)).toBe(row(assignee));
    const session = screen.getByRole("group", { name: "Session" });
    expect(within(session).queryByLabelText("Permissions")).toBeNull();
    expect(within(session).getByLabelText("Agent teams · experimental")).toBeTruthy();
    // The menu is above "Start the agent now" in the dialog.
    const start = screen.getByLabelText("Start the agent now");
    expect(permissions.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("New task blocks Other folder with no folder", async () => {
    installBridge();
    renderApp(<NewTaskDialog ws="ws-1" project="billing-api" onClose={() => undefined} />);
    await userEvent.type(screen.getByLabelText("First message"), "Add a CSV export");
    await userEvent.click(screen.getByLabelText("Other folder…"));
    expect(await screen.findByText("Choose the folder of the session.")).toBeTruthy();
    const create = screen.getByRole<HTMLButtonElement>("button", { name: "Create task" });
    expect(create.disabled).toBe(true);
  });

  it("New session starts with the task options and sends the changed options", async () => {
    const task = makeTask({
      assignee: "claude@ubuntu-01",
      session_options: {
        permission_mode: "skip",
        agent_teams: false,
        work_in: "worktree",
        folder: null,
      },
    });
    const call = installBridge({
      tasks: () => [task],
      assignTask: () => ({ applied: true }),
      sessionHosts: () => ({ device: "macbook-pro", devices: [] }),
    });
    renderApp(<NewSessionDialog ws="ws-1" task={task.id} onClose={() => undefined} />);
    expect(
      await screen.findByText(
        /runs each command as you, with no gate. A hidden command can still act as you in AW/,
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Permissions"));
    await userEvent.click(await screen.findByRole("option", { name: "Accept edits" }));
    const start = screen.getByRole("button", { name: "Start session" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(start);
    await waitFor(() =>
      expect(call.mock.calls.find(([m]) => m === "assignTask")?.[1]).toMatchObject({
        session_options: { permission_mode: "accept_edits", work_in: "worktree" },
      }),
    );
  });
});

type Opens = (dialogs: ReturnType<typeof useDialogs>) => void;

function Opener({ open }: { open: Opens }) {
  const dialogs = useDialogs();
  return <button onClick={() => open(dialogs)}>open</button>;
}

/** The app shell in short: a navigation (a notification click) changes the current workspace. */
function SwitchingShell({ open }: { open: Opens }) {
  const [ws, setWs] = useState("ws-1");
  return (
    <DialogsProvider ws={ws}>
      <Opener open={open} />
      <button onClick={() => setWs("ws-2")}>switch</button>
    </DialogsProvider>
  );
}

function switchWorkspace() {
  // The open dialog hides the rest of the page from the accessibility tree.
  fireEvent.click(screen.getByRole("button", { name: "switch", hidden: true }));
}

describe("DialogsProvider workspace (fc1-d1)", () => {
  it("creates the task in the workspace where New task opened", async () => {
    const call = installBridge({
      createTask: () => ({ applied: true, task: makeTask({ id: "new-id" }) }),
    });
    renderApp(<SwitchingShell open={(d) => d.newTask("billing-api")} />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.type(await screen.findByLabelText("First message"), "Add a CSV export");
    switchWorkspace();
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(call.mock.calls.find(([m]) => m === "createTask")?.[1]).toMatchObject({
        ws: "ws-1",
      }),
    );
  });

  it("adds the project to the workspace where Add a project opened", async () => {
    const call = installBridge({
      workspaces: () => [
        { id: "ws-1", name: "Personal", path: "/Users/example/AW/Personal" },
        { id: "ws-2", name: "Lab", path: "/Users/example/AW/Lab" },
      ],
      chooseFolder: () => ({
        path: "/Users/example/dev/example-org/billing-api",
        name: "billing-api",
        git: true,
      }),
      addProject: () => ({ ...PROJECT, slug: "billing-api", name: "billing-api" }),
    });
    renderApp(<SwitchingShell open={(d) => d.addProject()} />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    expect(await screen.findByRole("dialog", { name: "Add a project to Personal" })).toBeTruthy();
    switchWorkspace();
    await userEvent.click(screen.getByRole("button", { name: "Choose…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add project" }));
    await waitFor(() =>
      expect(call.mock.calls.find(([m]) => m === "addProject")?.[1]).toMatchObject({
        ws: "ws-1",
      }),
    );
  });

  it("starts the session in the workspace where New session opened", async () => {
    const task = makeTask({ assignee: "claude@ubuntu-01" });
    const call = installBridge({
      tasks: () => [task],
      assignTask: () => ({ applied: true }),
      sessionHosts: () => ({ device: "macbook-pro", devices: [] }),
    });
    renderApp(<SwitchingShell open={(d) => d.newSession(task.id)} />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    const start = await screen.findByRole("button", { name: "Start session" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    switchWorkspace();
    const again = screen.getByRole("button", { name: "Start session" });
    await waitFor(() => expect((again as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(again);
    await waitFor(() =>
      expect(call.mock.calls.find(([m]) => m === "assignTask")?.[1]).toMatchObject({
        ws: "ws-1",
      }),
    );
  });
});
