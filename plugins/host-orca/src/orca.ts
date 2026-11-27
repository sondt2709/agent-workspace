// The Orca session host (docs/phase-1.md 9.9, design of add-orca-session-host). The 2-step open
// (an Orca worktree, then a terminal that runs aw-launch), input with `terminal send`, the state
// from `terminal show`, and the stop of the process group. AW never reads the Orca screen: the
// terminal is 2 columns wide, so the output comes from the hooks and the transcript only.
import type {
  HostInfo,
  OpenOptions,
  PaneRef,
  PaneState,
  SessionHost,
  StopOptions,
  WorktreeInfo,
  WorktreeInput,
  WorktreeRemoveInput,
} from "@aw/plugin-api";
import { execa } from "execa";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { z } from "zod";
import { OrcaCli, OrcaError, orcaReplies, type TerminalRow } from "./orca-cli.ts";
import {
  groupProcessesSince,
  processExists,
  processTable,
  sessionProcesses,
  signal,
  START_SLACK_MS,
} from "./process-table.ts";

/** The oldest Orca that AW supports: the version of the real test device (design decision 10). */
export const MIN_ORCA_VERSION = "1.4.257";
/** The CLI in the macOS app bundle. */
export const MAC_APP_CLI = "/Applications/Orca.app/Contents/Resources/bin/orca";
/** The wait of `terminal send` for the prompt to start a turn, in seconds. */
export const WAIT_SUBMIT_S = 10;
/**
 * The time limit of one `terminal send`: the submit wait and 5 s for the CLI. A send runs in the
 * one check queue of awd, so a hung Orca must not hold the checks of the other sessions longer.
 */
export const SUBMIT_TIMEOUT_MS = (WAIT_SUBMIT_S + 5) * 1000;
/**
 * The largest text of one `terminal send`, in UTF-8 bytes. The CLI takes the text as one argument,
 * and Linux limits one argument to 128 KiB (MAX_ARG_STRLEN): a longer text fails each time. An
 * event line is at most 64 KiB, so an answer or a message is shorter; this guard is for any other
 * caller.
 */
export const MAX_TEXT_BYTES = 100 * 1024;
/** The time limit of a state check (`status`, `terminal show`): it runs in the check loop of awd. */
export const CHECK_TIMEOUT_MS = 5000;
/**
 * Error codes of `terminal send` that say the text was not sent: a new send is safe. After any
 * other failure with a request id, the next try uses `--retry-request <id>` (design decision 6).
 * `terminal_not_writable` is not here: its reply says "re-issue the exact command with
 * --retry-request <id>; do not retry it without that ID".
 */
export const NOT_SENT_CODES = new Set([
  "terminal_handle_stale",
  "request_mismatch",
  "invalid_argument",
  "runtime_unavailable",
]);

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/** -1, 0 or 1 for 2 versions `x.y.z`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The binaries to try, in order (design decision 11): `AW_ORCA`, the macOS app bundle, then
 * `orca-ide` and `orca` in PATH. On Linux, `orca` in PATH can be the screen reader.
 */
export function orcaCandidates(input: {
  configured: string | null;
  platform: NodeJS.Platform;
  path: string | undefined;
}): string[] {
  const list: string[] = [];
  if (input.configured) list.push(input.configured);
  if (input.platform === "darwin") list.push(MAC_APP_CLI);
  for (const name of ["orca-ide", "orca"]) {
    for (const dir of (input.path ?? "").split(delimiter)) {
      if (dir) list.push(join(dir, name));
    }
  }
  return [...new Set(list)];
}

async function executable(path: string): Promise<boolean> {
  return access(path, constants.X_OK).then(
    () => true,
    () => false,
  );
}

/** A value in single quotes for the login shell. A value with a quote or a control byte is refused. */
export function shellWord(value: string): string {
  if (value.includes("'") || [...value].some((c) => c.charCodeAt(0) < 0x20 || c === "\u007f")) {
    throw new OrcaError("invalid_command", `AW does not put ${JSON.stringify(value)} in a command`);
  }
  return `'${value}'`;
}

/**
 * The `--command` of `terminal create` (design decision 3). Orca types it into a login shell;
 * `exec` replaces the shell, so the terminal pid is the pid of the command. It holds only fixed
 * paths and ids of AW: never a message, user text or a token.
 */
