// The terminal view of a task (openspec task-terminal-view): the newest snapshot file of
// `tasks/<task>/terminal/`, a note for an Orca session, and the targets of "Open the terminal" and
// "Sign in". The route and `aw terminal` call it. A local target is an argv for the desktop app; a
// target on another device is a command for the person to run there.
import type { TerminalReply, TerminalTarget } from "@aw/client/terminal";
import { constants, type Dirent } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { LocalTerminal } from "../sessions/manager.ts";
import { newestSnapshot, SNAPSHOT_NAME } from "../sessions/terminal-snapshot.ts";
import type { WorkspaceService } from "./workspace.ts";

/** The parts of the session service that the view uses. */
export interface TerminalSessions {
  localTerminal(workspace: string, task: string): Promise<LocalTerminal | null>;
  readonly claude: string;
  /** The tmux socket name of this device (`AW_TMUX_SOCKET`). */
  readonly tmuxSocket: string;
}

/** The default tmux socket name of a device (`AW_TMUX_SOCKET`). */
const DEFAULT_SOCKET = "aw";

/** A shell word: plain when it has only safe characters, else in single quotes. */
export function shellWord(word: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

export function commandText(argv: string[]): string {
  return argv.map(shellWord).join(" ");
}

/** The largest snapshot file that the view reads: the 64 KiB screen, the header and some room. */
export const MAX_SNAPSHOT_FILE_BYTES = 128 * 1024;

/** The text of a regular file, or null for a link, another file type or a file that is too large. */
async function readSnapshotFile(path: string): Promise<string | null> {
  // O_NOFOLLOW: a synced link to a private file is never read, also when it replaces the file
  // between the list and the open.
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_FILE_BYTES) return null;
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

/**
 * The snapshot files of a task: `<device>.txt` → content. The view reads only regular files whose
 * name is a device slug: it skips links, conflict copies, temp files and large files.
 */
async function snapshotFiles(ws: WorkspaceService, task: string): Promise<Record<string, string>> {
  const folder = join(ws.root, "tasks", task, "terminal");
  let entries: Dirent[];
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const names = entries
    .filter((e) => e.isFile() && SNAPSHOT_NAME.test(e.name))
    .map((e) => e.name)
    .sort();
  const files: Record<string, string> = {};
  for (const name of names) {
    try {
      const text = await readSnapshotFile(join(folder, name));
      if (text !== null) files[name] = text;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // The file went away between the list and the read (a sync), or it became a link.
      if (code !== "ENOENT" && code !== "ELOOP" && code !== "EMLINK") throw error;
    }
  }
  return files;
}

export async function terminalView(
  ws: WorkspaceService,
  ref: string,
  sessions: TerminalSessions | null,
): Promise<TerminalReply> {
  const task = ws.showTask(ref);
  const me = ws.device.slug;
  const files = await snapshotFiles(ws, task.id);
  const newest = newestSnapshot(files);
  const session = task.session
    ? {
        session: task.session.session,
        device: task.session.device,
        host: task.session.host,
        state: task.session.state,
        local: task.session.device === me,
      }
    : null;
  const window = `aw-${task.id}`;
  let note: string | null = null;
  if (session?.host === "orca") {
    note = `AW does not read the screen of an Orca session. Open the Orca worktree ${window} on ${session.device}.`;
  } else if (!newest) {
    note =
      "No terminal snapshot yet. A tmux session writes one at most every 30 s when its screen changes, and at each gate.";
  }

  let open: TerminalTarget | null = null;
  let signIn: TerminalTarget | null = null;
  if (session) {
    const device = session.device;
    // The socket of that device: from its newest snapshot, else the default.
    const own = newestSnapshot(
      Object.fromEntries(Object.entries(files).filter(([n]) => n === `${device}.txt`)),
    );
    const socket = own?.header?.socket ?? DEFAULT_SOCKET;
    const local = session.local ? await sessions?.localTerminal(ws.id, task.id) : null;
    if (local && local.host === "orca") {
      const argv = [
        local.binary ?? "orca",
        "worktree",
        "activate",
        "--worktree",
        `path:${local.worktree}`,
        // The same argv as the desktop app runs (desktop/src/main/terminal.ts orcaArgs).
        "--json",
      ];
      open = {
        kind: "orca",
        device,
        local: true,
        orca: local.binary,
        worktree: local.worktree,
        command: commandText(argv),
      };
    } else if (session.local && session.host !== "orca") {
      // A local session with no live record (it ended) keeps the tmux target of this device.
      const argv = [
        local?.binary ?? "tmux",
        "-L",
        // This device: its own socket setting, also when the session record is gone.
        local?.socket ?? sessions?.tmuxSocket ?? socket,
        "attach",
        "-t",
        `aw:${window}`,
      ];
      open = { kind: "terminal", device, local: true, argv, command: commandText(argv) };
    } else if (session.host === "orca") {
      open = {
        kind: "copy",
        device,
        local: false,
        command: null,
        text: `Open the Orca worktree ${window} on ${device}.`,
      };
    } else {
      open = {
        kind: "copy",
        device,
        local: false,
        command: commandText([
          "ssh",
          "-t",
          device,
          "tmux",
          "-L",
          socket,
          "attach",
          "-t",
          `aw:${window}`,
        ]),
        text: `Run this command to open the terminal of ${device}:`,
      };
    }
    if (session.local) {
      const argv = [sessions?.claude ?? "claude", "auth", "login"];
      signIn = { kind: "terminal", device, local: true, argv, command: commandText(argv) };
    } else {
      signIn = {
        kind: "copy",
        device,
        local: false,
        command: commandText(["ssh", "-t", device, "claude", "auth", "login"]),
        text: `Run this command to sign in to Claude on ${device}:`,
      };
    }
  }

  return {
    task: task.id,
    session,
    snapshot: newest
      ? {
          // The file name names the writer: the files layer lets only that device write it.
          device: newest.device,
          session: newest.header?.session ?? null,
          host: newest.header?.host ?? null,
          captured_at: newest.header?.captured_at ?? null,
          text: newest.text,
        }
      : null,
    note,
    open,
    sign_in: signIn,
  };
}
