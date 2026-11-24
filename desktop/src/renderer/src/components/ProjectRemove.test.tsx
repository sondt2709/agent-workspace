// Component tests of "Remove the project" in the project Settings page (openspec project-remove).
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { BindingsView } from "../../../shared/channels.ts";
import { installBridge, PROJECT, renderApp } from "../testing.tsx";
import { cleanupText } from "./ProjectRemove.tsx";
import { ProjectSettingsPage } from "./ProjectSettings.tsx";

afterEach(cleanup);

const BINDINGS: BindingsView = {
  device: "macbook-pro",
  may_run: true,
  use_orca: false,
  checkouts: [],
  resources: {},
};

const PREVIEW = {
  project: { slug: "billing-api", name: "Billing API" },
  tasks: [{ id: "t1", key: "AW-1", title: "Add rate limits", stage: "implement" }],
  sessions: [{ task: "t1", key: "AW-1", session: "s1", device: "ubuntu-01" }],
};

const route = { route: "/w/:ws/p/:project/settings", url: "/w/ws-1/p/billing-api/settings" };

describe("Remove the project", () => {
  it("names the open tasks and sessions, needs the slug, removes, then opens the Inbox", async () => {
    // The project leaves the list after the remove: the dialog must stay open with the result.
    let removed = false;
    const call = installBridge({
      bindings: () => BINDINGS,
      devices: () => [],
      projects: () => (removed ? [] : [PROJECT]),
      projectRemoval: () => PREVIEW,
      removeProject: () => {
        removed = true;
        return {
          ...PREVIEW,
          removed: { event: "e1", hlc: "2026-11-24T10:00:00.000Z#0000" },
          cleanup: [
            {
              task: "t1",
              key: "AW-1",
              path: "/w/aw-AW-1",
              branch: "aw/AW-1",
              result: "kept",
              reason: "unpushed commits",
            },
          ],
        };
      },
    });
    const { router } = renderApp(<ProjectSettingsPage />, route);
    await userEvent.click(await screen.findByRole("button", { name: "Remove the project…" }));
    expect(await screen.findByText("These sessions stop: AW-1 on ubuntu-01.")).toBeTruthy();
    expect(screen.getByText("Open tasks (1)")).toBeTruthy();
    expect(screen.getByText("AW-1 · Add rate limits · implement")).toBeTruthy();
    const remove = screen.getByRole("button", { name: "Remove project" });
    expect(remove).toHaveProperty("disabled", true);
    await userEvent.type(screen.getByLabelText("Type billing-api to confirm"), "billing-api");
    expect(remove).toHaveProperty("disabled", false);
    await userEvent.click(remove);
    expect(
      await screen.findByText("Kept /w/aw-AW-1 on the branch aw/AW-1: unpushed commits"),
    ).toBeTruthy();
    const removes = call.mock.calls.filter(([m]) => m === "removeProject").map(([, a]) => a);
    expect(removes).toEqual([{ ws: "ws-1", project: "billing-api" }]);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/w/ws-1/inbox"));
  });

  it("writes what this device removed or kept", () => {
    const base = { task: "t", key: "AW-2", path: "/w/aw-AW-2", branch: "aw/AW-2" };
    expect(cleanupText({ ...base, result: "removed", reason: null })).toBe(
      "Removed /w/aw-AW-2 on the branch aw/AW-2",
    );
    expect(cleanupText({ ...base, path: null, branch: null, result: "kept", reason: "x" })).toBe(
      "Kept AW-2: x",
    );
  });
});
