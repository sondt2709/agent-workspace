// The AW guard of a session (openspec session-options, design decision 4). The PreToolUse hook runs
// it before each tool call, in each permission mode, with no call to awd. The spike showed that a
// deny rule of Claude Code matches only the command text, so `sh -c "aw gate answer …"` passed it
// in skip mode. This check reads the whole command text. It is one layer: the CLI refuses a person
// command in a session, and awd refuses each person route to a process of the session tree.
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { HUMAN_COMMANDS } from "../cli/person-commands.ts";

/** What the guard knows about the session (the `guard` part of launch.json). */
export interface GuardContext {
  /** The AW state folder (`AW_HOME`, default `~/.aw`). */
  home: string;
  /** The home folder of the user: `~` in a command. */
  userHome: string;
  /** The registered workspace folders of this device (`~/AW/<workspace>`). */
  workspaces: readonly string[];
  /** The credentials folder of this session: the agent reads its values there. */
  credentialsDir: string | null;
  /** The working folder of the session. */
  cwd: string;
}

/** The tools that change a file at `file_path` or `notebook_path`. */
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
/** The tools that read files at `file_path` or `path`. */
const READ_TOOLS = new Set(["Read", "Grep", "Glob", "LS"]);

/** A character before a command word: the start, a space, a shell operator, a quote or a slash. */
const BEFORE = "(?:^|[\\s;&|()`'\"/$={}])";
/** A character after a command word. */
const AFTER = "(?=$|[\\s;&|()`'\"])";

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The regular expression of `aw <person command>` anywhere in a command text. The CLI file
 * (`aw.ts`, `aw.js`) counts as `aw` too: `node daemon/src/bin/aw.ts gate answer`.
 */
const PERSON_COMMAND = new RegExp(
  `${BEFORE}aw(?:\\.[cm]?[jt]s)?\\s+(?:${[...HUMAN_COMMANDS]
    .sort((a, b) => b.length - a.length)
    .map((c) => c.split(" ").map(escape).join("\\s+"))
    .join("|")})${AFTER}`,
  // Any case: on a macOS file system `AW` runs the `aw` file (final check fc1-8).
  "i",
);

/**
 * True when `path` is `root` or in it. The compare ignores the case: the default macOS file system
 * finds `~/.AW` as `~/.aw` (final check fc1-8). On Linux this only denies more.
 */
