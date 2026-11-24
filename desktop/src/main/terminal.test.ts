// Tests of "Open the terminal" and "Sign in" (openspec task-terminal-view) with a fake launcher and
// a fake execFile: the exact arguments for a local tmux session, a local Orca session, the sign-in,
// and no program for a remote device. No window opens.
import type { TerminalReply, TerminalTarget } from "@aw/client/terminal";
import { describe, expect, it, vi } from "vitest";
import { dispatchCall, type CallDeps } from "./calls.ts";
import {
  macLauncher,
  openTerminal,
  orcaArgs,
  OSASCRIPT,
  osascriptArgs,
  TERMINAL_SCRIPT,
  type TerminalLauncher,
} from "./terminal.ts";

const TASK = "01a2038e-7f00-70eb-b429-fa86d481c263";
const TMUX = ["/opt/homebrew/bin/tmux", "-L", "aw", "attach", "-t", `aw:aw-${TASK}`];

function reply(open: TerminalTarget | null, signIn: TerminalTarget | null): TerminalReply {
  return {
    task: TASK,
    session: null,
    snapshot: null,
    note: null,
    open,
    sign_in: signIn,
  };
}

function fakes(value: TerminalReply) {
  const terminal = vi.fn<(ws: string, task: string) => Promise<TerminalReply>>(() =>
    Promise.resolve(value),
  );
  const launcher = {
    inTerminal: vi.fn<(argv: string[]) => Promise<void>>(() => Promise.resolve()),
    orcaWorktree: vi.fn<(orca: string, worktree: string) => Promise<void>>(() => Promise.resolve()),
  } satisfies TerminalLauncher;
  return { desktop: { terminal }, launcher };
}

describe("openTerminal", () => {
  it("opens Terminal.app with tmux attach for a local tmux session", async () => {
    const local: TerminalTarget = {
      kind: "terminal",
      device: "macbook-pro",
      local: true,
      argv: TMUX,
      command: TMUX.join(" "),
    };
    const { desktop, launcher } = fakes(reply(local, null));
    const result = await openTerminal(desktop, launcher, "-", "AW-12", "attach");
    expect(desktop.terminal).toHaveBeenCalledWith("-", "AW-12");
    expect(launcher.inTerminal).toHaveBeenCalledWith(TMUX);
    expect(launcher.orcaWorktree).not.toHaveBeenCalled();
    expect(result).toEqual({
      opened: true,
      via: "terminal",
      device: "macbook-pro",
      command: TMUX.join(" "),
    });
  });

  it("opens the Orca worktree of a local Orca session", async () => {
    const orca: TerminalTarget = {
      kind: "orca",
      device: "macbook-pro",
      local: true,
      orca: "/Applications/Orca.app/Contents/Resources/bin/orca",
      worktree: "/w/aw-task",
      command: "orca worktree activate --worktree path:/w/aw-task",
    };
    const { desktop, launcher } = fakes(reply(orca, null));
    const result = await openTerminal(desktop, launcher, "-", "AW-12", "attach");
    expect(launcher.orcaWorktree).toHaveBeenCalledWith(
      "/Applications/Orca.app/Contents/Resources/bin/orca",
      "/w/aw-task",
    );
    expect(launcher.inTerminal).not.toHaveBeenCalled();
    expect(result).toMatchObject({ opened: true, via: "orca" });
  });

  it("starts no program for a remote device and gives the command", async () => {
    const remote: TerminalTarget = {
      kind: "copy",
      device: "ubuntu-01",
      local: false,
      command: `ssh -t ubuntu-01 tmux -L aw attach -t aw:aw-${TASK}`,
      text: "Run this command to open the terminal of ubuntu-01:",
    };
    const { desktop, launcher } = fakes(reply(remote, null));
    const result = await openTerminal(desktop, launcher, "-", "AW-12", "attach");
    expect(launcher.inTerminal).not.toHaveBeenCalled();
    expect(launcher.orcaWorktree).not.toHaveBeenCalled();
    expect(result).toEqual({
      opened: false,
      device: "ubuntu-01",
      command: `ssh -t ubuntu-01 tmux -L aw attach -t aw:aw-${TASK}`,
      text: "Run this command to open the terminal of ubuntu-01:",
    });
  });

  it("runs claude auth login in Terminal.app for Sign in on this computer", async () => {
    const argv = ["/usr/local/bin/claude", "auth", "login"];
    const signIn: TerminalTarget = {
      kind: "terminal",
      device: "macbook-pro",
      local: true,
      argv,
      command: argv.join(" "),
    };
    const { desktop, launcher } = fakes(reply(null, signIn));
    await openTerminal(desktop, launcher, "-", "AW-12", "sign_in");
    expect(launcher.inTerminal).toHaveBeenCalledWith(argv);
  });

  it("says so for a task with no session", async () => {
    const { desktop, launcher } = fakes(reply(null, null));
    const result = await openTerminal(desktop, launcher, "-", "AW-12", "attach");
    expect(result).toMatchObject({ opened: false, command: null });
    expect(launcher.inTerminal).not.toHaveBeenCalled();
  });
});

