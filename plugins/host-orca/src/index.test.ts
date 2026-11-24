// Tests of the Orca host: the reply parser with the captured replies of orca-ide 1.4.257, and the
// host against the fake Orca CLI, whose terminals run in a real tmux on a private socket.
import { execa } from "execa";
import { constants, existsSync } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MAC_APP_CLI,
  MAX_TEXT_BYTES,
  OrcaError,
  OrcaHost,
  orcaCandidates,
  orcaReplies,
  packageName,
  parseReply,
  terminalCommand,
} from "./index.ts";
import { processExists, processTable } from "./process-table.ts";
import { capturedReply, fakeOrcaWrapper } from "./testing/index.ts";

async function waitFor(check: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`The condition was not true after ${ms} ms`);
}

/** The first tmux in PATH that is not an agent shim in a `/.orca/` folder. */
async function findTmux(): Promise<string | null> {
  if (process.env.AW_E2E_TMUX) return process.env.AW_E2E_TMUX;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir || dir.includes("/.orca/")) continue;
    const candidate = join(dir, "tmux");
    if (
      await access(candidate, constants.X_OK).then(
        () => true,
        () => false,
      )
    )
      return candidate;
  }
  return null;
}

const tmux = await findTmux();

describe("@aw/host-orca", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@aw/host-orca");
  });

  it("parses the captured replies of orca-ide 1.4.257 with the declared schemas", () => {
    const status = parseReply(capturedReply("status.json"), "status", orcaReplies.status);
    expect(status).toMatchObject({ runtime: { state: "ready", reachable: true } });
    const created = parseReply(
      capturedReply("terminal-create.json"),
      "terminal create",
      orcaReplies.terminalCreate,
    );
    expect(created.terminal.handle).toMatch(/^term_/);
    expect(created.terminal.processId).toBeGreaterThan(1);
    const pairs: [string, keyof typeof orcaReplies][] = [
      ["repo-list.json", "repoList"],
      ["repo-list-empty.json", "repoList"],
      ["repo-add.json", "repoAdd"],
      ["worktree-list.json", "worktreeList"],
      ["worktree-create.json", "worktreeCreate"],
      ["terminal-list.json", "terminalList"],
      ["terminal-list-first.json", "terminalList"],
      ["terminal-show-live.json", "terminalShow"],
      ["terminal-show-exited.json", "terminalShow"],
      ["terminal-show-signaled.json", "terminalShow"],
      ["terminal-show-closed.json", "terminalShow"],
      ["terminal-send-unsupported.json", "terminalSend"],
      ["terminal-close.json", "any"],
      ["terminal-close-all.json", "any"],
      ["worktree-rm.json", "any"],
      ["setup-delete.json", "any"],
    ];
    for (const [file, schema] of pairs) {
      expect(() => parseReply(capturedReply(file), file, orcaReplies[schema])).not.toThrow();
    }
    expect(() =>
      parseReply(capturedReply("terminal-show-stale.json"), "terminal show", orcaReplies.any),
    ).toThrow(expect.objectContaining({ code: "terminal_handle_stale", requestId: null }));
    expect(() =>
      parseReply(capturedReply("status-down.json"), "status", orcaReplies.status),
    ).toThrow(expect.objectContaining({ code: "runtime_unavailable" }));
    let lost: unknown;
    try {
      parseReply(
        capturedReply("terminal-send-not-writable.json"),
        "terminal send",
        orcaReplies.any,
      );
    } catch (error) {
      lost = error;
    }
    expect(lost).toBeInstanceOf(OrcaError);
    expect((lost as OrcaError).requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(() => parseReply("Orca is not running", "status", orcaReplies.status)).toThrow(
      expect.objectContaining({ code: "bad_reply" }),
    );
    // A changed reply gives one clear error at the parse: here `processId` is a text.
    const changed = JSON.parse(capturedReply("terminal-create.json")) as {
      result: { terminal: Record<string, unknown> };
    };
    changed.result.terminal.processId = "4242";
    expect(() =>
      parseReply(JSON.stringify(changed), "terminal create", orcaReplies.terminalCreate),
    ).toThrow(
      expect.objectContaining({
        code: "bad_reply",
        message: expect.stringContaining("terminal.processId") as unknown,
      }),
    );
  });

  it("builds the terminal command with exec and no message", () => {
    const command = terminalCommand(["/opt/aw/daemon/bin/aw-launch", "01a2038e-7f00-7000"], {
      AW_NODE: "/usr/bin/node",
      AW_HOME: "/home/user/.aw",
    });
    expect(command).toBe(
      "exec env AW_NODE='/usr/bin/node' AW_HOME='/home/user/.aw' '/opt/aw/daemon/bin/aw-launch' '01a2038e-7f00-7000'",
    );
    expect(() => terminalCommand(["/tmp/it's", "x"], {})).toThrow(/does not put/);
    expect(() => terminalCommand(["/a", "b\nrm -rf"], {})).toThrow(/does not put/);
    expect(() => terminalCommand(["/a"], {})).toThrow(/2 or more/);
    expect(() => terminalCommand(["/a", "b"], { "A B": "x" })).toThrow(/not a name/);
  });

  it("looks for AW_ORCA, the app bundle, orca-ide, then orca", () => {
    expect(
      orcaCandidates({ configured: "/opt/orca", platform: "darwin", path: "/usr/bin:/bin" }),
    ).toEqual([
      "/opt/orca",
      MAC_APP_CLI,
      "/usr/bin/orca-ide",
      "/bin/orca-ide",
      "/usr/bin/orca",
      "/bin/orca",
    ]);
    expect(orcaCandidates({ configured: null, platform: "linux", path: "/usr/bin" })).toEqual([
      "/usr/bin/orca-ide",
      "/usr/bin/orca",
    ]);
  });
});