function inside(path: string, root: string): boolean {
  const rel = relative(root.toLowerCase(), path.toLowerCase());
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** A path of a tool input, made absolute from the working folder of the session (`~` too). */
function absolute(path: string, context: GuardContext): string {
  if (path === "~" || path.startsWith("~/")) return resolve(context.userHome, path.slice(2));
  return resolve(context.cwd, path);
}

/**
 * The path with each symbolic link resolved: the real path of its nearest folder that exists, and
 * the rest of the path. A link in the working folder that points into AW_HOME counts as AW_HOME.
 */
function real(path: string): string {
  let head = path;
  const rest: string[] = [];
  for (;;) {
    try {
      // The native call gives the case of the names on disk (`.AW` gives `.aw` on macOS).
      return join(realpathSync.native(head), ...rest);
    } catch {
      const parent = dirname(head);
      if (parent === head) return path;
      rest.unshift(basename(head));
      head = parent;
    }
  }
}

/** True when `path` or its real path is in `root` or in the real path of `root`. */
function insideAny(path: string, root: string): boolean {
  const roots = [root, real(root)];
  return [path, real(path)].some((p) => roots.some((r) => inside(p, r)));
}

/** True for a path in AW_HOME that is not in `worktrees/` (the work of the sessions). */
function inState(path: string, context: GuardContext): boolean {
  const worktrees = resolve(context.home, "worktrees");
  return [path, real(path)].some(
    (p) =>
      [context.home, real(context.home)].some((h) => inside(p, h)) &&
      ![worktrees, real(worktrees)].some((w) => inside(p, w)),
  );
}

/** True for a path in AW_HOME outside `worktrees/`, as written (no real path). */
function inStateText(path: string, context: GuardContext): boolean {
  return inside(path, context.home) && !inside(path, resolve(context.home, "worktrees"));
}

/**
 * The names of a folder in a command: the path, and for a folder under the user home also `~/…`,
 * `$HOME/…` and `${HOME}/…` (the usual ways to write a path in a shell).
 */
function folderNames(folder: string, context: GuardContext): string[] {
  const path = folder.replace(/\/+$/, "");
  if (path.length === 0) return [];
  const names = [path];
  if (inside(path, context.userHome) && path !== context.userHome) {
    const rel = relative(context.userHome, path);
    names.push(`~/${rel}`, `$HOME/${rel}`, `\${HOME}/${rel}`);
  }
  return names;
}

/** The names of AW_HOME in a command: its folder names and the variable. */
function homeNames(context: GuardContext): string[] {
  return [...folderNames(context.home, context), "$AW_HOME", "${AW_HOME}"];
}

/** The end of a path in a command: a space, a shell operator or a quote. */
const PATH_END = /[\s;&|()<>`'"]/;
/** A `..` part of a path. */
const UP = /(?:^|\/)\.\.(?:\/|$)/;

/**
 * The folder of a `cd` word: an absolute path, `~`, `$HOME` and `${HOME}` (the command is in lower
 * case here), or a path relative to the folder before. Null for another variable.
 */
function cdTarget(word: string, cwd: string, context: GuardContext): string | null {
  const pwd = /^(?:\$pwd|\$\{pwd\})(?=\/|$)/.exec(word);
  if (pwd) return resolve(cwd, `.${word.slice(pwd[0].length)}`);
  const home = /^(?:~|\$home|\$\{home\})(?=\/|$)/.exec(word);
  if (home) return resolve(context.userHome, `.${word.slice(home[0].length)}`);
  if (/^\$(?:aw_home|\{aw_home\})(?=\/|$)/.test(word)) return context.home;
  if (word.startsWith("$")) return null;
  return resolve(cwd, word);
}

/**
 * True when a relative path in the command leads into AW_HOME outside `worktrees/`, from the
 * working folder of the session or the folder of a `cd` before it: `cat ../../keys/device` in
 * `<AW_HOME>/worktrees/aw-AW-1`, and `cd ~ && cat .aw/keys/device` (soc-15).
 */
function relativeIntoState(command: string, context: GuardContext): boolean {
  let cwd = context.cwd;
  let cd = false;
  // A cd with no folder goes to the home folder (`cd; cat .aw/keys/device`).
  const text = command.replace(/(^|[\s;&|(])(cd|pushd)(?=\s*(?:$|[;&|)\n]))/g, "$1$2 ~");
  for (const word of text.split(/[\s;&|()<>`'"=]+/)) {
    if (word === "") continue;
    if (cd && !word.startsWith("-")) {
      const target = cdTarget(word, cwd, context);
      if (target !== null) {
        if (inState(target, context)) return true;
        cwd = target;
      }
    } else if (!/^[/~$-]/.test(word)) {
      // A `..` path: also its real path (a link). After a cd: the path as written only, so the
      // check reads no file for each word of the command.
      if (UP.test(word) && inState(resolve(cwd, word), context)) return true;
      if (cwd !== context.cwd && inStateText(resolve(cwd, word), context)) return true;
    }
    cd = word === "cd" || word === "pushd" || (cd && word.startsWith("-"));
  }
  return false;
}

