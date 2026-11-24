// Test helpers of the sessions: awd with sessions on, a private tmux socket, the fake claude, a git
// checkout bound to the project, and writers for the logs of other devices. Not in the package index.
import { FAKE_CLAUDE } from "@aw/agent-claude/testing";
import { AwClient } from "@aw/client";
import type { EventRow, TaskView } from "@aw/core";
import { OrcaHost } from "@aw/host-orca";
import { fakeOrcaWrapper } from "@aw/host-orca/testing";
import { findTmux, TmuxHost } from "@aw/host-tmux";
import type { EventType } from "@aw/schema";
import { execa } from "execa";
import { chmod, mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tokenFile } from "../mcp/tokens.ts";
import { otherDevice, startTestDaemon, tempDir, waitFor, type TestDaemon } from "../testing.ts";
import { listRecords } from "./records.ts";

/** The tmux binary of the tests: AW_E2E_TMUX, else PATH without a `/.orca/` shim. */
export const TEST_TMUX = process.env.AW_E2E_TMUX ?? (await findTmux(process.env.PATH));

let counter = 0;

export interface SessionTestDaemon extends TestDaemon {
  socket: string;
  checkout: string;
  host: TmuxHost;
  /** The Orca host of the test (the fake or the real Orca CLI), or null without Orca. */
  orca: OrcaHost | null;
  /** The state folder of the fake Orca CLI, or null. */
  orcaState: string | null;
  /** Creates a task assigned to claude@macbook-pro; the session starts by itself. */
  createTask(firstMessage: string, sessionHost?: "tmux" | "orca"): Promise<TaskView>;
  task(id: string): Promise<TaskView>;
  rows(task: string): Promise<EventRow[]>;
  /** Waits for an event row of the task that matches. */
  waitRow(task: string, match: (row: EventRow) => boolean, timeoutMs?: number): Promise<EventRow>;
  /** Writes a gate answer as the log line of another device, then merges. */
  answerFrom(device: string, task: string, gate: string, answer: string): Promise<void>;
  /** Writes one person event of another device into the task log, then merges. */
  eventFrom(
    device: string,
    task: string,
    type: EventType,
    data: Record<string, unknown>,
  ): Promise<void>;
  /** Writes `message.sent` to the session as the log line of another device, then merges. */
  sendMessage(device: string, task: string, session: string, text: string): Promise<string>;
  /** The screen of the window of the task. */
  screen(task: string): Promise<string>;
  /** The session record id of the task. */
  session(task: string): string;
  /** The working folder of the newest session of the task (`<home>/worktrees/aw-<key>` by default). */
  worktree(task: string): string;
  /** Waits until the manager of the session ran `count` more checks (no sleep in a test). */
  waitChecks(session: string, count?: number): Promise<void>;
  /** The session token of a session (the content of `mcp-token`). */
  token(session: string): Promise<string>;
  /** The environment of an agent command of the session: AW_SESSION, AW_TASK, AW_MCP_TOKEN. */
  agentEnv(task: string): Promise<Record<string, string>>;
  /** A local API client with the token of the session. */
  agentClient(session: string): Promise<AwClient>;
  /** A local API client with this token (for example a revoked one). */
  agentClientWithToken(token: string): Promise<AwClient>;
}

/**
 * A wrapper of the fake claude: another version (the contract tests do not cover it), more
 * environment for the fake, or a `--version` that fails while a file is missing.
 */
async function claudeWrapper(options: {
  version?: string | undefined;
  env?: Record<string, string> | undefined;
  versionNeeds?: string | undefined;
}): Promise<string> {
  const dir = await tempDir("awv-");
  const path = join(dir, "claude");
  const lines = ["#!/bin/sh"];
  if (options.versionNeeds) {
    lines.push(`if [ "$1" = "--version" ] && [ ! -f "${options.versionNeeds}" ]; then exit 1; fi`);
  }
  if (options.version) {
    lines.push(
      `if [ "$1" = "--version" ]; then echo "${options.version} (Claude Code)"; exit 0; fi`,
    );
  }
  for (const [key, value] of Object.entries(options.env ?? {})) {
    lines.push(`export ${key}='${value}'`);
  }
  lines.push(`exec "${FAKE_CLAUDE}" "$@"`, "");
  await writeFile(path, lines.join("\n"));
  await chmod(path, 0o755);
  return path;
}

