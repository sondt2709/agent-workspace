// Activity in 3 row styles (openspec proposal-and-discussion): a question is an agent message with
// its buttons, an answer is a person message, one proposal card with "Approve proposal", a replaced
// version is a line, an AW note shows only in Session, and an open gate of another kind is a card
// at its place in time. The proposal opens in full screen with the text size of the device.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import casesJson from "../../../../../contracts/fixtures/activity/cases.json?raw";
import type { AppSettings, EventRow, Gate, Task } from "../../../shared/channels.ts";
import {
  fixedClock,
  installBridge,
  makeGate,
  makeTask,
  renderApp,
  type Handlers,
} from "../testing.tsx";
import { Thread } from "./Thread.tsx";

afterEach(cleanup);

interface FixtureRow {
  id: string;
  type: string;
  dev: string;
  by: string;
  hlc: string;
  data: Record<string, unknown>;
}
const FIXTURE = JSON.parse(casesJson) as { threads: { name: string; rows: FixtureRow[] }[] };

function row(r: FixtureRow): EventRow {
  return {
    id: r.id,
    task: "t",
    hlc: r.hlc,
    dev: r.dev,
    type: r.type,
    path: `tasks/t/log/${r.dev}.jsonl`,
    line: 1,
    applied: true,
    reason: null,
    event: { v: 1, id: r.id, hlc: r.hlc, dev: r.dev, type: r.type, by: r.by, data: r.data },
  };
}

const thread = (name: string) =>
  FIXTURE.threads.find((t) => t.name.startsWith(name))!.rows.map(row);

/** The gate view of a `gate.opened` row of the fixture. */
function gateOf(opened: EventRow, more: Partial<Gate> = {}): Gate {
  const d = opened.event.data;
  return makeGate({
    gate: String(d.gate),
    kind: String(d.kind),
    title: String(d.title),
    options: (d.options as string[]) ?? [],
    file: typeof d.file === "string" ? d.file : null,
    opened: { event: opened.id, dev: opened.dev, hlc: opened.hlc },
    ...more,
  });
}

const settings = (px: number): AppSettings => ({
  appearance: "system",
  proposal_text_px: px,
  login: { supported: false, open: false, status: null },
  notifications: false,
  notification_error: null,
});

function show(
  events: EventRow[],
  gates: Gate[],
  options: { mode?: "activity" | "session"; handlers?: Handlers; task?: Partial<Task> } = {},
) {
  const task = makeTask({ key: "AW-12", title: "Rate limits", gates, ...options.task });
  const call = installBridge({
    thread: () => ({
      task: { id: task.id, key: task.key, title: task.title },
      events,
      next: null,
      ancestors: [],
    }),
    answerGate: () => ({ applied: true }),
    ...options.handlers,
  });
  const result = renderApp(<Thread ws="ws-1" task={task} mode={options.mode ?? "activity"} />, {
    clock: fixedClock(Date.parse("2026-11-26T10:30:00.000Z")),
  });
  return { call, task, ...result };
}

const argsOf = (call: ReturnType<typeof installBridge>, method: string) =>
  call.mock.calls.filter(([m]) => m === method).map(([, args]) => args);

