// A fake Orca CLI for tests (design decision 13 of add-orca-session-host). It prints the JSON
// envelope of the captured replies of `orca-ide` 1.4.257 (fixtures/orca-1.4.257/), keeps its state
// in FAKE_ORCA_STATE, makes worktrees with `git worktree add`, and runs each terminal in a window of
// a private tmux server (FAKE_ORCA_TMUX, FAKE_ORCA_SOCKET). The command of `terminal create` runs
// in `sh -c`, as Orca types it into a login shell.
//
// Test switches (files in the state folder):
//   down             each command fails with `runtime_unavailable` (the Orca runtime is stopped)
//   fail-next-close  the next `terminal close --terminal` fails with `runtime_unavailable`
//   fail-next-close-all  the next `terminal close --worktree` fails with `runtime_unavailable`
//   fail-next-send   the next `terminal send` sends the text, then fails with `transport_timeout`
//                    and a request id (a reply that was lost)
// FAKE_ORCA_VERSION sets the version (default 1.4.257).
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { constants } from "node:os";
import { basename, join } from "node:path";

interface Repo {
  id: string;
  path: string;
  displayName: string;
}
interface Worktree {
  id: string;
  repoId: string;
  path: string;
  branch: string;
  displayName: string;
}
interface Terminal {
  handle: string;
  worktreeId: string;
  title: string;
  pane: string;
  pid: number;
  incarnationId: string;
  closed: boolean;
}
interface Request {
  key: string;
  result: unknown;
}
interface State {
  runtimeId: string;
  /** Each text that `terminal send` wrote, with the wall time (tests read it). */
  sends?: { at: number; handle: string; text: string }[];
  repos: Repo[];
  worktrees: Worktree[];
  terminals: Terminal[];
  requests: Record<string, Request>;
}

const env = process.env;
const stateDir = env.FAKE_ORCA_STATE ?? "";
const tmuxBinary = env.FAKE_ORCA_TMUX ?? "tmux";
const socket = env.FAKE_ORCA_SOCKET ?? "fake-orca";
const version = env.FAKE_ORCA_VERSION ?? "1.4.257";
const stateFile = join(stateDir, "state.json");

function load(): State {
  if (!existsSync(stateFile)) {
    return { runtimeId: randomUUID(), repos: [], worktrees: [], terminals: [], requests: {} };
  }
  return JSON.parse(readFileSync(stateFile, "utf8")) as State;
}

function save(state: State): void {
  writeFileSync(`${stateFile}.tmp`, JSON.stringify(state, null, 2));
  execFileSync("mv", [`${stateFile}.tmp`, stateFile]);
}

function print(value: unknown): never {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exit((value as { ok: boolean }).ok ? 0 : 1);
}

let state = undefined as unknown as State;

function ok(result: unknown): never {
  print({ id: randomUUID(), ok: true, result, _meta: { runtimeId: state.runtimeId } });
}

function fail(code: string, message: string, data: Record<string, unknown> = {}): never {
  print({
    id: randomUUID(),
    ok: false,
    error: { code, message, data },
    _meta: { runtimeId: state?.runtimeId ?? null },
  });
}

function tmux(args: string[], input?: string): { code: number; out: string } {
  const result = spawnSync(tmuxBinary, ["-L", socket, ...args], {
    encoding: "utf8",
    ...(input === undefined ? {} : { input }),
  });
  return { code: result.status ?? 1, out: result.stdout ?? "" };
}