describe.skipIf(!tmux)("the Orca host with the fake Orca CLI", () => {
  let dir: string;
  let checkout: string;
  let socket: string;
  let state: string;
  let orca: string;
  let host: OrcaHost;
  const warnings: string[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "awo-"));
    socket = `aw-test-orca-${process.pid}`;
    state = join(dir, "orca-state");
    orca = await fakeOrcaWrapper({ dir: join(dir, "bin"), state, tmux: tmux!, socket });
    checkout = join(dir, "checkout");
    await mkdir(checkout);
    const git = (args: string[]) => execa("git", ["-C", checkout, ...args]);
    await git(["init", "-q", "-b", "main"]);
    await git([
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    ]);
    host = new OrcaHost({
      configured: orca,
      path: "",
      warn: (m) => warnings.push(m),
    });
  });

  afterAll(async () => {
    await execa(tmux!, ["-L", socket, "kill-server"], { reject: false });
    await rm(dir, { recursive: true, force: true });
  });

  /** A program that turns on bracketed paste and writes each read to a file, with its pids. */
  async function reader(name: string): Promise<{ command: string[]; out: string; pids: string }> {
    const out = join(dir, `${name}.out`);
    const pids = join(dir, `${name}.pids`);
    const script = join(dir, `${name}.mjs`);
    await writeFile(
      script,
      [
        'import { appendFileSync, writeFileSync } from "node:fs";',
        'import { spawn } from "node:child_process";',
        'const child = spawn("sleep", ["300"], { stdio: "ignore" });',
        `writeFileSync(${JSON.stringify(pids)}, process.pid + " " + child.pid);`,
        "process.stdin.setRawMode(true);",
        'process.stdout.write("\\u001b[?2004h> ");',
        `process.stdin.on("data", (b) => appendFileSync(${JSON.stringify(out)}, JSON.stringify(b.toString()) + "\\n"));`,
      ].join("\n"),
    );
    return { command: [process.execPath, script], out, pids };
  }

  it("detects the fake Orca 1.4.257, and refuses an older one and a stopped runtime", async () => {
    expect(await host.detect()).toMatchObject({
      name: "orca",
      available: true,
      binary: orca,
      version: "1.4.257",
      reason: null,
    });
    const old = await fakeOrcaWrapper({
      dir: join(dir, "old"),
      state,
      tmux: tmux!,
      socket,
      version: "1.4.200",
    });
    const info = await new OrcaHost({ configured: old, path: "" }).detect();
    expect(info).toMatchObject({ available: false, binary: old, version: "1.4.200" });
    expect(info.reason).toContain("1.4.257");
    await writeFile(join(state, "down"), "");
    try {
      const down = await new OrcaHost({ configured: orca, path: "" }).detect();
      expect(down.available).toBe(false);
      expect(down.reason).toContain("could not connect to Orca");
    } finally {
      await rm(join(state, "down"));
    }
  });

  it("skips an orca in PATH that gives no version x.y.z (a screen reader)", async () => {
    const bin = join(dir, "reader-bin");
    await mkdir(bin);
    await writeFile(join(bin, "orca"), "#!/bin/sh\necho 'orca 46.1'\n");
    await chmod(join(bin, "orca"), 0o755);
    const info = await new OrcaHost({ configured: null, path: bin, platform: "linux" }).detect();
    expect(info).toMatchObject({ available: false, binary: null });
  });

  it("reads the version at the start of the first line: a prerelease and a warning line", async () => {
    const odd = join(dir, "odd-bin");
    await mkdir(odd);
    const binary = join(odd, "orca-ide");
    await writeFile(
      binary,
      `#!/bin/sh\nif [ "$1" = --version ]; then printf '1.4.300-beta.2\\nwarning: an old config\\n'; exit 0; fi\nexec ${JSON.stringify(orca)} "$@"\n`,
    );
    await chmod(binary, 0o755);
    const info = await new OrcaHost({ configured: binary, path: "" }).detect();
    expect(info).toMatchObject({ available: true, binary, version: "1.4.300", reason: null });
  });

  it("is available with no setting: a maintainer approved the text in the argv for phase 1", async () => {
    const info = await new OrcaHost({ configured: orca, path: "" }).detect();
    expect(info).toMatchObject({ available: true, binary: orca, version: "1.4.257", reason: null });
  });

  it("adds an unknown repo, makes the worktree once, and closes its first terminal", async () => {
    const first = await host.worktree({ name: "aw-task-1", checkout, branch: "aw/AW-1" });
    expect(first.branch).toBe("aw/AW-1");
    expect(existsSync(join(first.path, ".git"))).toBe(true);
    const saved = JSON.parse(await readFile(join(state, "state.json"), "utf8")) as {
      repos: { path: string }[];
    };
    expect(saved.repos).toHaveLength(1);
    const listed = await execa(orca, [
      "terminal",
      "list",
      "--worktree",
      `id:${first.id}`,
      "--json",
    ]);
    expect(
      (JSON.parse(listed.stdout) as { result: { terminals: unknown[] } }).result.terminals,
    ).toEqual([]);
    const again = await host.worktree({ name: "aw-task-1", checkout, branch: "aw/AW-1" });
    expect(again).toEqual(first);
    expect(
      (JSON.parse(await readFile(join(state, "state.json"), "utf8")) as { repos: unknown[] }).repos,
    ).toHaveLength(1);
  });

  it("finds the worktree of an older name of the task (session-options: aw-<key>)", async () => {
    const old = await host.worktree({ name: "aw-task-20", checkout, branch: "aw/AW-20" });
    const again = await host.worktree({
      name: "aw-AW-20",
      aliases: ["aw-task-20"],
      checkout,
      branch: "aw/AW-20",
    });
    expect(again).toEqual(old);
  });

  it("checks out a free branch of the task, and refuses a branch that another folder has", async () => {
    await execa("git", ["-C", checkout, "branch", "aw/AW-2"]);
    const commit = async (args: string[]) => execa("git", args);
    // CI runners have no git identity: give one for this commit.
    await commit([
      "-C",
      checkout,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "on main only",
    ]);
    const base = (await commit(["-C", checkout, "rev-parse", "aw/AW-2"])).stdout;
    const made = await host.worktree({ name: "aw-task-2", checkout, branch: "aw/AW-2" });
    // The branch of the task, with its work: no new branch `aw/AW-2-2`.
    expect(made.branch).toBe("aw/AW-2");
    expect((await commit(["-C", made.path, "rev-parse", "HEAD"])).stdout).toBe(base);
    // The branch is checked out in a git worktree of the tmux host: Orca would make `aw/AW-10-2`.
    const plain = join(dir, "plain-AW-10");
    await commit(["-C", checkout, "worktree", "add", "-q", "-b", "aw/AW-10", plain, "main"]);
    await expect(
      host.worktree({ name: "aw-task-10", checkout, branch: "aw/AW-10" }),
    ).rejects.toMatchObject({ code: "branch_in_use" });
    const branches = (await commit(["-C", checkout, "branch", "--list", "aw/AW-10*"])).stdout;
    expect(branches).not.toContain("aw/AW-10-2");
    await commit(["-C", checkout, "worktree", "remove", plain]);
  });

  it("refuses an Orca worktree of the task that a person switched to another branch", async () => {
    const wt = await host.worktree({ name: "aw-task-11", checkout, branch: "aw/AW-11" });
    await execa("git", ["-C", wt.path, "checkout", "-q", "-b", "person-11"]);
    await expect(
      host.worktree({ name: "aw-task-11", checkout, branch: "aw/AW-11" }),
    ).rejects.toMatchObject({ code: "branch_changed" });
    await execa("git", ["-C", wt.path, "checkout", "-q", "aw/AW-11"]);
    expect(await host.worktree({ name: "aw-task-11", checkout, branch: "aw/AW-11" })).toEqual(wt);
  });

  it("closes the first terminal of a new worktree at the next start when its close failed", async () => {
    const terminals = async (id: string) =>
      (
        JSON.parse(
          (await execa(orca, ["terminal", "list", "--worktree", `id:${id}`, "--json"])).stdout,
        ) as { result: { terminals: unknown[] } }
      ).result.terminals;
    await writeFile(join(state, "fail-next-close-all"), "");
    await expect(
      host.worktree({ name: "aw-task-12", checkout, branch: "aw/AW-12" }),
    ).rejects.toMatchObject({ code: "runtime_unavailable" });
    const saved = JSON.parse(await readFile(join(state, "state.json"), "utf8")) as {
      worktrees: { id: string; displayName: string }[];
    };
    const id = saved.worktrees.find((w) => w.displayName === "aw-task-12")!.id;
    // The login shell of Orca is still open.
    expect(await terminals(id)).toHaveLength(1);
    const again = await host.worktree({ name: "aw-task-12", checkout, branch: "aw/AW-12" });
    expect(again.id).toBe(id);
    expect(await terminals(id)).toEqual([]);
  });

  it("opens a terminal, sends one bracketed paste, and stops the whole process group", async () => {
    const wt = await host.worktree({ name: "aw-task-3", checkout, branch: "aw/AW-3" });
    const program = await reader("p3");
    const ref = await host.open({
      name: "aw-task-3",
      cwd: wt.path,
      command: program.command,
      env: { AW_HOME: join(dir, "aw-home") },
    });
    expect(ref).toMatchObject({
      host: "orca",
      window: wt.id,
      pane: expect.stringMatching(/^term_/) as unknown,
    });
    expect(ref.pgid).toBe(ref.pid);
    await waitFor(() => existsSync(program.pids));
    const [pid, child] = (await readFile(program.pids, "utf8")).split(" ").map(Number);
    // exec replaced the shell: the terminal pid is the program.
    expect(pid).toBe(ref.pid);
    const row = (await processTable()).find((r) => r.pid === child);
    expect(row?.pgid).toBe(ref.pgid);
    expect(await host.find(ref)).toMatchObject({ pid: ref.pid, dead: false, status: null });
    expect(await host.alive(ref)).toBe(true);
    // list() names a terminal after its worktree folder: a program can change the title.
    const file = join(state, "state.json");
    const saved = JSON.parse(await readFile(file, "utf8")) as {
      terminals: { handle: string; title: string }[];
    };
    saved.terminals.find((t) => t.handle === ref.pane)!.title = "user@ubuntu-01: ~";
    await writeFile(file, JSON.stringify(saved, null, 2));
    expect((await host.list()).find((p) => p.pane === ref.pane)).toMatchObject({
      name: "aw-task-3",
      window: wt.id,
    });

    await host.submit(ref, "[AW answer 1] line one\nline two");
    await waitFor(() => existsSync(program.out));
    await waitFor(async () => (await readFile(program.out, "utf8")).includes("\\r"));
    const reads = (await readFile(program.out, "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as string);
    expect(reads.join("")).toBe("\u001b[200~[AW answer 1] line one\nline two\u001b[201~\r");
    // The reader is not a known agent of Orca: the host warns about the text of 2 lines.
    expect(warnings).toEqual([expect.stringContaining("more than one prompt")]);
    warnings.length = 0;

    await host.stop(ref, { graceMs: 1000 });
    expect(processExists(pid!)).toBe(false);
    expect(processExists(child!)).toBe(false);
    await host.close(ref);
    expect(await host.find(ref)).toMatchObject({ dead: true, status: null });
    expect(await host.alive(ref)).toBe(false);
    await host.close(ref);
  });

  it("gives the exit status of a killed terminal, and null for an unknown handle", async () => {
    const wt = await host.worktree({ name: "aw-task-4", checkout, branch: "aw/AW-4" });
    const program = await reader("p4");
    const ref = await host.open({
      name: "aw-task-4",
      cwd: wt.path,
      command: program.command,
      env: {},
    });
    await waitFor(() => existsSync(program.pids));
    process.kill(ref.pid, "SIGTERM");
    await waitFor(async () => (await host.find(ref))?.dead === true);
    expect(await host.find(ref)).toMatchObject({ dead: true, status: 143 });
    expect(
      await host.find({ ...ref, pane: "term_00000000-0000-0000-0000-000000000000" }),
    ).toBeNull();
    const [, child] = (await readFile(program.pids, "utf8")).split(" ").map(Number);
    // A dead terminal: only the group members that started after the open get a signal.
    await host.stop(ref, { graceMs: 500 });
    expect(processExists(child!)).toBe(false);
  });

  it("signals nothing for another incarnation of the terminal", async () => {
    const wt = await host.worktree({ name: "aw-task-5", checkout, branch: "aw/AW-5" });
    const program = await reader("p5");
    const ref = await host.open({
      name: "aw-task-5",
      cwd: wt.path,
      command: program.command,
      env: {},
    });
    await waitFor(() => existsSync(program.pids));
    const other = { ...ref, instance: "00000000-0000-0000-0000-000000000000" };
    expect(await host.find(other)).toMatchObject({ pid: 0 });
    await host.stop(other, { graceMs: 200 });
    expect(processExists(ref.pid)).toBe(true);
    await host.stop(ref, { graceMs: 1000 });
    expect(processExists(ref.pid)).toBe(false);
  });

  it("sends a text again with --retry-request after a lost reply, and Orca does not send it twice", async () => {
    const wt = await host.worktree({ name: "aw-task-6", checkout, branch: "aw/AW-6" });
    const program = await reader("p6");
    const ref = await host.open({
      name: "aw-task-6",
      cwd: wt.path,
      command: program.command,
      env: {},
    });
    await waitFor(() => existsSync(program.pids));
    await writeFile(join(state, "fail-next-send"), "");
    await expect(host.submit(ref, "only once")).rejects.toMatchObject({
      code: "transport_timeout",
    });
    await host.submit(ref, "only once");
    await waitFor(
      async () => existsSync(program.out) && (await readFile(program.out, "utf8")).includes("\\r"),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const text = (await readFile(program.out, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string)
      .join("");
    expect(text.split("only once")).toHaveLength(2);
    await host.stop(ref, { graceMs: 1000 });
    await host.close(ref);
  });

  it("keeps the request id after terminal_not_writable, refuses a long text, and reads the given clock", async () => {
    const timed = new OrcaHost({
      configured: orca,
      path: "",
      now: () => 1_700_000_000_000,
    });
    const wt = await timed.worktree({ name: "aw-task-9", checkout, branch: "aw/AW-9" });
    const program = await reader("p9");
    const ref = await timed.open({
      name: "aw-task-9",
      cwd: wt.path,
      command: program.command,
      env: {},
    });
    expect(ref.opened).toBe(1_700_000_000_000);
    await waitFor(() => existsSync(program.pids));
    await expect(timed.submit(ref, "x".repeat(MAX_TEXT_BYTES + 1))).rejects.toMatchObject({
      code: "text_too_large",
    });
    process.kill(ref.pid, "SIGKILL");
    await waitFor(async () => (await timed.find(ref))?.dead === true);
    let first: OrcaError | undefined;
    await timed.submit(ref, "to a dead agent").catch((error: OrcaError) => (first = error));
    expect(first).toMatchObject({ code: "terminal_not_writable" });
    expect(first!.requestId).toMatch(/^[0-9a-f-]{36}$/);
    // Orca: "Re-issue the exact command with --retry-request <id>": the same id comes back.
    let second: OrcaError | undefined;
    await timed.submit(ref, "to a dead agent").catch((error: OrcaError) => (second = error));
    expect(second).toMatchObject({ code: "terminal_not_writable", requestId: first!.requestId });
    await timed.close(ref);
  });

  it("throws while the runtime does not answer, and stops nothing", async () => {
    const wt = await host.worktree({ name: "aw-task-7", checkout, branch: "aw/AW-7" });
    const program = await reader("p7");
    const ref = await host.open({
      name: "aw-task-7",
      cwd: wt.path,
      command: program.command,
      env: {},
    });
    await waitFor(() => existsSync(program.pids));
    await writeFile(join(state, "down"), "");
    try {
      await expect(host.find(ref)).rejects.toMatchObject({ code: "runtime_unavailable" });
      expect(await host.alive(ref)).toBe(false);
      await expect(host.stop(ref, { graceMs: 200 })).rejects.toMatchObject({
        code: "runtime_unavailable",
      });
      expect(processExists(ref.pid)).toBe(true);
    } finally {
      await rm(join(state, "down"));
    }
    expect(await host.alive(ref)).toBe(true);
    await expect(host.paste()).rejects.toThrow(/submit/);
    expect(await host.capture()).toBe("");
    await host.stop(ref, { graceMs: 1000 });
  });

  it("removes its worktree and the repo entry", async () => {
    const wt = await host.worktree({ name: "aw-task-8", checkout, branch: "aw/AW-8" });
    await host.removeWorktreeById(wt.id);
    expect(existsSync(wt.path)).toBe(false);
    await host.forgetRepo(checkout);
    const saved = JSON.parse(await readFile(join(state, "state.json"), "utf8")) as {
      repos: unknown[];
    };
    expect(saved.repos).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