export function terminalCommand(command: string[], env: Record<string, string>): string {
  if (command.length < 2) {
    throw new OrcaError("invalid_command", "A terminal command needs 2 or more arguments");
  }
  const vars = Object.entries(env).map(([key, value]) => {
    if (!ENV_NAME.test(key)) throw new OrcaError("invalid_command", `${key} is not a name`);
    return `${key}=${shellWord(value)}`;
  });
  return ["exec", "env", ...vars, ...command.map(shellWord)].join(" ");
}

function branchName(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

/** The folder name of an Orca worktree id `<repo-id>::<path>`, or "". */
function worktreeFolder(id: string | undefined): string {
  const path = id?.split("::")[1] ?? "";
  return path.split("/").at(-1) ?? "";
}

/** The worktree of the checkout where the branch is checked out, or null. */
async function checkedOutIn(checkout: string, branch: string): Promise<string | null> {
  const listed = await execa("git", ["-C", checkout, "worktree", "list", "--porcelain"], {
    reject: false,
  });
  let path: string | null = null;
  for (const line of String(listed.stdout ?? "").split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    if (line === `branch refs/heads/${branch}`) return path;
  }
  return null;
}

export interface OrcaHostOptions {
  /** `AW_ORCA`, or null. */
  configured: string | null;
  /** The PATH of the sessions. */
  path: string | undefined;
  platform?: NodeJS.Platform;
  /** A warning for the log of awd (for example, a provider that cannot take a multi-line text). */
  warn?: (message: string) => void;
  /** Waits; tests can give a fake. Default setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * The OS wall time in ms. Default `Date.now`: `opened` and the stop waits are compared with the
   * process start times of `ps`, which are wall times too (as in the tmux host).
   */
  now?: () => number;
}

export class OrcaHost implements SessionHost {
  readonly name = "orca";
  readonly readsScreen = false;
  readonly #options: OrcaHostOptions;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  #cli: OrcaCli | null = null;
  /** The request id of a send that may have reached Orca, by terminal and text. */
  readonly #retries = new Map<string, string>();
  /** The new worktrees whose first terminal (the login shell of Orca) is not closed yet. */
  readonly #firstTerminals = new Set<string>();

  constructor(options: OrcaHostOptions) {
    this.#options = options;
    this.#sleep =
      options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.#now = options.now ?? Date.now;
  }

  /** The full path of the Orca CLI after a detect, or null. */
  get binary(): string | null {
    return this.#cli?.binary ?? null;
  }

  async detect(): Promise<HostInfo> {
    const info = (binary: string | null, version: string | null, reason: string | null) => ({
      name: this.name,
      available: reason === null,
      binary,
      version,
      survivesDaemonRestart: true,
      reason,
    });
    for (const candidate of orcaCandidates({
      configured: this.#options.configured,
      platform: this.#options.platform ?? process.platform,
      path: this.#options.path,
    })) {
      if (!(await executable(candidate))) continue;
      const cli = new OrcaCli({ binary: candidate });
      const version = await cli.version().catch(() => null);
      if (version === null) continue;
      this.#cli = cli;
      if (compareVersions(version, MIN_ORCA_VERSION) < 0) {
        return info(candidate, version, `Orca ${version} is older than ${MIN_ORCA_VERSION}`);
      }
      try {
        const { runtime } = await cli.json(["status"], orcaReplies.status, {
          timeoutMs: CHECK_TIMEOUT_MS,
        });
        if (runtime.state !== "ready" || !runtime.reachable) {
          return info(candidate, version, `The Orca runtime is not ready (${runtime.state})`);
        }
      } catch (error) {
        return info(candidate, version, (error as Error).message);
      }
      return info(candidate, version, null);
    }
    this.#cli = null;
    return info(null, null, "No Orca CLI was found (set AW_ORCA)");
  }

  async #ready(): Promise<OrcaCli> {
    if (this.#cli) return this.#cli;
    await this.detect();
    if (!this.#cli) throw new OrcaError("not_found", "No Orca CLI was found (set AW_ORCA)");
    return this.#cli;
  }

  async #json<T>(
    args: string[],
    schema: z.ZodType<T>,
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    return (await this.#ready()).json(args, schema, options);
  }

  /**
   * The Orca worktree `<name>` of the checkout (design decision 2): the one that exists, else a new
   * one. Orca must know the repo first, so the host adds the checkout when Orca does not know it.
   */
  async worktree(input: WorktreeInput): Promise<WorktreeInfo> {
    const checkout = await realpath(input.checkout);
    const { repos } = await this.#json(["repo", "list"], orcaReplies.repoList);
    const repo =
      repos.find((r) => r.path === checkout || r.path === input.checkout) ??
      (await this.#json(["repo", "add", "--path", checkout], orcaReplies.repoAdd)).repo;
    const { worktrees } = await this.#json(
      ["worktree", "list", "--repo", `id:${repo.id}`],
      orcaReplies.worktreeList,
    );
    const names = new Set([input.name, ...(input.aliases ?? [])]);
    const found = worktrees.find(
      (w) =>
        w.displayName !== undefined &&
        names.has(w.displayName) &&
        w.isMainWorktree !== true &&
        w.isArchived !== true,
    );
    if (found) {
      if (found.branch === undefined) {
        throw new OrcaError("bad_reply", `The Orca worktree ${input.name} has no branch`);
      }
      // Orca reads the branch from git: a person can check out another branch there. The agent
      // would then commit to a branch that the task does not show.
      const branch = branchName(found.branch);
      if (branch !== input.branch) {
        throw new OrcaError(
          "branch_changed",
          `The Orca worktree ${found.displayName} has the branch ${branch}, not ${input.branch}. Check out ${input.branch} there, or remove that worktree`,
        );
      }
      if (this.#firstTerminals.has(found.id)) await this.#closeFirstTerminal(found.id);
      return { path: found.path, branch, id: found.id };
    }
    // Orca makes a new branch `<branch>-2` when the branch is checked out in another worktree:
    // the work of the task would then go to a branch that the task does not show. AW refuses.
    const elsewhere = await checkedOutIn(checkout, input.branch);
    if (elsewhere !== null) {
      throw new OrcaError(
        "branch_in_use",
        `The branch ${input.branch} is checked out in ${elsewhere}, and Orca can make the worktree ${input.name} only on a free branch`,
      );
    }
    const known =
      (
        await execa(
          "git",
          ["-C", checkout, "rev-parse", "--verify", "--quiet", `refs/heads/${input.branch}`],
          { reject: false },
        )
      ).exitCode === 0;
    const args = ["worktree", "create", "--name", input.name, "--repo", `id:${repo.id}`];
    args.push("--branch", input.branch, "--no-parent", "--setup", "skip");
    // A branch that exists and is free: Orca checks it out (spike round 2, case A).
    if (known) args.push("--base-branch", input.branch);
    const { worktree } = await this.#json(args, orcaReplies.worktreeCreate);
    this.#firstTerminals.add(worktree.id);
    await this.#closeFirstTerminal(worktree.id);
    return { path: worktree.path, branch: branchName(worktree.branch), id: worktree.id };
  }

  /**
   * `worktree create` opens a login shell in the new worktree: AW opens its own terminal. When the
   * close fails, the start fails before AW opens a terminal, and the next start (the retry finds
   * the worktree) closes the shell first. The worktree then has no terminal of AW yet. The set is
   * in memory: after an awd restart between the 2 tries, the shell stays.
   */
  async #closeFirstTerminal(id: string): Promise<void> {
    await this.#json(["terminal", "close", "--worktree", `id:${id}`, "--all"], orcaReplies.any);
    this.#firstTerminals.delete(id);
  }

  async open(options: OpenOptions): Promise<PaneRef> {
    const command = terminalCommand(options.command, options.env);
    // The OS wall time, as the tmux host: stop() compares it with the start times from `ps`.
    const opened = this.#now();
    const create = () =>
      this.#json(
        [
          "terminal",
          "create",
          "--worktree",
          `path:${options.cwd}`,
          "--title",
          options.name,
          "--command",
          command,
        ],
        orcaReplies.terminalCreate,
      );
    let reply: z.infer<typeof orcaReplies.terminalCreate>;
    try {
      reply = await create();
    } catch (error) {
      // A project checkout that Orca does not know yet: add it, then open the terminal in its main
      // folder (openspec project-checkout-no-worktree, the pattern of the inbox2agent Orca driver).
      if (!(error instanceof OrcaError) || error.code !== "selector_not_found") throw error;
      await this.#json(["repo", "add", "--path", options.cwd], orcaReplies.repoAdd);
      reply = await create();
    }
    const { terminal } = reply;
    return {
      host: this.name,
      window: terminal.worktreeId,
      pane: terminal.handle,
      pid: terminal.processId,
      // The login shell is the leader of a new session and process group; `exec` keeps the pid.
      pgid: terminal.processId,
      opened,
      instance: terminal.incarnationId,
    };
  }

  /**
   * The terminals in the AW worktrees of Orca (folder `aw-...`), named after the worktree. The
   * program in a terminal can change its title, so the title tells nothing. Orca lists no pids:
   * the manager uses find().
   */
  async list(): Promise<PaneState[]> {
    if (!this.#cli) return [];
    const { terminals } = await this.#json(["terminal", "list"], orcaReplies.terminalList);
    return terminals.flatMap((t) => {
      const folder = worktreeFolder(t.worktreeId);
      if (!folder.startsWith("aw-")) return [];
      return [
        {
          name: folder,
          window: t.worktreeId ?? "",
          pane: t.handle,
          pid: 0,
          dead: !t.connected,
          status: null,
        },
      ];
    });
  }

  /**
   * The state of a stored terminal from `terminal show` (design decision 4). Null when Orca does
   * not know the handle. Throws when Orca does not answer: then nobody can tell if the agent runs.
   */
  async find(ref: PaneRef): Promise<PaneState | null> {
    let terminal: TerminalRow;
    try {
      ({ terminal } = await this.#json(
        ["terminal", "show", "--terminal", ref.pane],
        orcaReplies.terminalShow,
        { timeoutMs: CHECK_TIMEOUT_MS },
      ));
    } catch (error) {
      if (error instanceof OrcaError && error.code === "terminal_handle_stale") return null;
      throw error;
    }
    const cause = terminal.exitCause ?? null;
    const dead = !terminal.connected || cause !== null;
    let status: number | null = null;
    if (cause?.kind === "exited" && cause.exitCode !== undefined) status = cause.exitCode;
    if (cause?.kind === "signaled" && cause.signal !== undefined) status = 128 + cause.signal;
    // Another incarnation runs another process: the stored pids are not true for it.
    const same = ref.instance === undefined || terminal.incarnationId === ref.instance;
    return {
      name: terminal.title ?? "",
      window: terminal.worktreeId ?? ref.window,
      pane: ref.pane,
      pid: same ? ref.pid : 0,
      dead,
      status,
    };
  }

  async alive(ref: PaneRef): Promise<boolean> {
    const state = await this.find(ref).catch(() => null);
    return state !== null && !state.dead && state.pid === ref.pid;
  }

  /** Always empty: AW never reads the Orca screen (docs/phase-1.md 9.9.4). */
  capture(): Promise<string> {
    return Promise.resolve("");
  }

  paste(): Promise<void> {
    return Promise.reject(new OrcaError("unsupported", "The Orca host sends text with submit()"));
  }

  keys(): Promise<void> {
    return Promise.reject(new OrcaError("unsupported", "The Orca host sends no keys"));
  }

  /**
   * `terminal send --text <text> --enter --wait-submit 10` (docs/phase-1.md 9.9.3). After a failure
   * that may have sent the text, the next submit of the same text uses `--retry-request <id>`, so
   * Orca replays the result and does not send the text twice. A failure with no request id
   * (`timeout`, `cli_failed`, `bad_reply`) can have sent the text too: the manager sends again only
   * after its retry wait, when the hooks say idle and no UserPromptSubmit confirmed the text.
   * A text of more than MAX_TEXT_BYTES is refused (it is a command-line argument). The text is in
   * the argv of the Orca CLI for the time of the call, so each local user can read it with `ps`:
   * a maintainer approved this exception for phase 1 (`docs/engineering-rules.md` 12).
   */
  async submit(ref: PaneRef, text: string): Promise<void> {
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_TEXT_BYTES) {
      throw new OrcaError(
        "text_too_large",
        `The text has ${bytes} bytes: Orca takes at most ${MAX_TEXT_BYTES} in one input`,
      );
    }
    const key = `${ref.pane}\n${createHash("sha256").update(text).digest("hex")}`;
    const args = ["terminal", "send", "--terminal", ref.pane, "--text", text, "--enter"];
    args.push("--wait-submit", String(WAIT_SUBMIT_S));
    const retry = this.#retries.get(key);
    if (retry !== undefined) args.push("--retry-request", retry);
    let result: z.infer<typeof orcaReplies.terminalSend>;
    try {
      result = await this.#json(args, orcaReplies.terminalSend, {
        timeoutMs: SUBMIT_TIMEOUT_MS,
      });
    } catch (error) {
      if (error instanceof OrcaError && !NOT_SENT_CODES.has(error.code) && error.requestId) {
        this.#retries.set(key, error.requestId);
      } else {
        this.#retries.delete(key);
      }
      throw error;
    }
    this.#retries.delete(key);
    if (result.send.prompt?.provider === "unsupported" && text.includes("\n")) {
      this.#options.warn?.(
        `Orca does not know the agent of ${ref.pane} as an agent: a text of more than one line can arrive as more than one prompt`,
      );
    }
  }

  /**
   * The stop of docs/phase-1.md 9.7 on the pid from `terminal create` (design decision 5). It
   * signals only while Orca shows the stored incarnation and the process table has the stored pid
   * in the stored group.
   */
  async stop(ref: PaneRef, options: StopOptions = {}): Promise<void> {
    const grace = options.graceMs ?? 5000;
    const state = await this.find(ref);
    if (!state || state.pid !== ref.pid || ref.pgid <= 1) return;
    const table = await processTable();
    if (state.dead) {
      if (ref.opened === undefined) return;
      const before = groupProcessesSince(table, ref.pgid, ref.opened);
      for (const pid of before) signal(pid, "SIGTERM");
      const end = this.#now() + grace;
      while (this.#now() < end && [...before].some(processExists)) await this.#sleep(100);
      const after = groupProcessesSince(await processTable(), ref.pgid, ref.opened);
      for (const pid of new Set([...before, ...after])) {
        if (processExists(pid)) signal(pid, "SIGKILL");
      }
      return;
    }
    const row = table.find((r) => r.pid === ref.pid);
    if (!row || row.pgid !== ref.pgid) return;
    if (ref.opened !== undefined && row.started !== null) {
      if (row.started < ref.opened - START_SLACK_MS) return;
    }
    const before = sessionProcesses(table, ref.pid, ref.pgid);
    signal(-ref.pgid, "SIGTERM");
    const end = this.#now() + grace;
    while (this.#now() < end && [...before].some(processExists)) await this.#sleep(100);
    signal(-ref.pgid, "SIGKILL");
    const after = sessionProcesses(await processTable(), ref.pid, ref.pgid);
    for (const pid of new Set([...before, ...after])) {
      if (processExists(pid)) signal(pid, "SIGKILL");
    }
  }

  async close(ref: PaneRef): Promise<void> {
    try {
      await this.#json(["terminal", "close", "--terminal", ref.pane], orcaReplies.any);
    } catch (error) {
      if (error instanceof OrcaError && error.code === "terminal_handle_stale") return;
      throw error;
    }
  }

  /**
   * Removes the Orca worktree at `path` and keeps its branch (openspec project-remove): awd deletes
   * the branch itself after its unpushed check. A folder that Orca does not list: git removes it.
   */
  async removeWorktree(input: WorktreeRemoveInput): Promise<void> {
    const checkout = await realpath(input.checkout).catch(() => input.checkout);
    const path = await realpath(input.path).catch(() => input.path);
    const { repos } = await this.#json(["repo", "list"], orcaReplies.repoList);
    const repo = repos.find((r) => r.path === checkout || r.path === input.checkout);
    const { worktrees } = repo
      ? await this.#json(["worktree", "list", "--repo", `id:${repo.id}`], orcaReplies.worktreeList)
      : { worktrees: [] };
    const found = worktrees.find((w) => w.path === path || w.path === input.path);
    if (!found) {
      const removed = await execa("git", ["-C", checkout, "worktree", "remove", input.path], {
        reject: false,
      });
      if (removed.exitCode !== 0) throw new OrcaError("bad_reply", String(removed.stderr).trim());
      return;
    }
    await this.#json(
      ["terminal", "close", "--worktree", `id:${found.id}`, "--all"],
      orcaReplies.any,
    ).catch(() => undefined);
    await this.#json(["worktree", "rm", "--worktree", `id:${found.id}`], orcaReplies.any);
  }

  /** Removes an Orca worktree and its branch by id (tests, and a later uninstall). */
  async removeWorktreeById(id: string): Promise<void> {
    await this.#json(
      ["terminal", "close", "--worktree", `id:${id}`, "--all"],
      orcaReplies.any,
    ).catch(() => undefined);
    await this.#json(
      ["worktree", "rm", "--worktree", `id:${id}`, "--force", "--delete-branch"],
      orcaReplies.any,
    );
  }

  /** Removes the repo entry of a checkout from Orca, when it has one (tests). */
  async forgetRepo(checkout: string): Promise<void> {
    const path = await realpath(checkout).catch(() => checkout);
    const { repos } = await this.#json(["repo", "list"], orcaReplies.repoList);
    const repo = repos.find((r) => r.path === path || r.path === checkout);
    if (!repo) return;
    await this.#json(["project", "setup-delete", "--setup", repo.id, "--force"], orcaReplies.any);
  }
}