function ensureServer(): void {
  if (tmux(["has-session", "-t", "=orca"]).code === 0) return;
  tmux(["new-session", "-d", "-s", "orca", "-n", "idle", "--", "tail", "-f", "/dev/null"]);
  tmux(["set", "-g", "remain-on-exit", "on"]);
  tmux(["set", "-g", "exit-empty", "off"]);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function selectWorktree(selector: string | undefined): Worktree {
  // The main folder of a known repo is a worktree too, as in Orca: id `<repo-id>::<path>`.
  const mains: Worktree[] = state.repos.map((r) => ({
    id: `${r.id}::${r.path}`,
    repoId: r.id,
    path: r.path,
    branch: "main",
    displayName: "main",
  }));
  const found = [...state.worktrees, ...mains].find((w) =>
    selector?.startsWith("id:")
      ? w.id === selector.slice(3)
      : selector?.startsWith("path:")
        ? w.path === selector.slice(5) || w.path === realPath(selector.slice(5))
        : false,
  );
  // As orca 1.4.240 (fixtures/orca-1.4.240/selector-not-found.json).
  if (!found) {
    fail("selector_not_found", "selector_not_found", {
      selector,
      nextSteps: [`No Orca workspace matched the worktree selector "${selector ?? ""}".`],
    });
  }
  return found;
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function worktreeRow(w: Worktree) {
  // As Orca: the branch that git has checked out in the worktree now.
  const head = git(["-C", w.path, "symbolic-ref", "-q", "HEAD"]);
  return {
    id: w.id,
    repoId: w.repoId,
    path: w.path,
    branch: head.code === 0 ? head.out.trim() : `refs/heads/${w.branch}`,
    isBare: false,
    isMainWorktree: false,
    displayName: w.displayName,
    isArchived: false,
  };
}

function openTerminal(worktree: Worktree, title: string, command: string): Terminal {
  ensureServer();
  const opened = tmux([
    "new-window",
    "-d",
    "-t",
    "=orca:",
    "-c",
    worktree.path,
    "-P",
    "-F",
    "#{pane_id}\t#{pane_pid}",
    "--",
    "sh",
    "-c",
    command,
  ]);
  const [pane, pid] = opened.out.trim().split("\t");
  if (opened.code !== 0 || !pane) fail("terminal_create_failed", "tmux new-window failed");
  const terminal: Terminal = {
    handle: `term_${randomUUID()}`,
    worktreeId: worktree.id,
    title,
    pane,
    pid: Number(pid),
    incarnationId: randomUUID(),
    closed: false,
  };
  state.terminals.push(terminal);
  return terminal;
}

function paneState(t: Terminal): { live: boolean; exitCause?: Record<string, unknown> } {
  if (t.closed) return { live: false, exitCause: { kind: "operator_close" } };
  const shown = tmux([
    "display-message",
    "-p",
    "-t",
    t.pane,
    "#{pane_dead}\t#{pane_dead_status}\t#{pane_dead_signal}",
  ]);
  // No pane: the tmux server stopped (as a kill of the Orca terminal daemon).
  if (shown.code !== 0) return { live: false };
  const [dead, status, sig] = shown.out.trim().split("\t");
  if (dead !== "1") return { live: true };
  // tmux gives the signal name in lower case (`term`), Orca gives the number.
  if (sig) {
    const number = /^\d+$/.test(sig)
      ? Number(sig)
      : constants.signals[`SIG${sig.toUpperCase()}` as keyof typeof constants.signals];
    return { live: false, exitCause: { kind: "signaled", signal: number } };
  }
  return { live: false, exitCause: { kind: "exited", exitCode: Number(status) } };
}

function terminalRow(t: Terminal) {
  const s = paneState(t);
  const w = state.worktrees.find((x) => x.id === t.worktreeId);
  return {
    handle: t.handle,
    ptyId: `${t.worktreeId}@@${t.incarnationId.slice(0, 8)}`,
    incarnationId: t.incarnationId,
    orphaned: !s.live,
    worktreeId: t.worktreeId,
    worktreePath: w?.path ?? "",
    branch: w ? `refs/heads/${w.branch}` : "",
    title: t.title,
    connected: s.live,
    writable: s.live,
    ...(s.exitCause ? { exitCause: s.exitCause } : {}),
    executionHostId: "local",
  };
}

function closeTerminal(t: Terminal): void {
  if (!t.closed) tmux(["kill-pane", "-t", t.pane]);
  t.closed = true;
}

function git(args: string[]): { code: number; out: string; err: string } {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return { code: result.status ?? 1, out: result.stdout ?? "", err: result.stderr ?? "" };
}

const argv = process.argv.slice(2).filter((a) => a !== "--json");
if (argv[0] === "--version") {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}
if (!stateDir) {
  process.stderr.write("FAKE_ORCA_STATE is not set\n");
  process.exit(2);
}
mkdirSync(stateDir, { recursive: true });
state = load();
if (existsSync(join(stateDir, "down"))) {
  fail("runtime_unavailable", "This terminal could not connect to Orca.", {
    nextSteps: ["Check that Orca is open and that this terminal can access it."],
  });
}
const command = `${argv[0]} ${argv[1] ?? ""}`.trim();

switch (command) {
  case "status": {
    ok({
      target: { kind: "local" },
      app: { running: true },
      runtime: {
        state: "ready",
        reachable: true,
        connectionState: "connected",
        runtimeId: state.runtimeId,
        appVersion: version,
      },
    });
    break;
  }
  case "repo list":
    ok({ repos: state.repos });
    break;
  case "repo add": {
    const path = realpathSync(option(argv, "--path") ?? "");
    // As orca 1.4.240 (fixtures/orca-1.4.240/repo-add-not-git.json): the default kind is git.
    if (git(["-C", path, "rev-parse", "--git-dir"]).code !== 0) {
      fail("runtime_error", `Not a valid git repository: ${path}`);
    }
    const repo: Repo = { id: randomUUID(), path, displayName: basename(path) };
    state.repos.push(repo);
    save(state);
    ok({ repo });
    break;
  }
  case "worktree list": {
    const selector = option(argv, "--repo") ?? "";
    const repo = state.repos.find((r) => `id:${r.id}` === selector);
    const rows = state.worktrees.filter((w) => !repo || w.repoId === repo.id).map(worktreeRow);
    const main = repo
      ? [
          {
            id: `${repo.id}::${repo.path}`,
            path: repo.path,
            isMainWorktree: true,
            displayName: "main",
            branch: "refs/heads/main",
          },
        ]
      : [];
    ok({ worktrees: [...main, ...rows], totalCount: rows.length + main.length, truncated: false });
    break;
  }
  case "worktree create": {
    const selector = option(argv, "--repo") ?? "";
    const repo = state.repos.find(
      (r) => `id:${r.id}` === selector || `path:${r.path}` === selector,
    );
    if (!repo) fail("repo_not_found", "repo_not_found");
    const name = option(argv, "--name") ?? "worktree";
    let branch = option(argv, "--branch") ?? name;
    const base = option(argv, "--base-branch") ?? "HEAD";
    let path = join(stateDir, "workspaces", repo.displayName, name);
    // As orca-ide 1.4.257 (evidence captures/round2/spike-branch.log): a branch that is checked
    // out in a worktree gets a suffix, and the new branch starts from the base; a branch that
    // exists and is free is checked out as it is.
    const checkedOut = (b: string) =>
      git(["-C", repo.path, "worktree", "list", "--porcelain"])
        .out.split("\n")
        .includes(`branch refs/heads/${b}`);
    for (let n = 2; checkedOut(branch); n++) {
      branch = `${option(argv, "--branch") ?? name}-${n}`;
      path = join(stateDir, "workspaces", repo.displayName, `${name}-${n}`);
    }
    const exists =
      git(["-C", repo.path, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).code === 0;
    const added = git(
      exists
        ? ["-C", repo.path, "worktree", "add", path, branch]
        : ["-C", repo.path, "worktree", "add", "-b", branch, path, base],
    );
    if (added.code !== 0) fail("worktree_create_failed", added.err.trim());
    const worktree: Worktree = {
      id: `${repo.id}::${path}`,
      repoId: repo.id,
      path,
      branch,
      displayName: name,
    };
    state.worktrees.push(worktree);
    // Orca opens a first terminal (a login shell) in each new worktree.
    openTerminal(worktree, `user@ubuntu-01: ${path}`, "exec tail -f /dev/null");
    save(state);
    ok({ worktree: worktreeRow(worktree), warnings: [] });
    break;
  }
  case "worktree rm": {
    const worktree = selectWorktree(option(argv, "--worktree"));
    for (const t of state.terminals.filter((x) => x.worktreeId === worktree.id)) closeTerminal(t);
    const repo = state.repos.find((r) => r.id === worktree.repoId)!;
    git(["-C", repo.path, "worktree", "remove", "--force", worktree.path]);
    if (argv.includes("--delete-branch")) git(["-C", repo.path, "branch", "-D", worktree.branch]);
    state.worktrees = state.worktrees.filter((w) => w.id !== worktree.id);
    save(state);
    ok({ removed: true });
    break;
  }
  case "project setup-delete": {
    const id = option(argv, "--setup");
    state.repos = state.repos.filter((r) => r.id !== id);
    save(state);
    ok({ result: { setup: { id } } });
    break;
  }
  case "terminal create": {
    const worktree = selectWorktree(option(argv, "--worktree"));
    const t = openTerminal(
      worktree,
      option(argv, "--title") ?? "",
      option(argv, "--command") ?? "",
    );
    save(state);
    ok({
      terminal: {
        processId: t.pid,
        handle: t.handle,
        worktreeId: t.worktreeId,
        title: t.title,
        executionHostId: "local",
        incarnationId: t.incarnationId,
        hostPlatform: process.platform,
        surface: "visible",
      },
    });
    break;
  }
  case "terminal list": {
    const selector = option(argv, "--worktree");
    const rows = state.terminals
      .filter((t) => !t.closed && paneState(t).live)
      .filter((t) => selector === undefined || `id:${t.worktreeId}` === selector)
      .map(terminalRow);
    ok({ terminals: rows, totalCount: rows.length, truncated: false });
    break;
  }
  case "terminal show": {
    const t = state.terminals.find((x) => x.handle === option(argv, "--terminal"));
    if (!t) fail("terminal_handle_stale", "terminal_handle_stale");
    ok({ terminal: terminalRow(t) });
    break;
  }
  case "terminal send": {
    const handle = option(argv, "--terminal") ?? "";
    const text = option(argv, "--text") ?? "";
    const key = JSON.stringify([handle, text]);
    const retry = option(argv, "--retry-request");
    const requestId = retry ?? randomUUID();
    const known = retry === undefined ? undefined : state.requests[retry];
    if (known) {
      if (known.key !== key) {
        fail(
          "request_mismatch",
          `Mutation request ${retry} was already used with different input.`,
          {
            orchestrationRequestId: retry,
          },
        );
      }
      ok({ ...(known.result as object), mutation: { requestId, replayed: true } });
    }
    const t = state.terminals.find((x) => x.handle === handle);
    if (!t)
      fail("terminal_handle_stale", "terminal_handle_stale", { orchestrationRequestId: requestId });
    if (!paneState(t).live) {
      fail("terminal_not_writable", "terminal_not_writable", { orchestrationRequestId: requestId });
    }
    const name = `fake-orca-${process.pid}`;
    tmux(["load-buffer", "-b", name, "-"], text);
    // -r: keep each line feed, as Orca writes the text as is in its bracketed paste.
    tmux(["paste-buffer", "-p", "-r", "-d", "-b", name, "-t", t.pane]);
    if (argv.includes("--enter")) tmux(["send-keys", "-t", t.pane, "Enter"]);
    const args =
      spawnSync("ps", ["-o", "args=", "-p", String(t.pid)], { encoding: "utf8" }).stdout ?? "";
    const result = {
      send: {
        handle,
        accepted: true,
        bytesWritten: Buffer.byteLength(text),
        prompt: {
          requestId,
          stages: ["input_accepted"],
          provider: /claude/.test(args) ? "claude" : "unsupported",
          observation: /claude/.test(args) ? "supported" : "unsupported",
          processIncarnation: t.incarnationId,
        },
      },
    };
    state.requests[requestId] = { key, result };
    (state.sends ??= []).push({ at: Date.now(), handle, text });
    save(state);
    const lost = join(stateDir, "fail-next-send");
    if (existsSync(lost)) {
      rmSync(lost);
      fail("transport_timeout", "The reply of Orca was lost.", {
        orchestrationRequestId: requestId,
      });
    }
    ok({ ...result, mutation: { requestId, replayed: false } });
    break;
  }
  case "terminal close": {
    const selector = option(argv, "--worktree");
    if (selector !== undefined) {
      const failAll = join(stateDir, "fail-next-close-all");
      if (existsSync(failAll)) {
        rmSync(failAll);
        fail("runtime_unavailable", "runtime_unavailable");
      }
      const list = state.terminals.filter((t) => `id:${t.worktreeId}` === selector && !t.closed);
      for (const t of list) closeTerminal(t);
      save(state);
      ok({ closed: list.length, stopped: list.length, retiredSurfaces: true });
    }
    const t = state.terminals.find((x) => x.handle === option(argv, "--terminal"));
    if (!t) fail("terminal_handle_stale", "terminal_handle_stale");
    const failClose = join(stateDir, "fail-next-close");
    if (existsSync(failClose)) {
      rmSync(failClose);
      fail("runtime_unavailable", "runtime_unavailable");
    }
    closeTerminal(t);
    save(state);
    ok({ close: { handle: t.handle, ptyKilled: true } });
    break;
  }
  default:
    fail("unknown_command", `The fake Orca has no command ${command}`);
}
