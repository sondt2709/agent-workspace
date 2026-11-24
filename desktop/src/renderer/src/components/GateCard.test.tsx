import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { Gate, Task } from "../../../shared/channels.ts";
import {
  eventRow,
  fixedClock,
  gateOpenedRow,
  installBridge,
  makeGate,
  makeTask,
  renderApp,
} from "../testing.tsx";
import { GateCard } from "./GateCard.tsx";

afterEach(cleanup);

const OPENED = Date.parse("2026-11-23T10:00:00.000Z");

function setup(
  gate: Gate,
  options: { now?: number; data?: Record<string, unknown>; task?: Partial<Task> } = {},
) {
  const task = makeTask({ gates: [gate], needs_you: [gate.gate], ...options.task });
  const call = installBridge({
    thread: () => ({
      task: { id: task.id, key: task.key, title: task.title },
      events: [gateOpenedRow(gate, options.data)],
      next: null,
      ancestors: [],
    }),
    answerGate: () => ({ applied: true }),
  });
  renderApp(<GateCard ws="ws-1" task={task} gate={gate} />, {
    clock: fixedClock(options.now ?? OPENED),
  });
  return call;
}

/** A card whose thread reads give the agent rows before the gate (the context query). */
function setupContext(gate: Gate, before: ReturnType<typeof eventRow>[], data = {}) {
  const task = makeTask({ gates: [gate], needs_you: [gate.gate] });
  const call = installBridge({
    thread: (args: { query?: { before?: string } }) => ({
      task: { id: task.id, key: task.key, title: task.title },
      events: args.query?.before ? before : [gateOpenedRow(gate, data)],
      next: null,
      ancestors: [],
    }),
    answerGate: () => ({ applied: true }),
  });
  renderApp(<GateCard ws="ws-1" task={task} gate={gate} />, { clock: fixedClock(OPENED) });
  return call;
}

const by = (row: ReturnType<typeof eventRow>, who: string) => ({
  ...row,
  event: { ...row.event, by: who },
});

const QUESTIONS = [
  {
    question: "Which queue library do we use?",
    header: "Library",
    multi_select: false,
    options: [
      { label: "Library A", description: "Same process" },
      { label: "Library B", description: "A separate service" },
    ],
  },
  {
    question: "Which checks must run?",
    header: "Checks",
    multi_select: true,
    options: [
      { label: "Unit tests", description: "Vitest" },
      { label: "E2E", description: "Docker" },
      { label: "Leak check", description: "task leakcheck" },
    ],
  },
];

function answerCalls(call: ReturnType<typeof installBridge>) {
  return call.mock.calls.filter(([method]) => method === "answerGate").map(([, args]) => args);
}