describe("questions as messages", () => {
  it("shows an open question as an agent message with its buttons and no opened line", async () => {
    const [message, opened] = thread("question, answer");
    const gate = gateOf(opened!);
    const { call } = show([message!, opened!], [gate]);
    const question = await screen.findByRole("article", {
      name: "Question: Where do the counters live?",
    });
    expect(within(question).getByText("Where do the counters live?").tagName).toBe("P");
    expect(within(question).getByText("Waits for your reply")).toBeTruthy();
    expect(within(question).getByText(/Redis: one counter for all pods/)).toBeTruthy();
    expect(within(question).getByText("Or write your answer in the message box.")).toBeTruthy();
    expect(screen.queryByText(/opened/)).toBeNull();
    await userEvent.click(within(question).getByRole("button", { name: "Redis" }));
    await waitFor(() =>
      expect(argsOf(call, "answerGate")).toEqual([
        { ws: "ws-1", gate: gate.gate, body: { answer: "Redis", comment: null, version: 1 } },
      ]),
    );
  });

  it("shows the answer as a person message, a replaced question with its note, and buttons only on the open one", async () => {
    const rows = thread("question, answer");
    const gates = [
      gateOf(rows[1]!, { state: "resolved", answer: "Redis", answer_event: "e3" }),
      gateOf(rows[4]!, { state: "resolved", answer: "Replaced by a newer question" }),
      gateOf(rows[6]!),
    ];
    const { container } = show(rows, gates);
    const activity = await screen.findByRole("region", { name: "Activity" });
    const questions = within(activity).getAllByTestId("question-message");
    expect(questions).toHaveLength(3);
    expect(within(questions[0]!).queryAllByRole("button")).toEqual([]);
    expect(within(questions[1]!).getByText("Replaced by a newer question")).toBeTruthy();
    expect(within(questions[1]!).queryAllByRole("button")).toEqual([]);
    expect(within(questions[2]!).getByRole("button", { name: "Yes" })).toBeTruthy();
    expect(within(activity).getAllByText("Waits for your reply")).toHaveLength(1);
    // The answer is a person message after the question, with its comment as Markdown.
    const answer = within(activity).getByText(/· answer · /).parentElement!;
    expect(answer.textContent).toContain("Redis");
    expect(within(answer).getByText("session").tagName).toBe("STRONG");
    expect(
      questions[0]!.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // No "resolved" line: a resolution shows only in Session.
    expect(container.textContent).not.toContain("resolved the gate");
  });
});

describe("one proposal", () => {
  it("shows a replaced version as a line and one card, approved by the person", async () => {
    const rows = thread("one proposal:");
    const gates = [
      gateOf(rows[1]!, { state: "resolved", answer: "Replaced by proposal v2" }),
      gateOf(rows[5]!, { state: "resolved", answer: "Approve", answer_event: "e7" }),
    ];
    show(rows, gates);
    const activity = await screen.findByRole("region", { name: "Activity" });
    expect(within(activity).getByText(/^Proposal v1 · replaced by v2 · /)).toBeTruthy();
    expect(within(activity).getAllByTestId("proposal-card")).toHaveLength(1);
    const card = within(activity).getByRole("article", { name: "Proposal v2" });
    expect(within(card).getByText("Approved by human@macbook-pro")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Approve proposal" })).toBeNull();
    expect(within(card).queryByText("Waits for your approval")).toBeNull();
    expect(
      within(activity).getByText(/^Proposal v2 approved by human@macbook-pro · /),
    ).toBeTruthy();
    // The discussion message of the person stays in its place.
    expect(within(activity).getByText("Also send Retry-After.")).toBeTruthy();
  });

  it("approves an open proposal with the answer Approve and the gate version", async () => {
    const rows = thread("an open proposal waits");
    const gate = gateOf(rows[1]!, { version: 3 });
    const { call } = show(rows, [gate]);
    const card = await screen.findByRole("article", { name: "Proposal v3" });
    expect(within(card).getByText("Waits for your approval")).toBeTruthy();
    expect(within(card).getByText("To change it, write a message.")).toBeTruthy();
    expect(card.getAttribute("data-needs-you")).toBe("true");
    await userEvent.click(within(card).getByRole("button", { name: "Approve proposal" }));
    await waitFor(() =>
      expect(argsOf(call, "answerGate")).toEqual([
        { ws: "ws-1", gate: gate.gate, body: { answer: "Approve", comment: null, version: 3 } },
      ]),
    );
  });

  it("shows the text of the proposal file, and the gate text while the file is not here", async () => {
    const rows = thread("an open proposal waits");
    const gate = gateOf(rows[1]!);
    const { call } = show(rows, [gate], {
      handlers: {
        taskFile: (args: { path: string }) => ({
          path: args.path,
          size: 40,
          modified: "2026-11-26T10:01:00.000Z",
          text: "# Rate limits\n\nFULL-PROPOSAL-TEXT",
          reason: null,
        }),
      },
    });
    expect(await screen.findByText("FULL-PROPOSAL-TEXT")).toBeTruthy();
    expect(argsOf(call, "taskFile")).toContainEqual({
      ws: "ws-1",
      task: makeTask().id,
      path: `tasks/${makeTask().id}/proposal/v3.md`,
    });
    cleanup();
    show(rows, [gate]);
    expect(await screen.findByRole("heading", { name: "Rate limits" })).toBeTruthy();
  });

  it("shows the first 240 px of a long proposal and Show more, with no scroll box", async () => {
    const rows = thread("an open proposal waits");
    const long = Array.from({ length: 60 }, (_, i) => `- Line ${i + 1}`).join("\n");
    rows[1]!.event.data = { ...rows[1]!.event.data, text: long };
    show(rows, [gateOf(rows[1]!)]);
    const card = await screen.findByRole("article", { name: "Proposal v3" });
    const box = within(card).getByTestId("gate-text");
    expect([getComputedStyle(box).maxHeight, getComputedStyle(box).overflowY]).toEqual([
      "240px",
      "hidden",
    ]);
    await userEvent.click(within(card).getByRole("button", { name: "Show more" }));
    expect([getComputedStyle(box).maxHeight, getComputedStyle(box).overflowY]).toEqual([
      "none",
      "visible",
    ]);
    expect(within(card).getAllByRole("listitem")).toHaveLength(60);
  });

  it("uses the text size of the device in the card", async () => {
    const rows = thread("an open proposal waits");
    show(rows, [gateOf(rows[1]!)], { handlers: { appSettings: () => settings(20) } });
    const card = await screen.findByRole("article", { name: "Proposal v3" });
    await waitFor(() =>
      expect(
        getComputedStyle(within(card).getByTestId("gate-text").firstElementChild!).fontSize,
      ).toBe("20px"),
    );
  });
});

describe("proposal in full screen", () => {
  it("opens with the task, saves A+ as the size of the device, and closes with Esc", async () => {
    const rows = thread("an open proposal waits");
    let px = 20;
    const { call } = show(rows, [gateOf(rows[1]!)], {
      handlers: {
        appSettings: () => settings(px),
        setProposalTextSize: (args: { px: number }) => {
          px = args.px;
          return settings(px);
        },
      },
    });
    const card = await screen.findByRole("article", { name: "Proposal v3" });
    await userEvent.click(
      within(card).getByRole("button", { name: "Open the proposal in full screen" }),
    );
    const view = await screen.findByRole("dialog", { name: "Proposal v3" });
    expect(within(view).getByText(/^AW-12 · Rate limits · claude@ubuntu-01 · /)).toBeTruthy();
    expect(within(view).getByRole("button", { name: "Approve proposal" })).toBeTruthy();
    expect(within(view).getByRole("button", { name: "Discuss" })).toBeTruthy();
    const size = within(view).getByRole("group", { name: "Text size" });
    await waitFor(() => expect(within(size).getByRole("status").textContent).toBe("20 px"));
    await userEvent.click(within(size).getByRole("button", { name: "Larger text" }));
    await userEvent.click(within(size).getByRole("button", { name: "Larger text" }));
    await waitFor(() => expect(within(size).getByRole("status").textContent).toBe("24 px"));
    expect(argsOf(call, "setProposalTextSize")).toEqual([{ px: 22 }, { px: 24 }]);
    // The limit: A+ is off at 24 px.
    expect(within(size).getByRole("button", { name: "Larger text" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      getComputedStyle(within(view).getByTestId("proposal-full-text").firstElementChild!).fontSize,
    ).toBe("24px");
    // The card uses the new size too.
    expect(
      getComputedStyle(within(card).getByTestId("gate-text").firstElementChild!).fontSize,
    ).toBe("24px");
    // The focus goes to A− when A+ turns off, so Esc still reaches the dialog.
    expect(document.activeElement).toBe(within(size).getByRole("button", { name: "Smaller text" }));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("has no Approve proposal after the approval, and A− stops at 14 px", async () => {
    const rows = thread("one proposal:");
    const gates = [
      gateOf(rows[1]!, { state: "resolved", answer: "Replaced by proposal v2" }),
      gateOf(rows[5]!, { state: "resolved", answer: "Approve", answer_event: "e7" }),
    ];
    show(rows, gates, { handlers: { appSettings: () => settings(14) } });
    const card = await screen.findByRole("article", { name: "Proposal v2" });
    await userEvent.click(
      within(card).getByRole("button", { name: "Open the proposal in full screen" }),
    );
    const view = await screen.findByRole("dialog", { name: "Proposal v2" });
    expect(within(view).queryByRole("button", { name: "Approve proposal" })).toBeNull();
    await waitFor(() =>
      expect(within(view).getByRole("button", { name: "Smaller text" })).toHaveProperty(
        "disabled",
        true,
      ),
    );
    await userEvent.click(within(view).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("other rows", () => {
  it("keeps a note of AW out of Activity and shows it in Session", async () => {
    const note: EventRow = row({
      id: "n1",
      type: "comment.added",
      dev: "macbook-pro",
      by: "aw@macbook-pro",
      hlc: "2026-11-26T10:20:00.000Z#0000",
      data: { text: "Context compacted at 10:51 UTC." },
    });
    const [message] = thread("question, answer");
    show([message!, note], []);
    expect(await screen.findByText("I read the gateway.")).toBeTruthy();
    expect(screen.queryByText("Context compacted at 10:51 UTC.")).toBeNull();
    cleanup();
    show([message!, note], [], { mode: "session" });
    expect(await screen.findByText("Context compacted at 10:51 UTC.")).toBeTruthy();
  });

  it("shows an open gate of another kind as its card at its place in time", async () => {
    const [opened] = thread("an open gate of another kind");
    const before = row({
      id: "m1",
      type: "message.agent",
      dev: "ubuntu-01",
      by: "claude@ubuntu-01",
      hlc: "2026-11-26T10:03:00.000Z#0000",
      data: { text: "BEFORE-THE-GATE", source: "tool" },
    });
    const after = row({
      id: "m2",
      type: "message.agent",
      dev: "ubuntu-01",
      by: "claude@ubuntu-01",
      hlc: "2026-11-26T10:05:00.000Z#0000",
      data: { text: "AFTER-THE-GATE", source: "tool" },
    });
    show([before, opened!, after], [gateOf(opened!)]);
    const card = await screen.findByTestId("gate-card");
    expect(within(card).getByRole("button", { name: "Approve" })).toBeTruthy();
    const first = screen.getByText("BEFORE-THE-GATE");
    const last = screen.getByText("AFTER-THE-GATE");
    expect(first.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows an open gate whose gate.opened is older than the page after the rows", async () => {
    const [message] = thread("question, answer");
    show([message!], [makeGate({ title: "Which limit per client?" })]);
    const activity = await screen.findByRole("region", { name: "Activity" });
    const question = within(activity).getByTestId("question-message");
    expect(within(question).getByRole("button", { name: "100/min" })).toBeTruthy();
    expect(activity.lastElementChild).toBe(question);
  });
});
