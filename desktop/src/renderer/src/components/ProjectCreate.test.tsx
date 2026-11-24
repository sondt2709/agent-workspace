// Add a project with its checkout folder (openspec create-flows): the common layout ~/dev/<org>/<repo>,
// the binding of this device in the same step, the retry of a failed binding, and the folder checks.
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { BindingsView, WorkspaceSummary } from "../../../shared/channels.ts";
import { FakeCallError, installBridge, PROJECT, renderApp } from "../testing.tsx";
import { DialogsProvider, useDialogs } from "./dialogs.tsx";
import { WorkspaceSwitcher } from "./WorkspaceMenu.tsx";

afterEach(cleanup);

const WS: WorkspaceSummary = {
  id: "ws-1",
  name: "Personal",
  path: "/Users/example/AW/Personal",
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

const REPO = "/Users/example/dev/example-org/billing-api";

function argsOf(call: ReturnType<typeof installBridge>, method: string) {
  return call.mock.calls.filter(([m]) => m === method).map(([, args]) => args);
}

function handlers(more: Parameters<typeof installBridge>[0] = {}) {
  return {
    workspaces: () => [WS],
    bindings: () => BINDINGS,
    chooseFolder: () => ({ path: REPO, name: "billing-api", git: true }),
    addProject: () => ({ ...PROJECT, slug: "billing-api", name: "billing-api" }),
    editBindings: () => ({ ...BINDINGS, checkouts: [{ project: "billing-api", path: REPO }] }),
    ...more,
  };
}

function Opener() {
  const dialogs = useDialogs();
  return <button onClick={() => dialogs.addProject()}>open</button>;
}

function renderDialog() {
  return renderApp(
    <DialogsProvider ws="ws-1">
      <Opener />
    </DialogsProvider>,
    { url: "/w/ws-1/inbox" },
  );
}

describe("AddProjectDialog", () => {
  it("adds the project from its checkout folder and writes the binding of this device", async () => {
    const call = installBridge(handlers());
    const { router } = renderApp(
      <DialogsProvider ws="ws-1">
        <WorkspaceSwitcher current={WS} />
      </DialogsProvider>,
      { url: "/w/ws-1/inbox" },
    );
    await userEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Add a project…" }));
    expect(await screen.findByRole("dialog", { name: "Add a project to Personal" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Choose…" }));
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("Checkout folder").value).toBe(REPO),
    );
    expect(argsOf(call, "chooseFolder")).toEqual([{ purpose: "checkout" }]);
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("billing-api");
    expect(screen.getByLabelText<HTMLInputElement>("Slug").value).toBe("billing-api");
    await userEvent.click(screen.getByRole("button", { name: "Add project" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/w/ws-1/p/billing-api/board"));
    expect(argsOf(call, "addProject")).toEqual([
      { ws: "ws-1", body: { slug: "billing-api", name: "billing-api" } },
    ]);
    expect(argsOf(call, "editBindings")).toEqual([
      { ws: "ws-1", body: { checkouts: [{ project: "billing-api", path: REPO }] } },
    ]);
    const order = call.mock.calls
      .map(([m]) => m)
      .filter((m) => m === "addProject" || m === "editBindings");
    expect(order).toEqual(["addProject", "editBindings"]);
  });

  it("keeps the project when the binding fails and saves only the folder again", async () => {
    let fail = true;
    const call = installBridge(
      handlers({
        editBindings: () => {
          if (fail)
            throw new FakeCallError("invalid_input", "The checkout path is not a folder", 400);
          return BINDINGS;
        },
      }),
    );
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.click(await screen.findByRole("button", { name: "Choose…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add project" }));
    expect(await screen.findByText(/is added, but the folder is not saved/)).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Save the folder" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(argsOf(call, "addProject")).toHaveLength(1);
    expect(argsOf(call, "editBindings")).toHaveLength(2);
  });

  it("opens the Board of the added project when the person closes after a failed binding (cfc-4)", async () => {
    installBridge(
      handlers({
        editBindings: () => {
          throw new FakeCallError("invalid_input", "The checkout path is not a folder", 400);
        },
      }),
    );
    const { router } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.click(await screen.findByRole("button", { name: "Choose…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add project" }));
    expect(await screen.findByText(/is added, but the folder is not saved/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/w/ws-1/p/billing-api/board"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays open on Escape while the add runs (cfc-4)", async () => {
    let finish: (value: unknown) => void = () => undefined;
    const call = installBridge(
      handlers({
        addProject: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      }),
    );
    const { router } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.click(await screen.findByRole("button", { name: "Choose…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add project" }));
    await waitFor(() => expect(argsOf(call, "addProject")).toHaveLength(1));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Add a project to Personal" }), {
      key: "Escape",
    });
    expect(screen.getByRole("dialog", { name: "Add a project to Personal" })).toBeTruthy();
    finish({ ...PROJECT, slug: "billing-api", name: "billing-api" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/w/ws-1/p/billing-api/board"));
    expect(argsOf(call, "editBindings")).toHaveLength(1);
  });

  it("refuses a checkout inside the workspace folder and warns for a folder with no git", async () => {
    let pick = { path: "/Users/example/AW/Personal/code", name: "code", git: true };
    installBridge(handlers({ chooseFolder: () => pick }));
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.click(await screen.findByRole("button", { name: "Choose…" }));
    expect(await screen.findByText(/inside the workspace folder/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Add project" }).disabled).toBe(
      true,
    );
    pick = { path: "/Users/example/notes", name: "notes", git: false };
    await userEvent.click(screen.getByRole("button", { name: "Choose…" }));
    expect(await screen.findByText(/not a git repository/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Add project" }).disabled).toBe(
      false,
    );
  });

  it("asks for no folder on a device that runs no agent", async () => {
    const call = installBridge(handlers({ bindings: () => ({ ...BINDINGS, may_run: false }) }));
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.type(await screen.findByLabelText("Name"), "Web App");
    await waitFor(() => expect(screen.queryByLabelText("Checkout folder")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Add project" }));
    await waitFor(() => expect(argsOf(call, "addProject")).toHaveLength(1));
    expect(argsOf(call, "addProject")[0]).toEqual({
      ws: "ws-1",
      body: { slug: "web-app", name: "Web App" },
    });
    expect(argsOf(call, "editBindings")).toHaveLength(0);
  });

  it("stays open when the navigation that opened it goes away (a narrow window)", async () => {
    installBridge(handlers());
    function Shell() {
      const [nav, setNav] = useState(true);
      return (
        <>
          {nav && <WorkspaceSwitcher current={WS} />}
          <button onClick={() => setNav(false)}>narrow</button>
        </>
      );
    }
    renderApp(
      <DialogsProvider ws="ws-1">
        <Shell />
      </DialogsProvider>,
      { url: "/w/ws-1/inbox" },
    );
    await userEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Add a project…" }));
    await userEvent.type(await screen.findByLabelText("Name"), "billing");
    await userEvent.click(screen.getByRole("button", { name: "narrow", hidden: true }));
    expect(screen.getByRole("dialog", { name: "Add a project to Personal" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("billing");
  });
});
