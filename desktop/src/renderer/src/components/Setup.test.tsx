// Component tests of the setup screens (openspec gap-setup): the first workspace, the workspace
// menu, the project Settings page and the community switch.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { BindingsView, SyncSettingsView, WorkspaceSummary } from "../../../shared/channels.ts";
import { installBridge, makeTask, PROJECT, renderApp } from "../testing.tsx";
import { CommunityCard } from "./CommunityCard.tsx";
import { lines, parseSlots, ProjectSettingsPage } from "./ProjectSettings.tsx";
import { FirstWorkspace, WorkspaceSwitcher } from "./WorkspaceMenu.tsx";
import { DialogsProvider } from "./dialogs.tsx";

afterEach(cleanup);

function argsOf(call: ReturnType<typeof installBridge>, method: string) {
  return call.mock.calls.filter(([m]) => m === method).map(([, args]) => args);
}

const WS: WorkspaceSummary = {
  id: "ws-1",
  name: "Personal",
  path: "/srv/aw/Personal",
  ready: true,
  error: null,
  tasks: 0,
  open_gates: 0,
  issues: 0,
  notices: [],
  last_hlc: null,
};

const BINDINGS: BindingsView = {
  device: "macbook-pro",
  may_run: true,
  use_orca: false,
  checkouts: [],
  resources: {},
};

