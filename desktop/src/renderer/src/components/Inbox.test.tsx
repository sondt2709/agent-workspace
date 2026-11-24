// The Inbox keeps the answer notice of a task after its gate closes (gate-full-context check,
// result open issue 1): the person answers in the Inbox, awd refuses, the task leaves the lane.
// The Inbox is a list and a detail with the tabs "Needs you" and "Updates" (navigation-prototype).
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  FakeCallError,
  gateOpenedRow,
  installBridge,
  makeGate,
  makeTask,
  PROJECT,
  renderApp,
} from "../testing.tsx";
import { Home } from "./AppShell.tsx";
import { DialogsProvider } from "./dialogs.tsx";
import { Inbox } from "./Inbox.tsx";

afterEach(cleanup);

describe("Inbox answer notice", () => {
  const gate = makeGate({
    gate: "g-result",
    kind: "approve_result",
    options: ["Approve", "Request changes"],
  });
  const open = makeTask({
    id: "t31",
    key: "AW-31",
    title: "Add rate limits",
    stage: "review",
    gates: [gate],
    needs_you_lane: true,
  });
  const resolved = makeTask({
    ...open,
    stage: "done",
    gates: [{ ...gate, state: "resolved", answer: "Approve" }],
    needs_you_lane: false,
  });

  it("keeps the task card with the notice after the gate leaves the lane", async () => {
    let answered = false;
    installBridge({
      tasks: () => [answered ? resolved : open],
      thread: () => ({
        task: { id: open.id, key: open.key, title: open.title },
        events: [gateOpenedRow(gate)],
        next: null,
        prev: null,
        ancestors: [],
      }),
      answerGate: () => {
        answered = true;
        throw new FakeCallError("gate_not_open", "resolved", 409, {
          gate: gate.gate,
          answer: "Approve",
        });
      },
    });
    renderApp(
      <DialogsProvider ws="ws-1">
        <Inbox />
      </DialogsProvider>,
      { route: "/w/:ws/inbox", url: "/w/ws-1/inbox" },
    );
    await userEvent.click(await screen.findByRole("button", { name: /AW-31/ }));
    const card = await screen.findByRole("region", { name: "AW-31 needs you" });
    await userEvent.click(await within(card).findByRole("button", { name: "Approve" }));
    const text = "Another answer resolved this gate first: “Approve”. AW did not send your answer.";
    expect(await screen.findByText(text)).toBeTruthy();
    // The task list refreshes after the answer: the task is Done and out of the lane.
    await waitFor(() =>
      expect(
        within(screen.getByLabelText("AW-31 needs you")).queryByRole("button", { name: "Approve" }),
      ).toBeNull(),
    );
    expect(screen.getByText(text)).toBeTruthy();
    // The row stays (as "Answer notice") while the notice shows: the tab still counts it.
    expect(screen.getByRole("tab", { name: "Needs you 1" })).toBeTruthy();
    // Close removes the notice and the card.
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByLabelText("AW-31 needs you")).toBeNull());
  });
});

describe("Inbox empty states (fix list cfc-3)", () => {
  const digest = {
    date: "2026-11-23",
    learned: [
      {
        id: "c1",
        hlc: "x",
        at: "2026-11-23T09:59:00.000Z",
        dev: "ubuntu-01",
        path: "shared/learned/2026-11-23-aw-8-index.md",
        hash: "a".repeat(64),
        base: null,
        author: "claude@ubuntu-01",
        by: null,
        task: "t8",
        task_key: "AW-8",
        kind: "learned" as const,
        suggestion: null,
        label: "Learned by claude@ubuntu-01 on AW-8",
      },
    ],
    changes: [],
    pending: [],
    text: "",
  };
  const bad = {
    code: "bad_document",
    path: "tasks/projects/broken/project.yaml",
    line: 5,
    event: null,
    task: null,
    reason: null,
    message: "name: unclosed list",
  };

  it.each([
    ["no project", () => [], () => []],
    ["only archived tasks", () => [PROJECT], () => [makeTask({ archived: true })]],
  ])(
    "shows the knowledge of today and the files to fix with %s",
    async (_name, projects, tasks) => {
      installBridge({ projects, tasks, kbDigest: () => digest, issues: () => [bad] });
      renderApp(
        <DialogsProvider ws="ws-1">
          <Inbox />
        </DialogsProvider>,
        { route: "/w/:ws/inbox", url: "/w/ws-1/inbox" },
      );
      expect(await screen.findByLabelText("Knowledge today")).toBeTruthy();
      expect(
        await screen.findByLabelText("Fix a file tasks/projects/broken/project.yaml"),
      ).toBeTruthy();
    },
  );
});

describe("Home (desktop-shell review 8)", () => {
  it("shows the error when awd does not answer, not the first-run screen", async () => {
    installBridge({
      workspaces: () => {
        throw new FakeCallError("unreachable", "awd is not reachable (ECONNREFUSED)", null);
      },
    });
    renderApp(<Home />, { url: "/" });
    expect(await screen.findByText(/awd is not reachable/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create the Personal workspace" })).toBeNull();
  });
});