describe("macLauncher", () => {
  it("runs osascript with the script lines and then each argument as its own argument", async () => {
    const run = vi.fn<(file: string, args: string[]) => Promise<void>>(() => Promise.resolve());
    // An argument with a quote and a space stays one argument after the script.
    const argv = [...TMUX.slice(0, 5), `aw:it's a window`];
    await macLauncher(run).inTerminal(argv);
    expect(run).toHaveBeenCalledWith(OSASCRIPT, osascriptArgs(argv));
    const args = run.mock.calls[0]![1];
    expect(args.slice(0, TERMINAL_SCRIPT.length * 2)).toEqual(
      TERMINAL_SCRIPT.flatMap((line) => ["-e", line]),
    );
    expect(args.slice(TERMINAL_SCRIPT.length * 2)).toEqual(argv);
    // No argument goes into the script text.
    expect(TERMINAL_SCRIPT.join("\n")).not.toContain("aw:");
    expect(TERMINAL_SCRIPT).toContain('set cmd to cmd & quoted form of (a as text) & " "');
  });

  it("runs the Orca CLI with worktree activate", async () => {
    const run = vi.fn<(file: string, args: string[]) => Promise<void>>(() => Promise.resolve());
    await macLauncher(run).orcaWorktree("/bin/orca", "/w/aw task");
    expect(run).toHaveBeenCalledWith("/bin/orca", orcaArgs("/w/aw task"));
    expect(orcaArgs("/w/aw task")).toEqual([
      "worktree",
      "activate",
      "--worktree",
      "path:/w/aw task",
      "--json",
    ]);
  });
});

describe("bridge calls", () => {
  it("dispatches openTerminal and terminal through the main process", async () => {
    const local: TerminalTarget = {
      kind: "terminal",
      device: "macbook-pro",
      local: true,
      argv: TMUX,
      command: TMUX.join(" "),
    };
    const { desktop, launcher } = fakes(reply(local, null));
    const deps = { desktop, terminal: launcher } as unknown as CallDeps;
    const opened = await dispatchCall(
      { method: "openTerminal", args: { ws: "-", task: "AW-12", action: "attach" } },
      deps,
    );
    expect(opened).toMatchObject({ ok: true, value: { opened: true } });
    expect(launcher.inTerminal).toHaveBeenCalledWith(TMUX);
    const read = await dispatchCall({ method: "terminal", args: { ws: "-", task: "AW-12" } }, deps);
    expect(read).toMatchObject({ ok: true, value: { task: TASK } });
    const bad = await dispatchCall(
      { method: "openTerminal", args: { ws: "-", task: "AW-12", action: "rm -rf" } },
      deps,
    );
    expect(bad).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});