/** A tmux wrapper whose first `new-window` fails (a transient tmux failure at a session start). */
async function tmuxFailingOnce(tmux: string): Promise<string> {
  const dir = await tempDir("awt-");
  const path = join(dir, "tmux");
  const marker = join(dir, "failed-once");
  await writeFile(
    path,
    [
      "#!/bin/sh",
      'for arg in "$@"; do',
      `  if [ "$arg" = "new-window" ] && [ ! -f "${marker}" ]; then`,
      `    touch "${marker}"; echo "fake tmux failure" >&2; exit 1`,
      "  fi",
      "done",
      `exec "${tmux}" "$@"`,
      "",
    ].join("\n"),
  );
  await chmod(path, 0o755);
  return path;
}

export async function startSessionDaemon(
  options: {
    permissionTimeoutMs?: number;
    claudeVersion?: string;
    /** `yes-first`: the trust screen of the uncovered version has "Yes" first, under the cursor. */
    trustOrder?: "yes-first";
    /** More environment of the fake claude (for example FAKE_CLAUDE_EXIT_ONCE). */
    fakeEnv?: Record<string, string>;
    /** `claude --version` fails until this file exists (the agent is missing at the start). */
    versionNeeds?: string;
    /** The first `new-window` of tmux fails. */
    tmuxFailsOnce?: boolean;
    startRetryMs?: number;
    prepareRetryMs?: number;
    /** The wait before a host notice: Orca does not answer, or no SessionStart in Orca. */
    hostNoticeMs?: number;
    /** More environment of awd (for example AW_SYNC_ENGINE). */
    env?: Record<string, string>;
    /**
     * Orca on this device: `fake` (the fake Orca CLI on a private tmux server), or the path of a
     * real Orca CLI. The bindings get `use_orca` (default true with Orca).
     */
    orca?: string;
    /** The version of the fake Orca CLI (default 1.4.257). */
    orcaVersion?: string;
    useOrca?: boolean;
  } = {},
): Promise<SessionTestDaemon> {
  const socket = `aw-test-${process.pid}-${++counter}`;
  const env = {
    ...(options.trustOrder ? { FAKE_CLAUDE_TRUST_ORDER: options.trustOrder } : {}),
    ...options.fakeEnv,
  };
  const claude =
    options.claudeVersion || options.versionNeeds || Object.keys(env).length > 0
      ? await claudeWrapper({
          version: options.claudeVersion,
          env,
          versionNeeds: options.versionNeeds,
        })
      : FAKE_CLAUDE;
  const tmux = options.tmuxFailsOnce && TEST_TMUX ? await tmuxFailingOnce(TEST_TMUX) : TEST_TMUX;
  let orcaBinary: string | null = null;
  let orcaState: string | null = null;
  if (options.orca === "fake") {
    const dir = await tempDir("awo-");
    orcaState = join(dir, "state");
    orcaBinary = await fakeOrcaWrapper({
      dir: join(dir, "bin"),
      state: orcaState,
      tmux: TEST_TMUX ?? "tmux",
      socket: `${socket}-orca`,
      ...(options.orcaVersion ? { version: options.orcaVersion } : {}),
    });
  } else if (options.orca) {
    orcaBinary = options.orca;
  }
  const daemon = await startTestDaemon({
    workspace: true,
    sessions: true,
    watch: true,
    env: {
      ...options.env,
      AW_CLAUDE: claude,
      AW_TMUX: tmux ?? "",
      AW_TMUX_SOCKET: socket,
      // Always a known Orca CLI in tests: never the Orca app of the person.
      AW_ORCA: orcaBinary ?? "/nonexistent/orca",
    },
    ...(options.permissionTimeoutMs === undefined
      ? {}
      : { permissionTimeoutMs: options.permissionTimeoutMs }),
    ...(options.startRetryMs === undefined ? {} : { startRetryMs: options.startRetryMs }),
    ...(options.prepareRetryMs === undefined ? {} : { prepareRetryMs: options.prepareRetryMs }),
    ...(options.hostNoticeMs === undefined ? {} : { hostNoticeMs: options.hostNoticeMs }),
  });
  // A name that tells the Orca workspace folder of the test apart (Orca names it after the repo).
  const checkout = join(daemon.home, orcaBinary ? `aw-test-repo-${socket}` : "checkout");
  await mkdir(checkout, { recursive: true });
  const git = (args: string[]) => execa("git", ["-C", checkout, ...args]);
  await git(["init", "-q", "-b", "main"]);
  await writeFile(join(checkout, "README.md"), "test repo\n");
  await git(["add", "."]);
  await git([
    "-c",
    "user.name=AW Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "init",
  ]);
  // The workspace of the test by name: a test can add a second workspace (fix list 0g).
  const service = () => daemon.server.daemon.workspace("acme");
  await service().files.writeDocument("tasks/devices/macbook-pro/bindings.yaml", {
    kind: "bindings",
    schema: 1,
    device: "macbook-pro",
    may_run: true,
    use_orca: options.useOrca ?? orcaBinary !== null,
    checkouts: [{ project: "billing-api", path: checkout }],
  });
  const orca = orcaBinary ? new OrcaHost({ configured: orcaBinary, path: "" }) : null;
  const host = new TmuxHost({
    binary: TEST_TMUX,
    socket,
    configFile: join(daemon.home, "run", "tmux.conf"),
  });
  const rows = async (task: string) =>
    (await daemon.client.thread("acme", task, { limit: 1000 })).events as unknown as EventRow[];
  const waitRow = async (task: string, match: (row: EventRow) => boolean, timeoutMs = 20_000) => {
    let found: EventRow | undefined;
    try {
      await waitFor(async () => {
        found = (await rows(task)).find(match);
        return found !== undefined;
      }, timeoutMs);
    } catch {
      const list = (await rows(task)).map((r) => {
        const d = (r.event as { data: Record<string, unknown> }).data;
        return `${r.type}${r.applied ? "" : ` (not applied: ${r.reason})`} ${JSON.stringify(d.text ?? d.answer ?? d.kind ?? "").slice(0, 160)}`;
      });
      const screen = await result.screen(task).catch(() => "");
      throw new Error(
        `No matching row after ${timeoutMs} ms.\nRows:\n${list.join("\n")}\nScreen:\n${screen.trimEnd().split("\n").slice(-25).join("\n")}`,
      );
    }
    return found!;
  };
  const result: SessionTestDaemon = Object.assign(daemon, {
    socket,
    checkout,
    host,
    orca,
    orcaState,
    async createTask(firstMessage: string, sessionHost?: "tmux" | "orca") {
      const reply = await daemon.client.createTask("acme", {
        project: "billing-api",
        title: "Session test",
        first_message: firstMessage,
        assignee: "claude@macbook-pro",
        ...(sessionHost ? { session_host: sessionHost } : {}),
      });
      return reply.task as unknown as TaskView;
    },
    async task(id: string) {
      return (await daemon.client.task("acme", id)) as unknown as TaskView;
    },
    rows,
    waitRow,
    async answerFrom(device: string, task: string, gate: string, answer: string) {
      const files = otherDevice(daemon.folder, device, {
        role: device === "pixel-9" ? "mobile" : "remote",
      });
      await files.writeEvent(
        `tasks/${task}/log/${device}.jsonl`,
        "gate.answered",
        { gate, version: 1, answer, comment: null },
        { task, by: `human@${device}` },
      );
      await service().refresh();
    },
    async eventFrom(device: string, task: string, type: EventType, data: Record<string, unknown>) {
      const files = otherDevice(daemon.folder, device, {
        role: device === "pixel-9" ? "mobile" : "remote",
      });
      await files.writeEvent(`tasks/${task}/log/${device}.jsonl`, type, data, {
        task,
        by: `human@${device}`,
      });
      await service().refresh();
    },
    async sendMessage(device: string, task: string, session: string, text: string) {
      const files = otherDevice(daemon.folder, device, {
        role: device === "pixel-9" ? "mobile" : "remote",
      });
      const id = files.newId();
      await files.writeEvent(
        `tasks/${task}/log/${device}.jsonl`,
        "message.sent",
        { id, text, to_session: session },
        { task, by: `human@${device}` },
      );
      await service().refresh();
      return id;
    },
    async screen(task: string) {
      const pane = (await host.list()).find((p) => p.name === `aw-${task}`);
      if (!pane) return "";
      return host.capture(
        { host: "tmux", window: pane.window, pane: pane.pane, pid: pane.pid, pgid: pane.pid },
        200,
      );
    },
    worktree(task: string) {
      const record = daemon.server.daemon.sessions
        ?.list()
        .filter((s) => s.task === task)
        .at(-1);
      if (!record) throw new Error(`No session of ${task}`);
      return record.cwd;
    },
    session(task: string) {
      const record = daemon.server.daemon.sessions
        ?.list()
        .find((s) => s.task === task && s.state === "running");
      if (!record) throw new Error(`No running session of ${task}`);
      return record.id;
    },
    async token(session: string) {
      return (await readFile(tokenFile(daemon.home, session), "utf8")).trim();
    },
    async agentEnv(task: string) {
      const session = result.session(task);
      return {
        AW_SESSION: session,
        AW_TASK: task,
        AW_MCP_TOKEN: await result.token(session),
        AW_HOME: daemon.home,
        HOME: daemon.userHome,
      };
    },
    async agentClient(session: string) {
      return result.agentClientWithToken(await result.token(session));
    },
    agentClientWithToken(token: string) {
      return Promise.resolve(new AwClient({ socketPath: daemon.settings.socketPath, token }));
    },
    async waitChecks(session: string, count = 3) {
      const manager = daemon.server.daemon.sessions!.manager(session);
      const end = manager.checks + count;
      await waitFor(() => Promise.resolve(manager.checks >= end), 20_000);
    },
  });
  result.close = async () => {
    // Stop awd, then the agents, then remove the folders: a hook of a running agent can still
    // write its spool while the folder is removed (ENOTEMPTY), so rm tries again.
    await daemon.server.close();
    if (orca) {
      // awd leaves the sessions running: stop each Orca session, then remove what the test made
      // in Orca (the worktrees, their branches and the repo entry).
      const full = await listRecords(daemon.home);
      for (const record of full) {
        if (record.host !== "orca" || !record.pane) continue;
        await orca.stop(record.pane, { graceMs: 1000 }).catch(() => undefined);
        await orca.close(record.pane).catch(() => undefined);
      }
      const worktrees = new Set(
        full.filter((r) => r.host === "orca" && r.pane).map((r) => r.pane!.window),
      );
      for (const id of worktrees) {
        await orca.removeWorktreeById(id).catch(() => undefined);
        const folder = dirname(id.slice(id.indexOf("::") + 2));
        if ((await readdir(folder).catch(() => ["x"])).length === 0) await rmdir(folder);
      }
      await orca.forgetRepo(checkout).catch(() => undefined);
      if (orcaState && TEST_TMUX) {
        await execa(TEST_TMUX, ["-L", `${socket}-orca`, "kill-server"], { reject: false });
        await rm(dirname(orcaState), { recursive: true, force: true });
      }
    }
    await host.killServer();
    for (const dir of [daemon.home, daemon.folder]) {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  };
  return result;
}

export { waitFor };