/** The folder part of a Glob pattern before its first wildcard, or null. */
function globFolder(pattern: string): string | null {
  const parts: string[] = [];
  for (const part of pattern.split("/")) {
    if (/[*?[{]/.test(part)) break;
    parts.push(part);
  }
  const folder = parts.join("/");
  return folder === "" && !pattern.startsWith("/") ? null : folder || "/";
}

/** The reason of a Bash command that the guard denies, or null. */
function bashReason(original: string, context: GuardContext): string | null {
  if (PERSON_COMMAND.test(original)) {
    return "it runs a command of a person (aw gate answer, aw task assign, ...)";
  }
  // The names of the folders in any case (final check fc1-8).
  const command = original.toLowerCase();
  if (command.includes("awd.sock")) return "it names the socket of awd";
  // The folders of AW_HOME that a command can name: the worktrees and the own credentials.
  const open = ["/worktrees/"];
  if (context.credentialsDir !== null && inside(context.credentialsDir, context.home)) {
    open.push(`/${relative(context.home, context.credentialsDir)}/`.toLowerCase());
  }
  for (const name of homeNames(context).map((n) => n.toLowerCase())) {
    let from = 0;
    for (;;) {
      const at = command.indexOf(name, from);
      if (at < 0) break;
      from = at + name.length;
      const next = command[from];
      // A longer name that starts with the same text (`~/.aws`) is not the AW folder.
      if (next !== undefined && /[A-Za-z0-9_.-]/.test(next)) continue;
      // The rest of the path, to the end of the word: no `..` out of an open folder.
      const rest = command.slice(from).split(PATH_END)[0]!;
      if (!open.some((folder) => rest.startsWith(folder)) || UP.test(rest)) {
        return "it names the AW state folder";
      }
    }
  }
  if (relativeIntoState(command, context)) return "it names the AW state folder";
  for (const folder of context.workspaces) {
    if (folderNames(folder, context).some((name) => command.includes(name.toLowerCase()))) {
      return "it names the workspace folder";
    }
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The reason to deny a tool call, or null to let it run. The reason is the text that the agent
 * reads after "AW denied this tool call:".
 */
export function guardReason(
  tool: string,
  input: Record<string, unknown>,
  context: GuardContext,
): string | null {
  if (tool === "Bash") {
    const command = text(input.command);
    return command === null ? null : bashReason(command, context);
  }
  if (EDIT_TOOLS.has(tool)) {
    const path = text(input.file_path) ?? text(input.notebook_path);
    if (path === null) return null;
    const target = absolute(path, context);
    if (inState(target, context)) return "AW files change only through awd";
    if (context.workspaces.some((w) => insideAny(target, w))) {
      return "the workspace folder changes only through awd";
    }
    return null;
  }
  if (READ_TOOLS.has(tool)) {
    const path = text(input.file_path) ?? text(input.path);
    // The folder of a Glob pattern counts too: `/home/user/.aw/**/*` with no path.
    const pattern = tool === "Glob" ? text(input.pattern) : null;
    const folder = pattern === null ? null : globFolder(pattern);
    if (folder !== null) {
      const base = path === null ? context : { ...context, cwd: absolute(path, context) };
      const reason = readReason(absolute(folder, base), context);
      if (reason !== null) return reason;
    }
    if (path === null) return null;
    return readReason(absolute(path, context), context);
  }
  return null;
}

/** The reason to deny a read of `target`, or null. */
function readReason(target: string, context: GuardContext): string | null {
  // The own credentials: the path and its real path must both be there (no link out of it).
  const credentials = context.credentialsDir;
  if (credentials !== null && inside(target, credentials) && insideAny(real(target), credentials)) {
    return null;
  }
  if (inState(target, context)) return "the AW state folder holds the keys and tokens of AW";
  return null;
}

/** The deny text of the PreToolUse hook. */
export function guardDenyText(reason: string): string {
  return `AW denied this tool call: ${reason}. Do the work in your working folder, and ask the human with aw ask when you need a person action.`;
}

/**
 * The reason to deny a gate tool (AskUserQuestion, ExitPlanMode) of a teammate or a subagent, or
 * null. AW follows the lead session only: the answer of a gate goes to the input of the lead, so a
 * teammate never opens a gate of the task (openspec session-options, agent teams).
 */
export function teammateGateReason(event: {
  kind: string;
  gate?: unknown;
  agent?: string | null;
}): string | null {
  if (event.kind !== "tool_start" || !event.gate || !event.agent) return null;
  return "a teammate asks the team lead, not the human. Send the question to the lead, and the lead asks the human";
}
