// npc-11: the workspace dialogs stay open when the navigation that opened them goes away (a window
// narrower than 600 px hides the navigation), as Add a project (create-flows cf-1).
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSummary } from "../../../shared/channels.ts";
import { installBridge, renderApp } from "../testing.tsx";
import { DialogsProvider } from "./dialogs.tsx";
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

function Shell() {
  const [nav, setNav] = useState(true);
  return (
    <>
      {nav && <WorkspaceSwitcher current={WS} />}
      <button onClick={() => setNav(false)}>narrow</button>
    </>
  );
}

function show() {
  installBridge({ workspaces: () => [WS] });
  renderApp(
    <DialogsProvider ws="ws-1">
      <Shell />
    </DialogsProvider>,
    { url: "/w/ws-1/inbox" },
  );
}

describe("workspace dialogs in a narrow window (npc-11)", () => {
  it("keeps Rename open with the typed name", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));
    const name = await screen.findByLabelText<HTMLInputElement>("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Work");
    await userEvent.click(screen.getByRole("button", { name: "narrow", hidden: true }));
    expect(screen.getByRole("dialog", { name: "Rename the workspace" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Work");
  });

  it("keeps Add a workspace open", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Add a workspace…" }));
    expect(await screen.findByRole("dialog", { name: "Add a workspace" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "narrow", hidden: true }));
    expect(screen.getByRole("dialog", { name: "Add a workspace" })).toBeTruthy();
  });

  it("keeps Remove from this device open", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove from this device…" }));
    expect(await screen.findByRole("dialog", { name: /Remove Personal/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "narrow", hidden: true }));
    expect(screen.getByRole("dialog", { name: /Remove Personal/ })).toBeTruthy();
  });
});