describe("GateCard", () => {
  it("answers a question with an option and the gate version", async () => {
    const gate = makeGate({ version: 2 });
    const call = setup(gate, { data: { text: "Which limit per client?" } });
    await userEvent.click(await screen.findByRole("button", { name: "100/min" }));
    await waitFor(() =>
      expect(answerCalls(call)).toEqual([
        { ws: "ws-1", gate: gate.gate, body: { answer: "100/min", comment: null, version: 2 } },
      ]),
    );
  });

  it("shows full-width options with the recommended one filled (polish-prototype-style)", async () => {
    const gate = makeGate({
      title: "Which queue library?",
      options: ["Library A", "Library B (Recommended)", "Library C"],
    });
    setup(gate, { data: { text: "Which queue library?" } });
    const filled = await screen.findByRole("button", { name: "Library B (Recommended)" });
    expect(filled.className).toContain("MuiButton-contained");
    for (const name of ["Library A", "Library B (Recommended)", "Library C"]) {
      expect(screen.getByRole("button", { name }).className).toContain("MuiButton-fullWidth");
    }
    expect(screen.getByRole("button", { name: "Library A" }).className).toContain(
      "MuiButton-outlined",
    );
    expect(screen.getByRole("button", { name: "Library C" }).className).toContain(
      "MuiButton-outlined",
    );
  });

  it("shows the details of a question above the options, with Show more (gate-context)", async () => {
    const gate = makeGate({ title: "Which queue library?", options: ["Library A", "Library B"] });
    const lines = Array.from({ length: 30 }, (_, i) => `- Run ${i}: A took ${100 + i} ms.`);
    setup(gate, { data: { text: `## Options\n\n${lines.join("\n")}\n\nDETAILS-END` } });
    expect(await screen.findByRole("heading", { name: "Options" })).toBeTruthy();
    const box = getComputedStyle(screen.getByTestId("gate-text"));
    expect([box.maxHeight, box.overflowY]).toEqual(["240px", "hidden"]);
    // The text comes before the option buttons.
    const text = screen.getByTestId("gate-text");
    const button = screen.getByRole("button", { name: "Library A" });
    expect(text.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(getComputedStyle(screen.getByTestId("gate-text")).overflowY).toBe("auto");
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
    expect(screen.queryByTestId("gate-context")).toBeNull();
  });

  it("shows the agent messages since the last person event as Context (gate-context)", async () => {
    const gate = makeGate({
      title: "Which option? (see the gate message above)",
      options: ["a", "b", "c", "d"],
    });
    const analysis =
      "Gate: queue library A or B\n\n1. Solution\nLibrary A runs in the same process.";
    const call = setupContext(
      gate,
      [
        by(eventRow("message.agent", { text: "An old analysis" }, 1), "claude@ubuntu-01"),
        by(eventRow("message.human", { text: "Pick a library" }, 2), "human@macbook-pro"),
        by(eventRow("message.agent", { text: analysis }, 3), "claude@ubuntu-01"),
      ],
      { text: "Which option? (see the gate message above)" },
    );
    const context = await screen.findByTestId("gate-context");
    expect(context.textContent).toContain("Library A runs in the same process.");
    expect(context.textContent).not.toContain("An old analysis");
    expect(screen.queryByTestId("gate-text")).toBeNull();
    // One read of the events just before the gate.
    const reads = call.mock.calls.filter(
      ([m, a]) => m === "thread" && (a as { query?: { before?: string } }).query?.before,
    );
    expect(reads.map(([, a]) => (a as { query: unknown }).query)).toEqual([
      { limit: 200, before: `${(gate.opened as { hlc: string }).hlc}~ubuntu-01~row-${gate.gate}` },
    ]);
  });

  it("reads no context for a question with details (gate-context)", async () => {
    const gate = makeGate({ title: "Which queue library?" });
    const call = setup(gate, { data: { text: "## Options" } });
    expect(await screen.findByRole("heading", { name: "Options" })).toBeTruthy();
    const reads = call.mock.calls.filter(
      ([m, a]) => m === "thread" && (a as { query?: { before?: string } }).query?.before,
    );
    expect(reads).toEqual([]);
  });

  it("shows each option description on its button (gate-context)", async () => {
    const gate = makeGate({ title: "Which color?", options: ["red", "blue"] });
    const call = setup(gate, {
      data: {
        text: "Which color?\nOptions: red | blue",
        questions: [
          {
            ...QUESTIONS[0]!,
            question: "Which color?",
            options: [
              { label: "red", description: "Use red" },
              { label: "blue", description: "Use blue" },
            ],
          },
        ],
      },
    });
    expect(await screen.findByText("Use red")).toBeTruthy();
    const red = screen.getByRole("button", { name: /^red/ });
    expect(red.textContent).toBe("redUse red");
    // The listing of the question is not shown again as a body.
    expect(screen.queryByTestId("gate-text")).toBeNull();
    await userEvent.click(red);
    await waitFor(() => expect(answerCalls(call)[0]).toMatchObject({ body: { answer: "red" } }));
  });

  it("answers 2 questions with one text in the Claude Code format (gate-context)", async () => {
    const gate = makeGate({ title: "Which queue library do we use?", options: [] });
    const call = setup(gate, {
      data: {
        text: "Which queue library do we use?\nOptions: Library A | Library B\n\nWhich checks must run?\nOptions: Unit tests | E2E | Leak check",
        questions: QUESTIONS,
      },
    });
    const list = await screen.findByTestId("gate-questions");
    expect(list.textContent).toContain("Checks");
    expect(list.textContent).toContain("A separate service");
    const send = screen.getByRole("button", { name: "Send answers" });
    expect(send).toHaveProperty("disabled", true);
    await userEvent.click(screen.getByRole("radio", { name: "Library A" }));
    await userEvent.click(screen.getByRole("radio", { name: "Library B" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Leak check" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Unit tests" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "E2E" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "E2E" }));
    expect(screen.getByRole("radio", { name: "Library A" }).getAttribute("aria-checked")).toBe(
      "false",
    );
    await userEvent.click(send);
    await waitFor(() =>
      expect(answerCalls(call)[0]).toMatchObject({
        body: {
          answer:
            '"Which queue library do we use?"="Library B", "Which checks must run?"="Unit tests, Leak check"',
          comment: null,
        },
      }),
    );
    expect(screen.queryByTestId("gate-text")).toBeNull();
  });

  it("answers a question with free text", async () => {
    const call = setup(makeGate());
    await userEvent.type(screen.getByLabelText("Or type your answer"), "500/min for now");
    await userEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    await waitFor(() =>
      expect(answerCalls(call)[0]).toMatchObject({ body: { answer: "500/min for now" } }),
    );
  });

  it("sends the free text with its spaces and line breaks (desktop-shell review 10)", async () => {
    const call = setup(makeGate());
    const field = screen.getByLabelText("Or type your answer");
    await userEvent.type(field, "    indented code");
    await userEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    await waitFor(() =>
      expect(answerCalls(call)[0]).toMatchObject({ body: { answer: "    indented code" } }),
    );
  });

  it("needs a comment to request changes of an approach", async () => {
    const gate = makeGate({
      kind: "confirm_approach",
      title: "Approach v1",
      options: ["Confirm", "Request changes"],
    });
    const call = setup(gate, { data: { text: "1. Add a token bucket" } });
    expect(await screen.findByText("Add a token bucket")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Request changes" }));
    const send = screen.getByRole("button", { name: "Send to agent" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("What must change?"), "Also cover the empty state");
    expect((send as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(send);
    await waitFor(() =>
      expect(answerCalls(call)[0]).toMatchObject({
        body: { answer: "Request changes", comment: "Also cover the empty state" },
      }),
    );
  });

  it("keeps a long approach inside the card with its own scroll (task-view-focus)", async () => {
    const gate = makeGate({ kind: "confirm_approach", title: "Approach v1", options: ["Confirm"] });
    setup(gate, { data: { text: "# Plan\n\nA long approach." } });
    expect(await screen.findByText("A long approach.")).toBeTruthy();
    const box = getComputedStyle(screen.getByTestId("gate-text"));
    expect([box.maxHeight, box.overflowY]).toEqual([`${window.innerHeight / 2}px`, "auto"]);
  });

  it("shows the countdown of Approve command", async () => {
    const gate = makeGate({
      kind: "approve_command",
      title: "Bash: rm -rf build",
      options: ["Allow once", "Allow for this task", "Deny"],
    });
    setup(gate, { now: OPENED + 30_000, data: { text: "Bash: rm -rf build", request_id: "p-1" } });
    expect((await screen.findByRole("timer")).textContent).toBe("Denies in 90 s");
  });

  it("still sends a late Allow after 120 s", async () => {
    const gate = makeGate({
      kind: "approve_command",
      title: "Bash: rm -rf build",
      options: ["Allow once", "Allow for this task", "Deny"],
    });
    const call = setup(gate, { now: OPENED + 130_000 });
    expect(await screen.findByText("Denied after 120 s")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Allow once (late)" }));
    await waitFor(() =>
      expect(answerCalls(call)[0]).toMatchObject({ body: { answer: "Allow once" } }),
    );
  });

  it("shows the sent answer of this device and no buttons", async () => {
    const gate = makeGate({
      answers: [
        {
          event: "e2",
          dev: "macbook-pro",
          hlc: "h",
          by: "human@macbook-pro",
          version: 1,
          answer: "100/min",
          comment: null,
          use: "pending",
        },
      ],
    });
    setup(gate);
    expect(await screen.findByText(/Answer sent: “100\/min”\. ubuntu-01 uses it/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "1000/min" })).toBeNull();
  });

  it("assigns a task from the Assign card", async () => {
    const task = makeTask({
      assignee: null,
      needs_you_lane: true,
      needs_you_reasons: [{ reason: "assign" }],
    });
    const call = installBridge({ assignTask: () => ({ applied: true }) });
    renderApp(<GateCard ws="ws-1" task={task} gate={makeGate({ kind: "assign", options: [] })} />);
    await userEvent.click(await screen.findByRole("button", { name: "claude@ubuntu-01" }));
    await waitFor(() =>
      expect(call.mock.calls.find(([m]) => m === "assignTask")?.[1]).toEqual({
        ws: "ws-1",
        task: task.id,
        assignee: "claude@ubuntu-01",
      }),
    );
  });

  it("assigns the default agent on the first device in one click (review F-38)", async () => {
    const task = makeTask({ assignee: null, needs_you_lane: true });
    const call = installBridge({ assignTask: () => ({ applied: true }) });
    renderApp(<GateCard ws="ws-1" task={task} gate={makeGate({ kind: "assign", options: [] })} />);
    const main = await screen.findByRole("button", { name: "Assign to claude@macbook-pro" });
    // The free-text field shows only after "Other agent…".
    expect(screen.queryByLabelText("Other agent@device")).toBeNull();
    await userEvent.click(main);
    await waitFor(() =>
      expect(call.mock.calls.find(([m]) => m === "assignTask")?.[1]).toEqual({
        ws: "ws-1",
        task: task.id,
        assignee: "claude@macbook-pro",
      }),
    );
  });

  it("keeps Assign off for an agent@device that awd refuses (desktop-shell review 12)", async () => {
    const task = makeTask({ assignee: null, needs_you_lane: true });
    installBridge({ assignTask: () => ({ applied: true }) });
    renderApp(<GateCard ws="ws-1" task={task} gate={makeGate({ kind: "assign", options: [] })} />);
    await userEvent.click(await screen.findByRole("button", { name: "Other agent…" }));
    const field = await screen.findByLabelText("Other agent@device");
    const assign = screen.getByRole("button", { name: "Assign" });
    for (const bad of ["claude@ubuntu-", "claude@ubuntu--01", "claude@-ubuntu"]) {
      await userEvent.clear(field);
      await userEvent.type(field, bad);
      expect((assign as HTMLButtonElement).disabled, bad).toBe(true);
    }
    await userEvent.clear(field);
    await userEvent.type(field, "claude@mac-mini-lab");
    expect((assign as HTMLButtonElement).disabled).toBe(false);
  });
});