describe("FirstWorkspace", () => {
  it("creates the Personal workspace with one click and opens its Inbox", async () => {
    const call = installBridge({ initWorkspace: () => ({ created: true, workspace: WS }) });
    const { router } = renderApp(<FirstWorkspace />, { url: "/" });
    await userEvent.click(screen.getByRole("button", { name: "Create the Personal workspace" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/w/ws-1/inbox"));
    expect(argsOf(call, "initWorkspace")).toEqual([{}]);
  });

  it("chooses the location of another workspace with the native picker (workspace-folder)", async () => {
    const call = installBridge({
      chooseFolder: () => ({ path: "/Users/example/Work", name: "Work", git: false }),
      initWorkspace: () => ({ created: true, workspace: WS, folder_note: null }),
    });
    const { router } = renderApp(<FirstWorkspace />, { url: "/" });
    await userEvent.click(screen.getByRole("button", { name: "Use another name or folder" }));
    await userEvent.type(await screen.findByLabelText("Name"), "Team");
    expect(screen.getByText(/It can hold other files/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Choose…" }));
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("Location").value).toBe("/Users/example/Work"),
    );
    expect(argsOf(call, "chooseFolder")).toEqual([{ purpose: "workspace" }]);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(argsOf(call, "initWorkspace")).toEqual([
        { name: "Team", parent: "/Users/example/Work" },
      ]),
    );
    // No note: the Inbox opens at once.
    await waitFor(() => expect(router.state.location.pathname).toBe("/w/ws-1/inbox"));
  });

  it("shows the note when awd used a suffix, then opens the workspace (workspace-folder)", async () => {
    const note =
      "/Users/example/Work/Team is in use (other files), so AW uses /Users/example/Work/Team-aw1.";
    const added = { ...WS, name: "Team", path: "/Users/example/Work/Team-aw1" };
    installBridge({
      initWorkspace: () => ({ created: true, workspace: added, folder_note: note }),
    });
    const { router } = renderApp(<FirstWorkspace />, { url: "/" });
    await userEvent.click(screen.getByRole("button", { name: "Use another name or folder" }));
    await userEvent.type(await screen.findByLabelText("Name"), "Team");
    await userEvent.type(screen.getByLabelText("Location"), "/Users/example/Work");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText(note)).toBeTruthy();
    expect(screen.getByText("/Users/example/Work/Team-aw1")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/");
    await userEvent.click(screen.getByRole("button", { name: "Open the workspace" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/w/ws-1/inbox"));
  });

  it("registers a workspace folder that another device synced (wf-2)", async () => {
    const folder = "/Users/example/Sync/Acme";
    const note = `${folder} is the folder of the workspace Acme, so AW registers it.`;
    const call = installBridge({
      initWorkspace: () => ({
        created: false,
        workspace: { ...WS, name: "Acme", path: folder },
        folder_note: note,
      }),
    });
    renderApp(<FirstWorkspace />, { url: "/" });
    await userEvent.click(screen.getByRole("button", { name: "Use another name or folder" }));
    expect(
      await screen.findByText(/Choose a workspace folder that another device synced/),
    ).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Name"), "Acme");
    await userEvent.type(screen.getByLabelText("Location"), folder);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(argsOf(call, "initWorkspace")).toEqual([{ name: "Acme", parent: folder }]);
    expect(await screen.findByText(note)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open the workspace" })).toBeTruthy();
  });

  it("refuses a relative location (workspace-folder)", async () => {
    installBridge({});
    renderApp(<FirstWorkspace />, { url: "/" });
    await userEvent.click(screen.getByRole("button", { name: "Use another name or folder" }));
    await userEvent.type(await screen.findByLabelText("Name"), "Team");
    await userEvent.type(screen.getByLabelText("Location"), "Work");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Add" }).disabled).toBe(true);
    expect(screen.getByText(/Give an absolute path/)).toBeTruthy();
  });

  it("joins the workspace of another computer with a pairing code (fix list 0-16)", async () => {
    const id = "0123456789abcdef0123456789abcdef";
    const view = {
      id,
      side: "join",
      state: "waiting",
      workspace: { id: "ws-9", name: "Personal" },
      device: "mac-mini-lab",
      expires_at: "2026-11-24T10:10:00.000Z",
      check_code: "482 913",
      new_device: { slug: "macbook-pro", name: "MacBook Pro", role: "local" },
      error: null,
      folder: "/Users/example/Work/Personal-aw1",
      folder_note:
        "/Users/example/Work/Personal is in use (other files), so AW uses /Users/example/Work/Personal-aw1.",
      code: null,
      qr_svg: null,
    };
    let state = "waiting";
    const call = installBridge({
      joinPairing: () => view,
      pairing: () => ({ ...view, state }),
      workspaces: () => (state === "done" ? [WS] : []),
    });
    const { router } = renderApp(<FirstWorkspace />, { url: "/" });
    await userEvent.click(screen.getByRole("button", { name: "Join with a pairing code" }));
    const join = screen.getByRole("button", { name: "Join" });
    expect((join as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Pairing code"), "  aw1:EXAMPLECODE  ");
    await userEvent.type(screen.getByLabelText("Location"), "/Users/example/Work");
    await userEvent.click(join);
    await waitFor(() =>
      expect(argsOf(call, "joinPairing")).toEqual([
        { code: "aw1:EXAMPLECODE", parent: "/Users/example/Work" },
      ]),
    );
    expect(await screen.findByText("/Users/example/Work/Personal-aw1")).toBeTruthy();
    expect(screen.getByText(/Personal is in use \(other files\)/)).toBeTruthy();
    expect(await screen.findByText("482 913")).toBeTruthy();
    expect(screen.getByText(/On mac-mini-lab/)).toBeTruthy();
    expect(await screen.findByText("Waiting for the approval on mac-mini-lab.")).toBeTruthy();
    expect(argsOf(call, "initWorkspace")).toEqual([]);
    state = "done";
    await waitFor(() => expect(router.state.location.pathname).toBe("/w/ws-9/inbox"), {
      timeout: 3000,
    });
  });
});

describe("WorkspaceSwitcher", () => {
  it("renames the workspace", async () => {
    const call = installBridge({ renameWorkspace: () => ({ ...WS, name: "Acme" }) });
    renderApp(
      <DialogsProvider ws={WS.id}>
        <WorkspaceSwitcher current={WS} />
      </DialogsProvider>,
      { url: "/" },
    );
    await userEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Acme");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() =>
      expect(argsOf(call, "renameWorkspace")).toEqual([{ ws: "ws-1", name: "Acme" }]),
    );
  });

  it("removes the workspace from this device and says that the files stay", async () => {
    const call = installBridge({
      removeWorkspace: () => ({ ...WS, files_kept: true, message: "ok" }),
    });
    renderApp(
      <DialogsProvider ws={WS.id}>
        <WorkspaceSwitcher current={WS} />
      </DialogsProvider>,
      { url: "/" },
    );
    await userEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove from this device…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("The files stay in /srv/aw/Personal");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(argsOf(call, "removeWorkspace")).toEqual([{ ws: "ws-1" }]));
  });

  it("names the tasks that stay assigned to this device before the remove", async () => {
    installBridge({
      tasks: () => [
        makeTask({ id: "t3", key: "AW-3", assignee: "claude@macbook-pro" }),
        makeTask({ id: "t4", key: "AW-4", assignee: "claude@ubuntu-01" }),
        makeTask({ id: "t5", key: "AW-5", assignee: "claude@macbook-pro", stage: "done" }),
      ],
    });
    renderApp(
      <DialogsProvider ws={WS.id}>
        <WorkspaceSwitcher current={WS} />
      </DialogsProvider>,
      { url: "/" },
    );
    await userEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove from this device…" }));
    expect(
      await screen.findByText(
        /These tasks stay assigned to macbook-pro, which runs no session for them then: AW-3\. Assign/,
      ),
    ).toBeTruthy();
  });
});

describe("ProjectSettingsPage", () => {
  const route = { route: "/w/:ws/p/:project/settings", url: "/w/ws-1/p/billing-api/settings" };

  it("saves the device order, the main repository and the subtask switch", async () => {
    const call = installBridge({
      bindings: () => BINDINGS,
      devices: () => [],
      editProject: () => PROJECT,
    });
    renderApp(<ProjectSettingsPage />, route);
    await userEvent.click(await screen.findByRole("button", { name: "Move ubuntu-01 up" }));
    await userEvent.type(
      screen.getByLabelText("Main repository"),
      "https://github.com/example/billing-api",
    );
    await userEvent.click(screen.getByLabelText("Assign new subtasks to the default device"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(argsOf(call, "editProject")).toHaveLength(1));
    expect(argsOf(call, "editProject")[0]).toEqual({
      ws: "ws-1",
      project: "billing-api",
      body: {
        name: "Billing API",
        devices: ["ubuntu-01", "macbook-pro"],
        default_agent: "claude",
        main_repo: "https://github.com/example/billing-api",
        links: ["https://github.com/example/billing-api"],
        test_servers: ["k3d"],
        switches: { assign_new_subtasks_to_default_device: true },
        // The project has no permission_mode: the product default skip (polish-skip-default).
        permission_mode: "skip",
      },
    });
  });

  it("binds the checkout of this device with its host, and archives the project", async () => {
    const call = installBridge({
      bindings: () => BINDINGS,
      devices: () => [],
      editBindings: () => BINDINGS,
      editProject: () => PROJECT,
    });
    renderApp(<ProjectSettingsPage />, route);
    expect(await screen.findByText("This device: macbook-pro")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Checkout folder"), "/srv/code/billing-api");
    await userEvent.click(screen.getByLabelText("Session host"));
    await userEvent.click(await screen.findByRole("option", { name: "tmux" }));
    await userEvent.click(screen.getByRole("button", { name: "Save checkout" }));
    await waitFor(() =>
      expect(argsOf(call, "editBindings")).toEqual([
        {
          ws: "ws-1",
          body: {
            checkouts: [
              { project: "billing-api", path: "/srv/code/billing-api", session_host: "tmux" },
            ],
          },
        },
      ]),
    );
    await userEvent.click(screen.getByRole("button", { name: "Archive the project" }));
    await waitFor(() =>
      expect(argsOf(call, "editProject")).toEqual([
        { ws: "ws-1", project: "billing-api", body: { archived: true } },
      ]),
    );
  });

  it("explains where a session works, and edits the test servers as chips (screens-align)", async () => {
    const call = installBridge({
      bindings: () => BINDINGS,
      devices: () => [],
      editProject: () => PROJECT,
    });
    renderApp(<ProjectSettingsPage />, route);
    for (const title of [
      "General",
      "Devices",
      "Test servers",
      "This device: macbook-pro",
      "Archive",
    ]) {
      expect(await screen.findByRole("region", { name: title })).toBeTruthy();
    }
    const host = screen.getByRole("combobox", { name: "Session host" });
    expect(host.getAttribute("aria-describedby")).toContain("host-help");
    expect(document.getElementById("host-help")?.textContent).toBe(
      "Each session works in its own git worktree aw-<key> on the branch aw/<key>, unless the task sets another Work in. With tmux, the worktree is in ~/.aw/worktrees/aw-<key>. With Orca, Orca makes the worktree aw-<key> in its own folder, and the task shows the path.",
    );
    const servers = screen.getByRole("combobox", { name: "Server names" });
    await userEvent.type(servers, "billing-staging{Enter}");
    expect(screen.getByRole("button", { name: "billing-staging" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(argsOf(call, "editProject")).toHaveLength(1));
    expect(argsOf(call, "editProject")[0]).toMatchObject({
      body: { test_servers: ["k3d", "billing-staging"] },
    });
  });

  it("saves a typed test server name with no Enter, and refuses a bad one (screens-align check)", async () => {
    const call = installBridge({
      bindings: () => BINDINGS,
      devices: () => [],
      editProject: () => PROJECT,
    });
    renderApp(<ProjectSettingsPage />, route);
    const servers = await screen.findByRole("combobox", { name: "Server names" });
    await userEvent.type(servers, "Bad Name");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
    expect(screen.getByText("Bad Name is not a test server name")).toBeTruthy();
    await userEvent.clear(servers);
    await userEvent.type(servers, "billing-staging");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(argsOf(call, "editProject")).toHaveLength(1));
    expect(argsOf(call, "editProject")[0]).toMatchObject({
      body: { test_servers: ["k3d", "billing-staging"] },
    });
  });

  it("parses the test slots and the link lines", () => {
    expect(parseSlots("k3d=1, browser = 2")).toEqual({ k3d: 1, browser: 2 });
    expect(parseSlots("")).toEqual({});
    expect(parseSlots("k3d")).toContain("not name=capacity");
    expect(parseSlots("k3d=0")).toContain("not name=capacity");
    expect(lines(" a \n\n b ")).toEqual(["a", "b"]);
  });
});

describe("CommunityCard", () => {
  const settings: SyncSettingsView = {
    community: true,
    source: "default",
    text: "Across networks, your devices use community Syncthing discovery and relay servers.",
  };

  it("shows the disclosure text and turns the community servers off", async () => {
    const call = installBridge({
      syncSettings: () => settings,
      setSyncSettings: () => ({ ...settings, community: false, applied: "now" }),
    });
    renderApp(<CommunityCard />, { url: "/settings" });
    expect(await screen.findByText(settings.text)).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Use community discovery and relay servers"));
    await waitFor(() => expect(argsOf(call, "setSyncSettings")).toEqual([{ community: false }]));
  });

  it("is read-only when AW_SYNC_COMMUNITY sets it", async () => {
    installBridge({ syncSettings: () => ({ ...settings, community: false, source: "env" }) });
    renderApp(<CommunityCard />, { url: "/settings" });
    expect(await screen.findByText(/AW_SYNC_COMMUNITY sets this switch/)).toBeTruthy();
    expect(
      screen.getByLabelText<HTMLInputElement>("Use community discovery and relay servers").disabled,
    ).toBe(true);
    expect(screen.getByText(/LAN and Tailscale only/)).toBeTruthy();
  });
});
