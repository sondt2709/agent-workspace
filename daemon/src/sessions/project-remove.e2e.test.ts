// The remove of a project with running sessions (openspec project-remove): real tmux on a private
// socket, the fake agent and real git. The sessions stop with `stopped`, the clean worktree and its
// branch go, the worktree with an unpushed commit stays with a system comment, the checkout of this
// device goes, and the same slug works again with a new folder.
import { SetupClient } from "@aw/client/setup";
import type { EventRow } from "@aw/core";
import { execa } from "execa";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { tempDir, waitFor } from "../testing.ts";
import { startSessionDaemon, TEST_TMUX, type SessionTestDaemon } from "./testing.ts";

let awd: SessionTestDaemon | null = null;

afterEach(async () => {
  await awd?.close();
  awd = null;
});

const data = (row: { event: unknown }) => (row.event as { data: Record<string, unknown> }).data;
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );
const gitIn = (cwd: string, ...args: string[]) =>
  execa("git", ["-C", cwd, "-c", "user.name=AW", "-c", "user.email=test@example.com", ...args]);

describe.skipIf(!TEST_TMUX)("remove a project with running sessions", () => {
  it("stops the sessions, cleans the clean worktree, keeps unpushed work, and frees the slug", async () => {
    awd = await startSessionDaemon();
    const d = awd;
    const clean = await d.createTask("ask Which limit per client? | 100/min|1000/min");
    const busy = await d.createTask("ask Which header? | X-Limit|RateLimit");
    for (const task of [clean, busy]) {
      await d.waitRow(task.id, (r) => r.type === "gate.opened" && data(r).kind === "question");
    }
    const sessions = [d.session(clean.id), d.session(busy.id)];
    const cleanPath = d.worktree(clean.id);
    const busyPath = d.worktree(busy.id);
    // The agent of the second task made a commit that no other branch has.
    await writeFile(join(busyPath, "limits.md"), "100/min\n");
    await gitIn(busyPath, "add", ".");
    await gitIn(busyPath, "commit", "-q", "-m", "wip");
    const state = (id: string) => d.server.daemon.sessions!.list().find((r) => r.id === id)?.state;
    expect(sessions.map(state)).toEqual(["running", "running"]);

    const preview = await d.aw(["project", "remove", "billing-api"]);
    expect(preview.code).toBe(1);
    expect(preview.stdout).toContain("Running sessions (2), each device stops its own:");
    const result = await d.aw(["--json", "project", "remove", "billing-api", "--yes"]);
    expect(result.code, result.stderr).toBe(0);
    const reply = JSON.parse(result.stdout) as {
      sessions: { session: string }[];
      cleanup: { key: string; result: string; reason: string | null; branch: string }[];
    };
    expect(reply.sessions.map((s) => s.session).sort()).toEqual([...sessions].sort());
    const byKey = new Map(reply.cleanup.map((c) => [c.key, c]));
    expect(byKey.get(clean.key!)).toMatchObject({ result: "removed", reason: null });
    expect(byKey.get(busy.key!)).toMatchObject({ result: "kept", reason: "unpushed commits" });

    // The sessions stopped with `stopped`, and their windows are gone.
    expect(sessions.map(state)).toEqual(["stopped", "stopped"]);
    for (const task of [clean, busy]) {
      expect((await d.host.list()).some((p) => p.name === `aw-${task.id}`)).toBe(false);
    }
    const events = (task: string) =>
      d.server.daemon.workspace("acme").index.find<EventRow>("events", { task });
    for (const task of [clean, busy]) {
      const ended = events(task.id).find((r) => r.type === "session.ended");
      expect(ended && data(ended)).toMatchObject({ reason: "stopped" });
    }
    const comment = events(busy.id).find((r) => r.type === "comment.added");
    expect(comment && data(comment).text).toContain("kept (unpushed commits)");
    // The clean worktree and its branch are gone; the unpushed work stays.
    expect(await exists(cleanPath)).toBe(false);
    expect(await exists(busyPath)).toBe(true);
    const branches = (await gitIn(d.checkout, "branch", "--format=%(refname:short)")).stdout;
    expect(branches).not.toContain(`aw/${clean.key}`);
    expect(branches).toContain(`aw/${busy.key}`);
    // The views and the checkout of this device.
    expect(await d.client.tasks("acme")).toEqual([]);
    const bindingsPath = join(d.folder, "tasks", "devices", "macbook-pro", "bindings.yaml");
    const bindings = () =>
      readFile(bindingsPath, "utf8").then((t) => parse(t) as { checkouts: { path: string }[] });
    expect((await bindings()).checkouts).toEqual([]);
    // No session starts again for a removed task: the checks run every 500 ms, so wait 3 s.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(d.server.daemon.sessions!.list().filter((r) => r.state === "running")).toEqual([]);

    // The same slug with a new folder: a new task gets the next key and works in the new folder.
    const fresh = await tempDir("aw-pr-new-");
    await mkdir(fresh, { recursive: true });
    await gitIn(fresh, "init", "-q", "-b", "main");
    await gitIn(fresh, "commit", "-q", "--allow-empty", "-m", "init");
    expect((await d.aw(["project", "add", "billing-api"])).code).toBe(0);
    await new SetupClient(d.client).editBindings("acme", {
      checkouts: [{ project: "billing-api", path: fresh }],
    });
    const next = await d.createTask("ask Which limit per client? | 100/min|1000/min");
    expect(next.key).toBe("AW-3");
    await d.waitRow(next.id, (r) => r.type === "gate.opened" && data(r).kind === "question");
    const common = await execa("git", [
      "-C",
      d.worktree(next.id),
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);
    expect(common.stdout).toBe(
      join(await import("node:fs/promises").then((f) => f.realpath(fresh)), ".git"),
    );
    await waitFor(async () => (await bindings()).checkouts.length === 1, 5000);
  }, 120_000);
});
