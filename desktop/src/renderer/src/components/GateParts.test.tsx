// The full context of a gate (openspec gate-full-context): no decisions (openspec
// proposal-and-discussion), the result artifacts with Open, the answer notices, the proposal
// versions with their full text and "Waits for you" (0-8), and the thread window with "Show older"
// (0-7).
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { Gate } from "../../../shared/channels.ts";
import { proposalChip } from "../model.ts";
import {
  eventRow,
  FakeCallError,
  gateOpenedRow,
  installBridge,
  makeGate,
  makeTask,
  renderApp,
  type Handlers,
} from "../testing.tsx";
import { GateCard } from "./GateCard.tsx";
import { GateNotice, ProposalVersions } from "./GateParts.tsx";
import { Thread } from "./Thread.tsx";

afterEach(cleanup);

function renderCard(gate: Gate, rows: ReturnType<typeof eventRow>[], handlers: Handlers = {}) {
  const task = makeTask({ gates: [gate], needs_you: [gate.gate] });
  const call = installBridge({
    thread: () => ({
      task: { id: task.id, key: task.key, title: task.title },
      events: rows,
      next: null,
      prev: null,
      ancestors: [],
    }),
    ...handlers,
  });
  renderApp(
    <>
      <GateNotice ws="ws-1" task={task.id} />
      <GateCard ws="ws-1" task={task} gate={gate} />
    </>,
  );
  return { call, task };
}

const argsOf = (call: ReturnType<typeof installBridge>, method: string) =>
  call.mock.calls.filter(([m]) => m === method).map(([, args]) => args);

describe("gate card with old decisions (proposal-and-discussion)", () => {
  // A custom gate from before the change: awd wrote the decisions in `data.decisions` and as a
  // block of the text. The card shows the text as written and the options, and no picker.
  const TEXT =
    "Add a token bucket per API key.\n\n## Decisions\n\n1. Which limit per API key?\n   - 100/min (recommended)\n   - 1000/min";
  const DECISIONS = [
    {
      question: "Which limit per API key?",
      options: ["100/min", "1000/min"],
      recommended: "100/min",
    },
    {
      question: "Where do we keep the counters?",
      options: ["Redis", "In memory"],
      recommended: "Redis",
    },
  ];

  it("shows the text and the options, and no decision picker and no Send my choices", async () => {
    const gate = makeGate({ kind: "custom", options: ["Yes", "Request changes"] });
    renderCard(gate, [gateOpenedRow(gate, { text: TEXT, decisions: DECISIONS })]);
    expect(await screen.findByText("Add a token bucket per API key.")).toBeTruthy();
    expect(screen.getByText("Which limit per API key?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request changes" })).toBeTruthy();
    expect(screen.queryByTestId("gate-decisions")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByText("Where do we keep the counters?")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send my choices" })).toBeNull();
  });
});

