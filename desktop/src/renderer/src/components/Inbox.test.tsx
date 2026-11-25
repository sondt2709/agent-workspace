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

describe("Inbox reasons and detail rows (proposal-and-discussion)", () => {
  const question = makeGate({
    gate: "g-question",
    kind: "question",
    title: "Where do the counters live?",
    options: ["Redis", "In memory"],
  });
  const proposal = makeGate({
    gate: "g-proposal",
    kind: "approve_proposal",
    title: "Rate limits",
    options: ["Approve"],
    file: "proposal/v2.md",
  });
  const asks = makeTask({
    id: "t12",
    key: "AW-12",
    title: "Rate limits for the public API",
    gates: [question],
    needs_you_lane: true,
    needs_you_reasons: [{ reason: "gate", kind: "question" }],
  });
  const waits = makeTask({
    id: "t15",
    key: "AW-15",
    title: "Sign-in with passkeys",
    gates: [proposal],
    needs_you_lane: true,
    needs_you_reasons: [{ reason: "gate", kind: "approve_proposal" }],
  });

  function show(url = "/w/ws-1/inbox") {
    const call = installBridge({
      tasks: () => [asks, waits],
      thread: (args: { task: string }) => ({
        task: { id: args.task, key: null, title: null },
        events:
          args.task === "t12"
            ? [gateOpenedRow(question, { text: "Redis: one counter for all pods." })]
            : [
                gateOpenedRow(proposal, {
                  text: "# Rate limits\n\nA token bucket.",
                  file: "proposal/v2.md",
                }),
              ],
        next: null,
        prev: null,
        ancestors: [],
      }),
      answerGate: () => ({ applied: true }),
    });
    renderApp(
      <DialogsProvider ws="ws-1">
        <Inbox />
      </DialogsProvider>,
      { route: "/w/:ws/inbox", url },
    );
    return call;
  }

  it("names the reasons, and answers a question in the detail with the reply field", async () => {
    const call = show();
    const rows = await screen.findByRole("list", { name: "Needs you" });
    expect(
      within(rows)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual([
      "Reply to a question: AW-12 Rate limits for the public API",
      "Approve proposal: AW-15 Sign-in with passkeys",
    ]);
    await userEvent.click(within(rows).getByRole("button", { name: /AW-12/ }));
    const detail = await screen.findByRole("region", { name: "AW-12 needs you" });
    const message = await within(detail).findByRole("article", {
      name: "Question: Where do the counters live?",
    });
    expect(within(message).getByText("Waits for your reply")).toBeTruthy();
    expect(within(message).getByRole("button", { name: "Redis" })).toBeTruthy();
    await userEvent.type(within(message).getByLabelText("Or write your answer"), "Redis, 60 s TTL");
    await userEvent.click(within(message).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(call.mock.calls.filter(([m]) => m === "answerGate").map(([, a]) => a)).toEqual([
        {
          ws: "ws-1",
          gate: "g-question",
          body: { answer: "Redis, 60 s TTL", comment: null, version: 1 },
        },
      ]),
    );
  });

  it("shows the proposal card in the detail of an Approve proposal row", async () => {
    const call = show("/w/ws-1/inbox?item=task%3At15");
    const detail = await screen.findByRole("region", { name: "AW-15 needs you" });
    const card = await within(detail).findByRole("article", { name: "Proposal v2" });
    expect(within(card).getByText("Waits for your approval")).toBeTruthy();
    expect(await within(card).findByText("A token bucket.")).toBeTruthy();
    await userEvent.click(within(card).getByRole("button", { name: "Approve proposal" }));
    await waitFor(() =>
      expect(call.mock.calls.filter(([m]) => m === "answerGate").map(([, a]) => a)).toEqual([
        { ws: "ws-1", gate: "g-proposal", body: { answer: "Approve", comment: null, version: 1 } },
      ]),
    );
    expect(screen.getByRole("button", { name: "Open task" })).toBeTruthy();
  });
});
