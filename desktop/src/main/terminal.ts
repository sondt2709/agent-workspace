// "Open the terminal" and "Sign in" (openspec task-terminal-view; docs/workflow.md 3 and 6). The main
// process reads the terminal route of awd and uses the target of the action: a local tmux session
// or `claude auth login` opens in Terminal.app, a local Orca session opens its worktree in Orca, and
// a session on another device gives the command for the person to run there. This module is the one
// adapter for the programs that the app starts: each one starts with `execFile` and separate
// arguments, never a shell string. Tests give a fake launcher, so no window opens.
import type { DesktopClient } from "@aw/client/desktop";
import type { TerminalTarget } from "@aw/client/terminal";
import { execFile } from "node:child_process";
import type { OpenTerminalResult, TerminalAction } from "../shared/terminal-types.ts";

/** The programs that the app starts on this computer. */
export interface TerminalLauncher {
  /** Opens a new Terminal.app window that runs the argv. */
  inTerminal(argv: string[]): Promise<void>;
  /** Opens the Orca worktree of a session in the Orca app. */
  orcaWorktree(orca: string, worktree: string): Promise<void>;
}

/** A program and its arguments, run with no shell. */
export type ExecFile = (file: string, args: string[]) => Promise<void>;

export const OSASCRIPT = "/usr/bin/osascript";

/**
 * The AppleScript of `inTerminal`. It gets the argv as its run arguments and quotes each one with
 * `quoted form of`, so no argument becomes script text and the shell of Terminal.app gets each
 * argument as one word.
 */
export const TERMINAL_SCRIPT = [
  "on run argv",
  'set cmd to ""',
  "repeat with a in argv",
  'set cmd to cmd & quoted form of (a as text) & " "',
  "end repeat",
  'tell application "Terminal"',
  "activate",
  "do script cmd",
  "end tell",
  "end run",
];

/** The arguments of osascript for an argv: one `-e` per script line, then the argv. */
export function osascriptArgs(argv: string[]): string[] {
  return [...TERMINAL_SCRIPT.flatMap((line) => ["-e", line]), ...argv];
}

/** The arguments of the Orca CLI that open a worktree. */
export function orcaArgs(worktree: string): string[] {
  return ["worktree", "activate", "--worktree", `path:${worktree}`, "--json"];
}

function nodeExecFile(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 15_000 }, (error) => {
      if (error) reject(new Error(`${file} failed: ${error.message}`));
      else resolve();
    });
  });
}

/** The launcher of macOS: osascript for Terminal.app, the Orca CLI for a worktree. */
export function macLauncher(run: ExecFile = nodeExecFile): TerminalLauncher {
  return {
    inTerminal: (argv) => run(OSASCRIPT, osascriptArgs(argv)),
    orcaWorktree: (orca, worktree) => run(orca, orcaArgs(worktree)),
  };
}

/** Runs the target of an action: a local program, or the command for another device. */
export async function openTerminal(
  desktop: Pick<DesktopClient, "terminal">,
  launcher: TerminalLauncher,
  ws: string,
  task: string,
  action: TerminalAction,
): Promise<OpenTerminalResult> {
  const reply = await desktop.terminal(ws, task);
  const target: TerminalTarget | null = action === "attach" ? reply.open : reply.sign_in;
  if (!target) {
    return {
      opened: false,
      device: null,
      command: null,
      text: "The task has no session, so there is no terminal to open.",
    };
  }
  switch (target.kind) {
    case "terminal":
      await launcher.inTerminal(target.argv);
      return { opened: true, via: "terminal", device: target.device, command: target.command };
    case "orca":
      if (target.orca === null) {
        return {
          opened: false,
          device: target.device,
          command: null,
          text: `AW did not find the Orca CLI on this computer. Open the Orca worktree ${target.worktree}.`,
        };
      }
      await launcher.orcaWorktree(target.orca, target.worktree);
      return { opened: true, via: "orca", device: target.device, command: target.command };
    case "copy":
      return {
        opened: false,
        device: target.device,
        command: target.command,
        text: target.text,
      };
  }
}
