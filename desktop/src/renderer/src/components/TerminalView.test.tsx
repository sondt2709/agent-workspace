// The Terminal tab, "Open the terminal" on "Take over terminal" and "Sign in" on a login_expired
// pause (openspec task-terminal-view). The bridge is a fake: no program starts.
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenTerminalResult, Task, TerminalReply } from "../../../shared/channels.ts";
import { gateOpenedRow, installBridge, makeGate, makeTask, renderApp } from "../testing.tsx";
import { DialogsProvider } from "./dialogs.tsx";
import { GateCard } from "./GateCard.tsx";
import { TaskDetail } from "./TaskDetail.tsx";

afterEach(cleanup);

const TASK = "0193a000-0000-7000-8000-0000000000aa";
const COMMAND = `ssh -t ubuntu-01 tmux -L aw attach -t aw:aw-${TASK}`;
const remote: TerminalReply = {
  task: TASK,
  session: {
    session: "0193a000-0000-7000-8000-0000000000bb",
    device: "ubuntu-01",
    host: "tmux",
    state: "running",
    local: false,
  },
  snapshot: {
    device: "ubuntu-01",
    session: "0193a000-0000-7000-8000-0000000000bb",
    host: "tmux",
    captured_at: "2026-11-23T09:57:00.000Z",
    text: "● I used the key [redacted:staging-api-key] for the staging call.\n❯ ",
  },
  note: null,
  open: {
    kind: "copy",
    device: "ubuntu-01",
    local: false,
    command: COMMAND,
    text: "Run this command to open the terminal of ubuntu-01:",
  },
  sign_in: {
    kind: "copy",
    device: "ubuntu-01",
    local: false,
    command: "ssh -t ubuntu-01 claude auth login",
    text: "Run this command to sign in to Claude on ubuntu-01:",
  },
};

function detail(task: Task, terminal: TerminalReply, open?: (args: unknown) => unknown) {
  const call = installBridge({
    task: () => task,
    tasks: () => [task],
    terminal: () => terminal,
    openTerminal: open ?? (() => ({ opened: false, device: null, command: null, text: "-" })),
  });
  renderApp(
    <DialogsProvider ws="ws-1">
      <TaskDetail ws="ws-1" taskId={task.id} />
    </DialogsProvider>,
  );
  return call;
}

describe("Terminal tab", () => {
  it("shows the snapshot of ubuntu-01 with its device and time, and the command to copy", async () => {
    detail(makeTask(), remote, () => ({
      opened: false,
      device: "ubuntu-01",
      command: COMMAND,
      text: "Run this command to open the terminal of ubuntu-01:",
    }));
    await userEvent.click(await screen.findByRole("tab", { name: "Terminal" }));
    const view = await screen.findByTestId("terminal-view");
    expect(within(view).getByTestId("terminal-snapshot").textContent).toBe(
      "● I used the key [redacted:staging-api-key] for the staging call.\n❯ ",
    );
    expect(within(view).getByText(/^Captured .* on ubuntu-01 · 3 min ago$/)).toBeTruthy();
    await userEvent.click(within(view).getByRole("button", { name: "Open the terminal" }));
    expect((await within(view).findByTestId("terminal-command")).textContent).toBe(COMMAND);
    expect(
      within(view).getByText("Run this command to open the terminal of ubuntu-01:"),
    ).toBeTruthy();
  });

  it("shows the empty state and the Orca note", async () => {
    detail(makeTask(), {
      ...remote,
      snapshot: null,
      note: "No terminal snapshot yet. A tmux session writes one at most every 30 s when its screen changes, and at each gate.",
    });
    await userEvent.click(await screen.findByRole("tab", { name: "Terminal" }));
    expect(await screen.findByText(/^No terminal snapshot yet\./)).toBeTruthy();
    cleanup();
    detail(makeTask(), {
      ...remote,
      snapshot: null,
      note: `AW does not read the screen of an Orca session. Open the Orca worktree aw-${TASK} on ubuntu-01.`,
    });
    await userEvent.click(await screen.findByRole("tab", { name: "Terminal" }));
    expect(
      await screen.findByText(/^AW does not read the screen of an Orca session\./),
    ).toBeTruthy();
  });
});

