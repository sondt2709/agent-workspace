// The terminal route (openspec task-terminal-view): the newest terminal snapshot of a task, and how
// the person opens the terminal of its session and signs in on its device. awd checks its reply with
// this schema and generates contracts/openapi.yaml from it. The renderer imports only the types.
import { z } from "zod";

/** A program that the desktop app starts on this device (exec-form: no shell). */
export interface TerminalTargetLocal {
  kind: "terminal";
  device: string;
  local: true;
  /** The program and its arguments, for example `/opt/homebrew/bin/tmux -L aw attach -t aw:aw-<task>`. */
  argv: string[];
  /** The same command as text, for a person to read. */
  command: string;
}

/** The Orca worktree of a local Orca session. */
export interface TerminalTargetOrca {
  kind: "orca";
  device: string;
  local: true;
  /** The Orca CLI binary, or null when awd did not find it. */
  orca: string | null;
  worktree: string;
  command: string;
}

/** A command for the person to run on another device, or null (an Orca session there). */
export interface TerminalTargetCopy {
  kind: "copy";
  device: string;
  local: false;
  command: string | null;
  /** The instruction, for example "Run this command on ubuntu-01". */
  text: string;
}

export type TerminalTarget = TerminalTargetLocal | TerminalTargetOrca | TerminalTargetCopy;

export interface TerminalSnapshotView {
  device: string;
  /** Null for a file with no valid header. */
  session: string | null;
  host: string | null;
  /** ISO time of the capture, or null for a file with no valid header. */
  captured_at: string | null;
  text: string;
}

export interface TerminalReply {
  task: string;
  session: {
    session: string;
    device: string;
    host: string;
    state: "running" | "ended";
    /** True when the session is on this device. */
    local: boolean;
  } | null;
  snapshot: TerminalSnapshotView | null;
  /** "AW does not read the screen of an Orca session. …", "No terminal snapshot yet.", or null. */
  note: string | null;
  /** How the person opens the terminal of the session, or null with no session. */
  open: TerminalTarget | null;
  /** How the person runs `claude auth login` on the session device, or null with no session. */
  sign_in: TerminalTarget | null;
}

const target = z
  .discriminatedUnion("kind", [
    z.looseObject({
      kind: z.literal("terminal"),
      device: z.string(),
      local: z.literal(true),
      argv: z.array(z.string()).min(1),
      command: z.string(),
    }),
    z.looseObject({
      kind: z.literal("orca"),
      device: z.string(),
      local: z.literal(true),
      orca: z.string().nullable(),
      worktree: z.string(),
      command: z.string(),
    }),
    z.looseObject({
      kind: z.literal("copy"),
      device: z.string(),
      local: z.literal(false),
      command: z.string().nullable(),
      text: z.string(),
    }),
  ])
  .nullable();

export const terminalReply = z
  .looseObject({
    task: z.string(),
    session: z
      .looseObject({
        session: z.string(),
        device: z.string(),
        host: z.string(),
        state: z.enum(["running", "ended"]),
        local: z.boolean(),
      })
      .nullable(),
    snapshot: z
      .looseObject({
        device: z.string(),
        session: z.string().nullable(),
        host: z.string().nullable(),
        captured_at: z.string().nullable(),
        text: z.string().describe("The screen; each credential value is [redacted:<name>]"),
      })
      .nullable(),
    note: z.string().nullable(),
    open: target.describe("How the person opens the terminal of the session"),
    sign_in: target.describe("How the person runs claude auth login on the session device"),
  })
  .meta({ id: "Terminal" });
