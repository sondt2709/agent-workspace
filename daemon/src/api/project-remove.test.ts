// Route and CLI tests of the remove of a project (openspec project-remove): the preview, the
// removal event, the files that stay, the free slug, the checkout of this device and the refusal
// for a session caller.
import { AwApiError } from "@aw/client";
import { SetupClient } from "@aw/client/setup";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createLogger } from "../log.ts";
import { Daemon } from "../service/daemon.ts";
import { removeProject } from "../service/project-remove.ts";
import { loadSettings } from "../settings.ts";
import { startTestDaemon, type TestDaemon } from "../testing.ts";
import { createApp } from "./app.ts";
import { routeAccess, type Access } from "./caller.ts";

let d: TestDaemon;

afterEach(async () => {
  await d?.close();
});

async function apiError(promise: Promise<unknown>): Promise<AwApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AwApiError);
  return error as AwApiError;
}

const folder = () => mkdtemp(join(tmpdir(), "aw-pr-checkout-"));

async function bindings(d: TestDaemon) {
  return parse(
    await readFile(join(d.folder, "tasks", "devices", "macbook-pro", "bindings.yaml"), "utf8"),
  ) as { checkouts: { project: string; path: string; bound_at?: string }[] };
}

describe("remove a project", () => {
  it("shows the open tasks with no --yes, then removes the project and keeps its files", async () => {
    d = await startTestDaemon({ workspace: true });
    const setup = new SetupClient(d.client);
    const one = await d.client.createTask("acme", {
      project: "billing-api",
      title: "Add rate limits",
      first_message: "Add rate limits",
    });
    const preview = await d.aw(["project", "remove", "billing-api"]);
    expect(preview.code).toBe(1);
    expect(preview.stdout).toContain("Open tasks (1): AW-1 Add rate limits");
    expect(preview.stdout).toContain("Running sessions: none");
    expect(preview.stdout).toContain("Add --yes to remove it.");
    expect((await d.client.projects("acme")).map((p) => p.slug)).toEqual(["billing-api"]);

    const removed = await d.aw(["project", "remove", "billing-api", "--yes"]);
    expect(removed.code, removed.stderr).toBe(0);
    expect(removed.stdout).toContain("Removed project billing-api. You can add billing-api again.");
    expect(await d.client.projects("acme")).toEqual([]);
    expect(await d.client.tasks("acme")).toEqual([]);
    // The files stay: the task folder, project.yaml, and the event with the copy of project.yaml.
    await stat(join(d.folder, "tasks", one.task.id, "log", "macbook-pro.jsonl"));
    await stat(join(d.folder, "tasks", "projects", "billing-api", "project.yaml"));
    const log = await readFile(join(d.folder, "tasks", "log", "macbook-pro.jsonl"), "utf8");
    const event = log
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { type: string; by: string; data: Record<string, unknown> })
      .find((e) => e.type === "project.removed")!;
    expect(event.by).toBe("human@macbook-pro");
    expect(event.data).toMatchObject({ project: "billing-api", document: { slug: "billing-api" } });
    // A second remove: the project is gone.
    expect((await apiError(setup.removeProject("acme", "billing-api"))).status).toBe(404);
  });

  it("frees the slug: the same slug with a new folder, no old task, and the next key", async () => {
    d = await startTestDaemon({ workspace: true });
    const setup = new SetupClient(d.client);
    const [oldFolder, newFolder] = [await folder(), await folder()];
    await setup.editBindings("acme", { checkouts: [{ project: "billing-api", path: oldFolder }] });
    expect((await bindings(d)).checkouts[0]!.bound_at).toMatch(/#\d{4}$/);
    for (const title of ["One", "Two"]) {
      await d.client.createTask("acme", { project: "billing-api", title, first_message: title });
    }
    // Base behavior (evidence/project-remove/base-cli.txt): the add gave "exists" (409).
    expect((await apiError(d.client.addProject("acme", { slug: "billing-api" }))).status).toBe(409);

    const reply = await setup.removeProject("acme", "billing-api");
    expect(reply.tasks.map((t) => t.key)).toEqual(["AW-1", "AW-2"]);
    // The checkout of this device is gone after the remove.
    expect((await bindings(d)).checkouts).toEqual([]);

    const added = await d.aw(["project", "add", "billing-api"]);
    expect(added.code, added.stderr).toBe(0);
    await setup.editBindings("acme", { checkouts: [{ project: "billing-api", path: newFolder }] });
    const [project] = await d.client.projects("acme");
    expect(project).toMatchObject({ slug: "billing-api", tasks: [] });
    const third = await d.client.createTask("acme", {
      project: "billing-api",
      title: "Three",
      first_message: "Three",
    });
    // AW-1 and AW-2 are removed tasks: their keys and branches stay theirs.
    expect(third.task.key).toBe("AW-3");
    expect((await d.client.tasks("acme")).map((t) => t.key)).toEqual(["AW-3"]);
    // The new checkout stays after the next merge: it sorts after the removal.
    await d.server.daemon.workspace("acme").refresh();
    expect((await bindings(d)).checkouts.map((c) => c.path)).toEqual([newFolder]);
  });

  it("keeps a removed task readable with aw task show and aw thread, and refuses a write", async () => {
    d = await startTestDaemon({ workspace: true });
    const setup = new SetupClient(d.client);
    const one = await d.client.createTask("acme", {
      project: "billing-api",
      title: "Add rate limits",
      first_message: "Add rate limits",
    });
    await setup.removeProject("acme", "billing-api");
    const show = await d.aw(["task", "show", "AW-1", "--json"]);
    expect(show.code, show.stderr).toBe(0);
    expect(JSON.parse(show.stdout)).toMatchObject({ id: one.task.id, key: "AW-1" });
    const thread = await d.client.thread("acme", one.task.id);
    expect(thread.events.map((r) => r.type)).toContain("task.created");
    const byPrefix = await d.aw(["thread", one.task.id.slice(0, 13)]);
    expect(byPrefix.code, byPrefix.stderr).toBe(0);
    // A removed task gets no new event.
    expect((await apiError(d.client.sendMessage("acme", one.task.id, "hi"))).status).toBe(404);
  });

  it("replies with the removal when the cleanup of this device fails after the event", async () => {
    d = await startTestDaemon({ workspace: true });
    const service = d.server.daemon.workspace("acme");
    const reply = await removeProject(service, "billing-api", () =>
      Promise.reject(new Error("the session check failed")),
    );
    expect(reply.removed.event).toMatch(/^[0-9a-f-]{36}$/);
    expect(reply.cleanup).toEqual([]);
    expect(await d.client.projects("acme")).toEqual([]);
  });

  it("refuses the remove inside an agent session, and an unknown project", async () => {
    d = await startTestDaemon({ workspace: true });
    const inSession = await d.aw(["project", "remove", "billing-api", "--yes"], {
      env: { AW_SESSION: "01a2038e-7f00-7000-8000-000000000001" },
    });
    expect(inSession.code).toBe(1);
    expect(inSession.stderr).toContain("project remove");
    expect((await d.client.projects("acme")).map((p) => p.slug)).toEqual(["billing-api"]);
    const unknown = await d.aw(["project", "remove", "web-app", "--yes"]);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("Project web-app not found");
  });

  it("makes both routes person routes: a session caller gets 403", async () => {
    const daemon = new Daemon({
      settings: loadSettings({ AW_HOME: "/nonexistent/aw", HOME: "/nonexistent" }),
      log: createLogger("silent"),
      watch: false,
      heartbeat: false,
    });
    const access = new Map<string, Access>();
    const app = await createApp(daemon, {
      onRoute: (route) => {
        for (const method of [route.method].flat()) {
          access.set(`${method} ${route.url}`, routeAccess(method, route.access));
        }
      },
    });
    await app.ready();
    await app.close();
    expect(access.get("GET /v1/workspaces/:ws/projects/:project/removal")).toBe("person");
    expect(access.get("POST /v1/workspaces/:ws/projects/:project/remove")).toBe("person");
  });
});