describe("Open the terminal and Sign in", () => {
  it("has Open the terminal on the Take over terminal card, and shows Opened in Terminal", async () => {
    const gate = makeGate({
      kind: "take_over_terminal",
      title: "Take over terminal",
      options: ["Resume again", "Leave it stopped"],
    });
    const task = makeTask({ gates: [gate], owner: "macbook-pro" });
    const opened: OpenTerminalResult = {
      opened: true,
      via: "terminal",
      device: "macbook-pro",
      command: `/opt/homebrew/bin/tmux -L aw attach -t aw:aw-${TASK}`,
    };
    const call = installBridge({
      thread: () => ({
        task: { id: task.id, key: task.key, title: task.title },
        events: [gateOpenedRow(gate, { text: "Resume failed." })],
        next: null,
        ancestors: [],
      }),
      openTerminal: () => opened,
    });
    renderApp(<GateCard ws="ws-1" task={task} gate={gate} />);
    await userEvent.click(await screen.findByRole("button", { name: "Open the terminal" }));
    expect(await screen.findByText(/^Opened in Terminal/)).toBeTruthy();
    expect(call).toHaveBeenCalledWith("openTerminal", { ws: "ws-1", task: TASK, action: "attach" });
    // The gate options stay: "Open the terminal" is not an answer.
    expect(screen.getByRole("button", { name: "Resume again" })).toBeTruthy();
  });

  it("has no Open the terminal on another gate", async () => {
    const gate = makeGate({ kind: "question", options: ["eu", "us"] });
    installBridge({});
    renderApp(<GateCard ws="ws-1" task={makeTask({ gates: [gate] })} gate={gate} />);
    expect(await screen.findByRole("button", { name: "eu" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open the terminal" })).toBeNull();
  });

  it("has Sign in on a login_expired pause, which runs the sign_in action", async () => {
    const task = makeTask({
      paused: {
        cause: "login_expired",
        since: "2026-11-23T09:00:00.000Z",
        resumes_at: null,
        next_step:
          "Login expired on ubuntu-01. Sign in: run `claude auth login` in a terminal on ubuntu-01.",
        needs_human: true,
      },
    });
    const call = detail(task, remote, () => ({
      opened: false,
      device: "ubuntu-01",
      command: "ssh -t ubuntu-01 claude auth login",
      text: "Run this command to sign in to Claude on ubuntu-01:",
    }));
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(call).toHaveBeenCalledWith("openTerminal", {
      ws: "ws-1",
      task: TASK,
      action: "sign_in",
    });
    expect((await screen.findByTestId("terminal-command")).textContent).toBe(
      "ssh -t ubuntu-01 claude auth login",
    );
  });

  it("keeps the Sign in card of a login_expired pause above the Terminal tab", async () => {
    const task = makeTask({
      paused: {
        cause: "login_expired",
        since: "2026-11-23T09:00:00.000Z",
        resumes_at: null,
        next_step: "Login expired on ubuntu-01.",
        needs_human: true,
      },
    });
    detail(task, remote);
    await userEvent.click(await screen.findByRole("tab", { name: "Terminal" }));
    expect(await screen.findByTestId("terminal-view")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("has no Sign in on another pause", async () => {
    const task = makeTask({
      paused: {
        cause: "usage_limit",
        since: "2026-11-23T09:00:00.000Z",
        resumes_at: "2026-11-23T14:00:00.000Z",
        next_step: "Claude Code continues at the reset.",
        needs_human: false,
      },
    });
    detail(task, remote);
    expect(await screen.findByText(/Claude Code continues at the reset\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });
});
