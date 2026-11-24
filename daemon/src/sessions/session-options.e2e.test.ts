// The session options with tmux and the fake agent (openspec session-options): the launch of each
// permission mode, the AW guard in skip mode, an agent subtask with no skip, the worktree folder
// named by the key, the project checkout (one session at a time), another folder, and the stop
// request of the phone.
import type { EventRow } from "@aw/core";
import { execa } from "execa";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir, waitFor } from "../testing.ts";
import { listRecords, sessionPaths } from "./records.ts";
import { startSessionDaemon, TEST_TMUX, type SessionTestDaemon } from "./testing.ts";

const data = (row: EventRow) => (row.event as { data: Record<string, unknown> }).data;
const text = (row: EventRow) =>
  typeof data(row).text === "string" ? (data(row).text as string) : "";

let awd: SessionTestDaemon | null = null;

afterEach(async () => {
  await awd?.close();
  awd = null;
});

/** Creates a task as a person with the CLI and returns its id. */
async function create(d: SessionTestDaemon, message: string, flags: string[]): Promise<string> {
  const result = await d.aw([
    "--json",
    "task",
    "create",
    "--project",
    "billing-api",
    "--title",
    "Options test",
    "--first-message",
    message,
    "--assignee",
    "claude@macbook-pro",
    ...flags,
  ]);
  expect(result.code, result.stderr).toBe(0);
  return (JSON.parse(result.stdout) as { task: { id: string } }).task.id;
}

async function recordOf(d: SessionTestDaemon, task: string) {
  const records = (await listRecords(d.home)).filter((r) => r.task === task);
  return records.at(-1)!;
}