describe("result artifacts", () => {
  const gate = makeGate({
    kind: "approve_result",
    title: "Result",
    options: ["Approve", "Request changes"],
    file: "artifacts/ubuntu-01/result-1.md",
  });
  const rows = [
    eventRow("artifact.added", { path: "artifacts/ubuntu-01/shot.png", size: 135, sha256: "a" }, 1),
    eventRow(
      "artifact.added",
      { path: "artifacts/ubuntu-01/report.xml", size: 2048, sha256: "b" },
      2,
    ),
    eventRow(
      "result.posted",
      {
        file: "artifacts/ubuntu-01/result-1.md",
        artifacts: ["artifacts/ubuntu-01/shot.png", "artifacts/ubuntu-01/report.xml"],
      },
      3,
    ),
    gateOpenedRow(gate, { text: "All tests pass.", file: gate.file }),
  ];

  it("lists the artifacts of the result with their sizes and opens one", async () => {
    const { call, task } = renderCard(gate, rows, {
      openTaskArtifact: () => ({ opened: "app", path: "artifacts/ubuntu-01/shot.png" }),
    });
    expect(await screen.findByText("shot.png")).toBeTruthy();
    expect(screen.getByText("report.xml")).toBeTruthy();
    expect(screen.getByText("· 135 B")).toBeTruthy();
    expect(screen.getByText("· 2 KB")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Open" })[0]!);
    await waitFor(() =>
      expect(argsOf(call, "openTaskArtifact")).toEqual([
        { ws: "ws-1", task: task.id, path: "artifacts/ubuntu-01/shot.png" },
      ]),
    );
  });

  it("says when main shows the file in Finder", async () => {
    renderCard(gate, rows, {
      openTaskArtifact: () => ({ opened: "folder", path: "artifacts/ubuntu-01/report.xml" }),
    });
    await userEvent.click((await screen.findAllByRole("button", { name: "Open" }))[1]!);
    expect(await screen.findByText(/It shows report.xml in\s+Finder/)).toBeTruthy();
  });
});

describe("answer notices", () => {
  const gate = makeGate({ kind: "approve_result", options: ["Approve", "Request changes"] });

  it("says that another answer resolved the gate first (gate_not_open)", async () => {
    renderCard(gate, [gateOpenedRow(gate)], {
      answerGate: () => {
        throw new FakeCallError("gate_not_open", "resolved", 409, {
          gate: gate.gate,
          answer: "Approve",
        });
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(
      await screen.findByText(
        "Another answer resolved this gate first: “Approve”. AW did not send your answer.",
      ),
    ).toBeTruthy();
  });

  it("says when awd did not apply the answer, or kept it as a comment", async () => {
    renderCard(gate, [gateOpenedRow(gate)], {
      answerGate: () => ({ applied: false, reason: "stale_version", event: { id: "a1" }, gate }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByText("AW did not use your answer: stale_version.")).toBeTruthy();
    cleanup();
    const late = {
      ...gate,
      answers: [
        {
          event: "a2",
          dev: "macbook-pro",
          hlc: "h",
          by: null,
          version: 1,
          answer: "Approve",
          comment: null,
          use: "comment" as const,
        },
      ],
    };
    renderCard(gate, [gateOpenedRow(gate)], {
      answerGate: () => ({ applied: true, reason: null, event: { id: "a2" }, gate: late }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(
      await screen.findByText("Your answer came after another answer. It is a comment now."),
    ).toBeTruthy();
  });
});

describe("answer notices of a gate that AW closed (stale-gates)", () => {
  const gate = makeGate({
    kind: "approve_command",
    options: ["Allow once", "Allow for this task", "Deny"],
  });

  it("says that AW closed the gate first (gate_not_open with no answer event)", async () => {
    renderCard(gate, [gateOpenedRow(gate)], {
      answerGate: () => {
        throw new FakeCallError("gate_not_open", "resolved", 409, {
          gate: gate.gate,
          answer: "Session ended",
          answer_event: null,
        });
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: /^Allow once/ }));
    expect(
      await screen.findByText(
        "AW closed this gate first: “Session ended”. AW did not send your answer.",
      ),
    ).toBeTruthy();
  });

  it("says that the answer came after AW closed the gate", async () => {
    const closed = {
      ...gate,
      state: "resolved" as const,
      answer: "Session ended",
      answer_event: null,
      resolved_by: "macbook-pro",
      answers: [
        {
          event: "a3",
          dev: "macbook-pro",
          hlc: "h",
          by: null,
          version: 1,
          answer: "Allow once",
          comment: null,
          use: "comment" as const,
        },
      ],
    };
    renderCard(gate, [gateOpenedRow(gate)], {
      answerGate: () => ({ applied: true, reason: null, event: { id: "a3" }, gate: closed }),
    });
    await userEvent.click(await screen.findByRole("button", { name: /^Allow once/ }));
    expect(
      await screen.findByText(
        "Your answer came after AW closed this gate: “Session ended”. It is a comment now.",
      ),
    ).toBeTruthy();
  });
});

describe("answer notice after the card closes", () => {
  // An event of awd can close the gate before the reply of the answer arrives: the card unmounts,
  // and the notice must still show (gate-full-context check, finding R1).
  it("shows the notice of a reply that arrives after the card unmounts", async () => {
    const gate = makeGate({ kind: "approve_result", options: ["Approve", "Request changes"] });
    const task = makeTask({ gates: [gate], needs_you: [gate.gate] });
    let reply: (value: unknown) => void = () => undefined;
    installBridge({
      thread: () => ({
        task: { id: task.id, key: task.key, title: task.title },
        events: [gateOpenedRow(gate)],
        next: null,
        prev: null,
        ancestors: [],
      }),
      answerGate: () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    });
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(false)}>Gate resolved</button>
          <GateNotice ws="ws-1" task={task.id} />
          {open && <GateCard ws="ws-1" task={task} gate={gate} />}
        </>
      );
    }
    renderApp(<Harness />);
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await userEvent.click(screen.getByRole("button", { name: "Gate resolved" }));
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    reply({ applied: false, reason: "stale_version", event: { id: "a1" }, gate });
    expect(await screen.findByText("AW did not use your answer: stale_version.")).toBeTruthy();
  });
});

describe("proposal versions", () => {
  it("shows Waits for you for a version after the approved one (0-8)", () => {
    expect(proposalChip(1, { latest: 2, approved: 1 })).toBe("approved");
    expect(proposalChip(2, { latest: 2, approved: 1 })).toBe("waits");
    expect(proposalChip(1, { latest: 2, approved: null })).toBe("replaced");
    expect(proposalChip(2, { latest: 2, approved: null })).toBe("waits");
    expect(proposalChip(1, { latest: 2, approved: 2 })).toBe("replaced");
  });

  it("opens a version to the full text of its file", async () => {
    const call = installBridge({
      taskFile: (args: { path: string }) => ({
        path: args.path,
        size: 30,
        modified: "2026-11-23T10:00:00.000Z",
        text: "# Proposal v2\n\nFULL-TEXT-END-MARKER",
        reason: null,
      }),
    });
    renderApp(
      <ProposalVersions
        ws="ws-1"
        task="t1"
        proposal={{ latest: 2, approved: 1 }}
        versions={[
          { version: 1, file: "proposal/v1.md", text: "# Proposal v1" },
          { version: 2, file: "proposal/v2.md", text: "# Proposal v2" },
        ]}
      />,
    );
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("Waits for you")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "v2" }));
    expect(await screen.findByText("FULL-TEXT-END-MARKER")).toBeTruthy();
    expect(argsOf(call, "taskFile")).toEqual([
      { ws: "ws-1", task: "t1", path: "tasks/t1/proposal/v2.md" },
    ]);
  });

  it("opens a version from before the rename in its file approach/v<n>.md", async () => {
    const call = installBridge({
      taskFile: (args: { path: string }) => ({
        path: args.path,
        size: 30,
        modified: "2026-11-23T10:00:00.000Z",
        text: "OLD-APPROACH-TEXT",
        reason: null,
      }),
    });
    renderApp(
      <ProposalVersions
        ws="ws-1"
        task="t1"
        proposal={{ latest: 3, approved: null }}
        versions={[{ version: 3, file: "approach/v3.md", text: "# Rate limits" }]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "v3" }));
    expect(await screen.findByText("OLD-APPROACH-TEXT")).toBeTruthy();
    expect(argsOf(call, "taskFile")).toEqual([
      { ws: "ws-1", task: "t1", path: "tasks/t1/approach/v3.md" },
    ]);
  });

  it("says why a version shows no text (finding R7)", async () => {
    installBridge({
      taskFile: (args: { path: string }) => {
        if (args.path.endsWith("v2.md"))
          throw new FakeCallError("not_found", `${args.path} not found`, 404);
        return {
          path: args.path,
          size: 2_000_000,
          modified: "2026-11-23T10:00:00.000Z",
          text: null,
          reason: "too_large",
        };
      },
    });
    renderApp(
      <ProposalVersions
        ws="ws-1"
        task="t1"
        proposal={{ latest: 2, approved: 1 }}
        versions={[
          { version: 1, file: "proposal/v1.md", text: "# Proposal v1" },
          { version: 2, file: "proposal/v2.md", text: "# Proposal v2" },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "v2" }));
    expect(
      await screen.findByText("The file of proposal v2 is not on this device yet."),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "v1" }));
    expect(
      await screen.findByText(
        "The file of proposal v1 is larger than 1 MB. Open it from the workspace folder.",
      ),
    ).toBeTruthy();
  });
});