describe.skipIf(!TEST_TMUX)("session options with tmux and the fake agent", () => {
  it("starts a skip team session with no dialog, and the guard still denies a person command", async () => {
    awd = await startSessionDaemon();
    const task = await create(awd, "reply ready", ["--permission-mode", "skip", "--agent-teams"]);
    const started = await awd.waitRow(task, (r) => r.type === "session.started");
    // The warning dialog of bypass mode would block the fake agent before SessionStart.
    expect(data(started)).toMatchObject({
      permission_mode: "skip",
      agent_teams: true,
      work_in: "worktree",
      branch: "aw/AW-1",
    });
    expect(String(data(started).cwd)).toBe(join(awd.home, "worktrees", "aw-AW-1"));
    const record = await recordOf(awd, task);
    expect(record.launch).toMatchObject({ permission_mode: "skip", agent_teams: true });
    const paths = sessionPaths(awd.home, record.id);
    const launch = JSON.parse(await readFile(paths.launch, "utf8")) as {
      args: string[];
      guard: { home: string; workspaces: string[] };
    };
    expect(launch.args[launch.args.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    expect(launch.guard.home).toBe(awd.home);
    expect(launch.guard.workspaces).toContain(awd.folder);
    const settings = JSON.parse(await readFile(paths.settings, "utf8")) as Record<string, unknown>;
    expect(settings).toMatchObject({
      skipDangerousModePermissionPrompt: true,
      env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" },
      teammateMode: "in-process",
    });
    expect((settings.permissions as { deny: string[] }).deny).toContain("Bash(aw gate answer *)");
    await awd.waitRow(task, (r) => r.type === "message.agent" && text(r) === "ready");
    const view = await awd.task(task);
    expect(view.session_options).toMatchObject({ permission_mode: "skip", agent_teams: true });

    const session = awd.session(task);
    // Skip mode: a Write runs with no gate "Approve command".
    await awd.sendMessage("pixel-9", task, session, "write notes.txt done");
    await awd.waitRow(task, (r) => r.type === "message.agent" && text(r).includes("notes.txt"));
    expect(await readFile(join(awd.worktree(task), "notes.txt"), "utf8")).toContain("done");
    // A wrapped person command and an edit of AW state: the guard denies both in skip mode.
    await awd.sendMessage("pixel-9", task, session, 'bash sh -c "aw task assign AW-1 claude@x"');
    await awd.waitRow(
      task,
      (r) => r.type === "comment.added" && text(r).startsWith("AW denied Bash:"),
    );
    await awd.sendMessage("pixel-9", task, session, `bash cat ${awd.home}/run/mcp.port`);
    const second = await awd.waitRow(
      task,
      (r) => r.type === "comment.added" && text(r).includes("names the AW state folder"),
    );
    expect(text(second)).toContain("Reason:");
    const rows = await awd.rows(task);
    expect(rows.some((r) => r.type === "gate.opened" && data(r).kind === "approve_command")).toBe(
      false,
    );
    expect((await awd.task(task)).assignee).toBe("claude@macbook-pro");
  }, 90_000);

  it("never gives the project skip to an agent subtask", async () => {
    awd = await startSessionDaemon();
    expect(
      (await awd.aw(["project", "edit", "billing-api", "--permission-mode", "skip"])).code,
    ).toBe(0);
    const parent = await create(awd, "reply parent", []);
    await awd.waitRow(parent, (r) => r.type === "message.agent");
    expect((await recordOf(awd, parent)).launch.permission_mode).toBe("skip");
    const session = awd.session(parent);
    // The CLI of a session refuses the options: only a person sets them.
    await awd.sendMessage(
      "pixel-9",
      parent,
      session,
      "bash aw task create --title s0 --first-message x --permission-mode skip",
    );
    const refused = await awd.waitRow(
      parent,
      (r) => r.type === "message.agent" && text(r).includes("only a person does"),
    );
    expect(text(refused)).toContain("session options");
    await awd.sendMessage(
      "pixel-9",
      parent,
      session,
      "bash aw task create --title Sub --first-message 'reply sub'",
    );
    await awd.waitRow(parent, (r) => r.type === "message.agent" && text(r).includes("Created"));
    const sub = (await awd.client.tasks("acme")).find((t) => t.parent === parent)!;
    expect(sub.created_by).toBe("claude@macbook-pro");
    expect((await awd.aw(["task", "assign", sub.id, "claude@macbook-pro"])).code).toBe(0);
    const started = await awd.waitRow(sub.id, (r) => r.type === "session.started");
    expect(data(started).permission_mode).toBe("default");
    expect((await recordOf(awd, sub.id)).launch.permission_mode).toBe("default");
  }, 90_000);

  it("works in the project checkout, one session at a time", async () => {
    awd = await startSessionDaemon();
    const a = await create(awd, "reply in checkout", ["--work-in", "checkout"]);
    const started = await awd.waitRow(a, (r) => r.type === "session.started");
    expect(data(started)).toMatchObject({ cwd: awd.checkout, work_in: "checkout" });
    const head = await execa("git", ["-C", awd.checkout, "symbolic-ref", "--short", "HEAD"]);
    expect(head.stdout).toBe("aw/AW-1");
    const b = await create(awd, "reply second", ["--work-in", "checkout"]);
    const refused = await awd.waitRow(
      b,
      (r) => r.type === "comment.added" && text(r).includes("has the session of AW-1"),
    );
    expect(text(refused)).toContain("one session at a time");
    expect((await awd.rows(b)).some((r) => r.type === "session.started")).toBe(false);
  }, 90_000);

  it("works in another folder as it is, and refuses a folder in the AW state folder", async () => {
    awd = await startSessionDaemon();
    const folder = join(await tempDir("aw-so-folder-"), "service");
    await mkdir(folder);
    const task = await create(awd, "reply in folder", ["--work-in", "folder", "--folder", folder]);
    const started = await awd.waitRow(task, (r) => r.type === "session.started");
    expect(data(started)).toMatchObject({ cwd: folder, work_in: "folder", branch: null });
    await awd.waitRow(task, (r) => r.type === "message.agent" && text(r) === "in folder");
    // No worktree and no branch change: the folder is not a git repository.
    expect((await execa("git", ["-C", folder, "status"], { reject: false })).exitCode).not.toBe(0);
    // A second task in the same folder, or in a folder that holds it, gets no session (soc-9).
    for (const second of [folder, dirname(folder)]) {
      const busy = await create(awd, "reply no", ["--work-in", "folder", "--folder", second]);
      await awd.waitRow(
        busy,
        (r) => r.type === "comment.added" && text(r).includes("one session at a time in a folder"),
      );
      expect((await awd.rows(busy)).some((r) => r.type === "session.started")).toBe(false);
    }
    const bad = await create(awd, "reply no", [
      "--work-in",
      "folder",
      "--folder",
      join(awd.home, "run"),
    ]);
    await awd.waitRow(
      bad,
      (r) => r.type === "comment.added" && text(r).includes("which only awd changes"),
    );
    expect((await awd.rows(bad)).some((r) => r.type === "session.started")).toBe(false);
    // A folder that holds AW_HOME (the user home, for example) gives the agent the keys: refused.
    const parent = await create(awd, "reply no", [
      "--work-in",
      "folder",
      "--folder",
      dirname(awd.home),
    ]);
    await awd.waitRow(
      parent,
      (r) =>
        r.type === "comment.added" && text(r).includes("it holds") && text(r).includes(awd!.home),
    );
    expect((await awd.rows(parent)).some((r) => r.type === "session.started")).toBe(false);
  }, 90_000);

  it("never works in the aw-<key> folder of another workspace, and guards each workspace folder", async () => {
    awd = await startSessionDaemon();
    // Another workspace of this device has its own AW-1: its worktree aw-AW-1 of another repository
    // on the branch aw/AW-1 (check soc-6).
    const other = await tempDir("aw-so-other-");
    const run = (args: string[]) => execa("git", ["-C", other, ...args]);
    await run(["init", "-q", "-b", "main"]);
    await run([
      "-c",
      "user.name=AW",
      "-c",
      "user.email=aw@example.com",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "other",
    ]);
    const foreign = join(awd.home, "worktrees", "aw-AW-1");
    await mkdir(join(awd.home, "worktrees"), { recursive: true });
    await run(["worktree", "add", "-q", "-b", "aw/AW-1", foreign]);
    const side = await tempDir("aw-so-side-");
    await awd.client.initWorkspace({ path: side, name: "side" });
    const task = await create(awd, "reply ready", ["--workspace", "acme"]);
    const started = await awd.waitRow(task, (r) => r.type === "session.started");
    expect(String(data(started).cwd)).toBe(join(awd.home, "worktrees", "aw-AW-1-2"));
    await awd.waitRow(task, (r) => r.type === "message.agent" && text(r) === "ready");
    expect((await execa("git", ["-C", foreign, "log", "--format=%s"])).stdout).toBe("other");
    // The guard of the session knows each workspace folder of this device (check soc-7).
    const launch = JSON.parse(
      await readFile(sessionPaths(awd.home, (await recordOf(awd, task)).id).launch, "utf8"),
    ) as { guard: { workspaces: string[] } };
    expect(launch.guard.workspaces).toEqual(expect.arrayContaining([awd.folder, side]));
  }, 90_000);

  it("never commits the work of the person in another folder when the task moves", async () => {
    awd = await startSessionDaemon();
    // The folder of the person: a git repository on main with a change that is not committed.
    const folder = await tempDir("aw-so-own-");
    const run = (args: string[]) => execa("git", ["-C", folder, ...args], { reject: false });
    await run(["init", "-q", "-b", "main"]);
    await writeFile(join(folder, "notes.md"), "v1\n");
    await run(["add", "notes.md"]);
    await run([
      "-c",
      "user.name=P",
      "-c",
      "user.email=p@example.com",
      "commit",
      "-q",
      "-m",
      "init",
    ]);
    await writeFile(join(folder, "notes.md"), "draft of the person\n");
    const task = await create(awd, "reply in folder", ["--work-in", "folder", "--folder", folder]);
    await awd.waitRow(task, (r) => r.type === "message.agent" && text(r) === "in folder");
    await awd.client.assignTask("-", task, "claude@ubuntu-01");
    await awd.waitRow(task, (r) => r.type === "session.ended");
    // AW makes no commit and no branch in a folder of the person (check soc-8). The save of the
    // unpushed work runs after the stop: wait for a commit, which must not come.
    const commits = async () => (await run(["rev-list", "--all", "--count"])).stdout;
    await expect(waitFor(async () => (await commits()) !== "1", 4000)).rejects.toThrow();
    expect((await run(["log", "--format=%s"])).stdout).toBe("init");
    expect((await run(["branch", "--format=%(refname:short)"])).stdout).toBe("main");
    expect((await run(["status", "--porcelain"])).stdout).toBe(" M notes.md");
    const rows = await awd.rows(task);
    expect(rows.some((r) => r.type === "comment.added" && text(r).includes("unpushed"))).toBe(
      false,
    );
  }, 90_000);

  it("stops a session on the stop request of a person on the phone", async () => {
    awd = await startSessionDaemon();
    const task = await create(awd, "reply ready", []);
    await awd.waitRow(task, (r) => r.type === "message.agent");
    const session = awd.session(task);
    await awd.eventFrom("pixel-9", task, "session.stop_requested", { session });
    const ended = await awd.waitRow(task, (r) => r.type === "session.ended");
    expect(data(ended)).toMatchObject({ session, reason: "stopped" });
    // A person starts the next session: AW starts none by itself.
    await awd.waitChecks(session, 3).catch(() => undefined);
    expect((await awd.rows(task)).filter((r) => r.type === "session.started")).toHaveLength(1);
  }, 90_000);

  it("archives a task with a running session only with --stop, and unarchives it with no new session", async () => {
    awd = await startSessionDaemon();
    const task = await create(awd, "reply ready", []);
    await awd.waitRow(task, (r) => r.type === "message.agent");
    const session = awd.session(task);
    // Without --stop: a clear refusal that names the device and the command (openspec task-actions).
    const refused = await awd.aw(["task", "archive", task]);
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain("A session runs for AW-1 on macbook-pro");
    expect(refused.stderr).toContain("aw task archive AW-1 --stop");
    const archived = await awd.aw(["task", "archive", task, "--stop"]);
    expect(archived.code, archived.stderr).toBe(0);
    const ended = await awd.waitRow(task, (r) => r.type === "session.ended");
    expect(data(ended)).toMatchObject({ session, reason: "stopped" });
    const types = (await awd.rows(task)).map((r) => r.type);
    expect(types.indexOf("session.stop_requested")).toBeLessThan(types.indexOf("task.archived"));
    const unarchived = await awd.aw(["task", "unarchive", task]);
    expect(unarchived.code, unarchived.stderr).toBe(0);
    // A person starts the next session: an unarchive starts none.
    await awd.waitChecks(session, 3).catch(() => undefined);
    expect((await awd.rows(task)).filter((r) => r.type === "session.started")).toHaveLength(1);
  }, 90_000);

  it("stops the session of a task that a person archived with no stop request, as stopped", async () => {
    awd = await startSessionDaemon();
    const task = await create(awd, "reply ready", []);
    await awd.waitRow(task, (r) => r.type === "message.agent");
    const session = awd.session(task);
    // Only task.archived (an older app, or an archive written on another device).
    await awd.eventFrom("pixel-9", task, "task.archived", {});
    const ended = await awd.waitRow(task, (r) => r.type === "session.ended");
    expect(data(ended)).toMatchObject({ session, reason: "stopped" });
    // A stop of a person keeps the claim: no release, and an unarchive starts no session.
    expect((await awd.rows(task)).some((r) => r.type === "task.released")).toBe(false);
    await awd.eventFrom("pixel-9", task, "task.unarchived", {});
    await awd.waitChecks(session, 3).catch(() => undefined);
    expect((await awd.rows(task)).filter((r) => r.type === "session.started")).toHaveLength(1);
  }, 90_000);

  it("moves a task from its worktree to the checkout, and back only with a clear refusal", async () => {
    awd = await startSessionDaemon();
    const task = await create(awd, "reply in worktree", []);
    const first = await awd.waitRow(task, (r) => r.type === "session.started");
    const worktree = join(awd.home, "worktrees", "aw-AW-1");
    expect(data(first).cwd).toBe(worktree);
    await awd.waitRow(task, (r) => r.type === "message.agent");
    // New session in the project checkout: the clean AW worktree of the first session gives the
    // branch free (phone journey finding of session-options).
    const moved = await awd.aw([
      "task",
      "assign",
      task,
      "claude@macbook-pro",
      "--work-in",
      "checkout",
    ]);
    expect(moved.code, moved.stderr).toBe(0);
    const second = await awd.waitRow(
      task,
      (r) => r.type === "session.started" && data(r).work_in === "checkout",
    );
    expect(data(second).cwd).toBe(awd.checkout);
    const note = await awd.waitRow(
      task,
      (r) => r.type === "comment.added" && text(r).startsWith("AW removed the worktree"),
    );
    expect(text(note)).toContain(worktree);
    expect(
      (await execa("git", ["-C", awd.checkout, "symbolic-ref", "--short", "HEAD"])).stdout,
    ).toBe("aw/AW-1");
    // Back to a separate worktree: the branch is in the checkout of the person, so AW refuses.
    await awd.waitRow(
      task,
      (r) => r.type === "message.agent" && data(r).session === data(second).session,
    );
    await awd.aw(["task", "assign", task, "claude@macbook-pro", "--work-in", "worktree"]);
    const refused = await awd.waitRow(
      task,
      (r) =>
        r.type === "comment.added" && text(r).includes("is checked out in the project checkout"),
    );
    expect(text(refused)).toContain("Project checkout");
    expect((await awd.rows(task)).filter((r) => r.type === "session.started")).toHaveLength(2);
  }, 120_000);
});