describe("thread window", () => {
  it("shows the newest events and reads the older page with Show older (0-7)", async () => {
    const all = Array.from({ length: 1100 }, (_, i) =>
      eventRow("message.agent", { text: `Line ${i + 1}`, session: null }, i + 1),
    );
    const cursor = (n: number) => `c${n}`;
    const call = installBridge({
      thread: (args: { query?: { newest?: string; before?: string; limit?: number } }) => {
        const limit = args.query?.limit ?? 200;
        const end = args.query?.before ? Number(args.query.before.slice(1)) - 1 : all.length;
        const start = Math.max(0, end - limit);
        return {
          task: { id: "t", key: "AW-3", title: "Rate limit" },
          events: all.slice(start, end),
          next: null,
          prev: start > 0 ? cursor(start + 1) : null,
          ancestors: [],
        };
      },
    });
    renderApp(<Thread ws="ws-1" task={makeTask()} />);
    expect(await screen.findByText("Line 1100")).toBeTruthy();
    expect(screen.queryByText("Line 600")).toBeNull();
    expect(screen.getByText("Line 601")).toBeTruthy();
    expect(screen.getByText("The thread shows the newest 500 events.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show older" }));
    expect(await screen.findByText("Line 101")).toBeTruthy();
    expect(screen.getByText("Line 1100")).toBeTruthy();
    const queries = argsOf(call, "thread").map((a) => (a as { query: unknown }).query);
    expect(queries).toContainEqual({ limit: 500, newest: "true", ancestors: "true" });
    expect(queries).toContainEqual({ limit: 500, before: "c601" });
  });

  it("starts with one page again for another task (finding R6)", async () => {
    const call = installBridge({
      thread: (args: { task: string; query?: { before?: string } }) => ({
        task: { id: args.task, key: null, title: null },
        events: [eventRow("message.agent", { text: `Newest of ${args.task}`, session: null }, 2)],
        next: null,
        prev: args.query?.before ? null : "c1",
        ancestors: [],
      }),
    });
    function Harness() {
      const [id, setId] = useState("t-a");
      return (
        <>
          <button onClick={() => setId("t-b")}>Other task</button>
          <Thread ws="ws-1" task={makeTask({ id })} />
        </>
      );
    }
    renderApp(<Harness />);
    await userEvent.click(await screen.findByRole("button", { name: "Show older" }));
    await waitFor(() =>
      expect(argsOf(call, "thread")).toContainEqual(
        expect.objectContaining({ task: "t-a", query: { limit: 500, before: "c1" } }),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Other task" }));
    expect((await screen.findAllByText("Newest of t-b")).length).toBeGreaterThan(0);
    const calls = argsOf(call, "thread").filter((a) => (a as { task: string }).task === "t-b");
    expect(calls.map((a) => (a as { query: unknown }).query)).toEqual([
      { limit: 500, newest: "true", ancestors: "true" },
    ]);
  });
});
