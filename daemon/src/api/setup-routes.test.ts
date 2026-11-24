// Route and CLI tests of the setup routes (openspec gap-setup, workspace-setup): the default
// workspace, rename and remove, project edit and archive, the bindings of this device and the
// community switch.
import { AwApiError } from "@aw/client";
import { SetupClient } from "@aw/client/setup";
import { mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { startTestDaemon, type TestDaemon } from "../testing.ts";

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

async function yamlOf(path: string): Promise<Record<string, unknown>> {
  return parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("default workspace", () => {
  it("registers no workspace at the start, and init with no path makes ~/AW/Personal", async () => {
    d = await startTestDaemon();
    expect(await d.client.workspaces()).toEqual([]);
    const result = await d.aw(["workspace", "init"]);
    expect(result.code, result.stderr).toBe(0);
    const root = join(d.userHome, "AW", "Personal");
    expect(result.stdout).toContain(`Created workspace Personal`);
    const [ws] = await d.client.workspaces();
    expect(ws).toMatchObject({ name: "Personal", path: root });
    expect(await yamlOf(join(root, "tasks", "workspace.yaml"))).toMatchObject({
      name: "Personal",
    });
  });

  it("uses the name for the folder when a name and no path are given", async () => {
    d = await startTestDaemon();
    const reply = await d.client.initWorkspace({ name: "Side work" });
    expect(reply.created).toBe(true);
    expect(reply.workspace.path).toBe(join(d.userHome, "AW", "Side work"));
  });

  it("uses -aw1 for a new name in a default folder that has another workspace (gap-setup L2)", async () => {
    d = await startTestDaemon();
    const old = await d.client.initWorkspace({ name: "Acme" });
    await new SetupClient(d.client).removeWorkspace(old.workspace.id);
    // macOS folders ignore the letter case: "acme" is the folder of the old "Acme".
    const folder = join(d.userHome, "AW", "Acme");
    const reply = await d.client.initWorkspace({ name: "Acme", key_prefix: "ACM" });
    expect(reply.created).toBe(true);
    expect(reply.workspace.path).toBe(`${folder}-aw1`);
    expect(reply.folder_note).toBe(
      `${folder} is in use (another workspace), so AW uses ${folder}-aw1.`,
    );
    // The old workspace stays as it is.
    expect(await yamlOf(join(folder, "tasks", "workspace.yaml"))).toMatchObject({
      id: old.workspace.id,
      key_prefix: "AW",
    });
    await new SetupClient(d.client).removeWorkspace(reply.workspace.id);
    // The same name and no other prefix: the old workspace comes back, as before.
    expect((await d.client.initWorkspace({ name: "Acme" })).workspace.id).toBe(old.workspace.id);
  });

  it("keeps the files of the person out of the workspace (openspec workspace-folder)", async () => {
    d = await startTestDaemon();
    const taken = join(d.userHome, "AW", "Personal");
    await mkdir(taken, { recursive: true });
    await writeFile(join(taken, "notes.txt"), "a note of the person\n");
    const result = await d.aw(["workspace", "init"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`at ${taken}-aw1`);
    expect(result.stdout).toContain(`${taken} is in use (other files)`);
    expect(await readdir(taken)).toEqual(["notes.txt"]);
    const status = await d.aw(["status"]);
    expect(status.stdout).toContain(`  Folder: ${taken}-aw1`);
  });

  it("creates the workspace in a location with --in, and keeps the old path form", async () => {
    d = await startTestDaemon();
    const work = join(d.folder, "work");
    await mkdir(join(work, "demo"), { recursive: true });
    await writeFile(join(work, "readme.txt"), "x\n");
    await writeFile(join(work, "demo", "report.pdf"), "x\n");
    const result = await d.aw(["workspace", "init", "--in", "work", "--name", "demo"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`at ${join(work, "demo-aw1")}`);
    const both = await d.aw(["workspace", "init", "x", "--in", "work", "--name", "demo"]);
    expect(both.code).toBe(2);
    const pairBoth = await d.aw(["pair", "aw1:EXAMPLECODE", "--path", "/a", "--in", "/b"]);
    expect(pairBoth.code).toBe(2);
    expect(pairBoth.stderr).toContain("Give --path or --in, not both");
    const old = await d.aw(["workspace", "init", join(d.folder, "exact"), "--name", "exact"]);
    expect(old.code, old.stderr).toBe(0);
    expect(old.stdout).toContain(`at ${join(d.folder, "exact")}`);
    const api = await apiError(d.client.initWorkspace({ path: work, parent: work, name: "x" }));
    expect(api.status).toBe(400);
  });

  it("registers a location that is a workspace folder, as Add a workspace did (wf-2)", async () => {
    d = await startTestDaemon();
    // A folder that another device synced: a workspace folder that this device does not register.
    const synced = join(d.folder, "acme");
    const old = await d.client.initWorkspace({ path: synced, name: "Acme", key_prefix: "ACM" });
    await new SetupClient(d.client).removeWorkspace(old.workspace.id);
    // The desktop dialog sends the picked folder as the location, with the name field.
    const reply = await d.client.initWorkspace({ parent: synced, name: "demo" });
    expect(reply.created).toBe(false);
    expect(reply.workspace).toMatchObject({ id: old.workspace.id, path: synced });
    expect(reply.folder_note).toBe(
      `${synced} is the folder of the workspace Acme, so AW registers it.`,
    );
    expect(await readdir(synced)).not.toContain("demo");
    // No new workspace in a sub folder of a workspace folder that is not registered.
    await new SetupClient(d.client).removeWorkspace(old.workspace.id);
    const nested = await apiError(
      d.client.initWorkspace({ parent: join(synced, "knowledge"), name: "demo" }),
    );
    expect(nested.status).toBe(409);
    expect(nested.message).toContain("is in the workspace folder");
    expect(await d.client.workspaces()).toEqual([]);
  });

  it("refuses a location in another workspace folder and in AW_HOME", async () => {
    d = await startTestDaemon({ workspace: true });
    const inside = await apiError(
      d.client.initWorkspace({ parent: join(d.folder, "sub"), name: "demo" }),
    );
    expect(inside.status).toBe(409);
    expect(inside.message).toContain(`the workspace folder ${d.folder}`);
    const state = await apiError(d.client.initWorkspace({ parent: d.home, name: "demo" }));
    expect(state.status).toBe(409);
    expect(state.message).toContain("state folder");
    expect((await d.client.workspaces()).length).toBe(1);
  });
});

describe("rename and remove a workspace", () => {
  it("renames the workspace in tasks/workspace.yaml", async () => {
    d = await startTestDaemon({ workspace: true });
    const result = await d.aw(["workspace", "rename", "Acme Labs"]);
    expect(result.code, result.stderr).toBe(0);
    expect(await yamlOf(join(d.folder, "tasks", "workspace.yaml"))).toMatchObject({
      name: "Acme Labs",
    });
    expect((await d.client.workspaces())[0]!.name).toBe("Acme Labs");
  });

  it("unregisters the workspace and keeps its files; init registers it again", async () => {
    d = await startTestDaemon({ workspace: true });
    const [before] = await d.client.workspaces();
    const reply = await new SetupClient(d.client).removeWorkspace("acme");
    expect(reply).toMatchObject({ id: before!.id, path: d.folder, files_kept: true });
    expect(reply.message).toContain(d.folder);
    expect(await d.client.workspaces()).toEqual([]);
    const config = await yamlOf(join(d.home, "config.yaml"));
    expect(config.workspaces).toEqual([]);
    await stat(join(d.folder, "tasks", "workspace.yaml"));
    // After a restart it stays unregistered.
    await d.restart();
    expect(await d.client.workspaces()).toEqual([]);
    const again = await d.client.initWorkspace({ path: d.folder });
    expect(again).toMatchObject({ created: false, workspace: { id: before!.id } });
  });

  it("names the open tasks that stay assigned to this device (gap-setup workflow 1)", async () => {
    d = await startTestDaemon({ workspace: true });
    const mine = await d.client.createTask("-", {
      project: "billing-api",
      title: "Mine",
      first_message: "x",
      assignee: "claude@macbook-pro",
    });
    await d.client.createTask("-", {
      project: "billing-api",
      title: "Other",
      first_message: "x",
      assignee: "claude@ubuntu-01",
    });
    const reply = await new SetupClient(d.client).removeWorkspace("acme");
    expect(reply.tasks).toEqual([mine.task.key]);
    expect(reply.message).toContain(
      `These tasks stay assigned to macbook-pro, which runs no session for them now: ${mine.task.key}. Assign them to another device.`,
    );
  });

  it("gives 404 for an unknown workspace", async () => {
    d = await startTestDaemon({ workspace: true });
    const error = await apiError(new SetupClient(d.client).removeWorkspace("nope"));
    expect(error.status).toBe(404);
  });
});

describe("edit and archive a project", () => {
  it("changes the device order, the links and the main repository", async () => {
    d = await startTestDaemon({ workspace: true });
    const result = await d.aw([
      "project",
      "edit",
      "billing-api",
      "--device",
      "ubuntu-01",
      "--device",
      "macbook-pro",
      "--link",
      "https://example.com/docs",
      "--main-repo",
      "https://github.com/example/billing-api",
      "--subtasks-to-default-device",
      "on",
    ]);
    expect(result.code, result.stderr).toBe(0);
    const file = await yamlOf(join(d.folder, "tasks", "projects", "billing-api", "project.yaml"));
    expect(file).toMatchObject({
      name: "Billing API",
      devices: ["ubuntu-01", "macbook-pro"],
      links: ["https://github.com/example/billing-api", "https://example.com/docs"],
      main_repo: "https://github.com/example/billing-api",
      switches: { assign_new_subtasks_to_default_device: true },
    });
    const [project] = await d.client.projects("-");
    expect(project).toMatchObject({ devices: ["ubuntu-01", "macbook-pro"], archived: false });
  });

  it("refuses a new task in an archived project, and unarchive allows it again", async () => {
    d = await startTestDaemon({ workspace: true });
    expect((await d.aw(["project", "archive", "billing-api"])).code).toBe(0);
    expect((await d.client.projects("-"))[0]!.archived).toBe(true);
    const error = await apiError(
      d.client.createTask("-", { project: "billing-api", title: "T", first_message: "Do it" }),
    );
    expect(error.status).toBe(400);
    expect(error.message).toContain("archived");
    expect((await d.aw(["project", "unarchive", "billing-api"])).code).toBe(0);
    const created = await d.client.createTask("-", {
      project: "billing-api",
      title: "T",
      first_message: "Do it",
    });
    expect(created.applied).toBe(true);
  });

  it("gives 400 for no field or a duplicate device and 404 for an unknown project", async () => {
    d = await startTestDaemon({ workspace: true });
    const setup = new SetupClient(d.client);
    expect((await apiError(setup.editProject("-", "billing-api", {}))).status).toBe(400);
    expect(
      (await apiError(setup.editProject("-", "billing-api", { devices: ["a-1", "a-1"] }))).status,
    ).toBe(400);
    expect((await apiError(setup.editProject("-", "nope", { name: "X" }))).status).toBe(404);
    expect((await d.aw(["project", "edit", "billing-api"])).code).toBe(2);
  });
});

describe("bindings of this device", () => {
  it("binds a checkout with its host, sets test slots and Use Orca, and removes the checkout", async () => {
    d = await startTestDaemon({ workspace: true });
    const checkout = join(d.home, "checkouts", "billing-api");
    await mkdir(checkout, { recursive: true });
    const set = await d.aw(["binding", "set", "billing-api", checkout, "--host", "tmux"]);
    expect(set.code, set.stderr).toBe(0);
    expect(set.stdout).toContain(`billing-api: ${checkout} (tmux)`);
    expect((await d.aw(["binding", "slot", "k3d", "2"])).code).toBe(0);
    expect((await d.aw(["binding", "orca", "on"])).code).toBe(0);
    const path = join(d.folder, "tasks", "devices", "macbook-pro", "bindings.yaml");
    expect(await yamlOf(path)).toMatchObject({
      may_run: true,
      use_orca: true,
      checkouts: [{ project: "billing-api", path: checkout, session_host: "tmux" }],
      resources: { k3d: 2 },
    });
    expect((await d.aw(["binding", "slot", "k3d", "0"])).code).toBe(0);
    expect((await d.aw(["binding", "remove", "billing-api"])).code).toBe(0);
    const bindings = await new SetupClient(d.client).bindings("-");
    expect(bindings).toMatchObject({ checkouts: [], resources: {}, use_orca: true });
  });

  it("keeps the session host for a new checkout path; --host default clears it (gap-setup L4)", async () => {
    d = await startTestDaemon({ workspace: true });
    const first = join(d.home, "checkouts", "billing-api");
    const second = join(d.home, "checkouts", "billing-api-2");
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    expect((await d.aw(["binding", "set", "billing-api", first, "--host", "orca"])).code).toBe(0);
    const moved = await d.aw(["binding", "set", "billing-api", second]);
    expect(moved.stdout).toContain(`billing-api: ${second} (orca)`);
    const cleared = await d.aw(["binding", "set", "billing-api", second, "--host", "default"]);
    expect(cleared.code, cleared.stderr).toBe(0);
    expect(cleared.stdout).toContain(`billing-api: ${second}\n`);
    // No session_host; each change stamps bound_at (openspec project-remove).
    const [only, ...rest] = (await new SetupClient(d.client).bindings("-")).checkouts;
    expect(rest).toEqual([]);
    expect(only).toEqual({ project: "billing-api", path: second, bound_at: only!.bound_at });
    expect(only!.bound_at).toMatch(/#\d{4}$/);
  });

  it("refuses a relative path, a missing folder and an unknown project, and writes nothing", async () => {
    d = await startTestDaemon({ workspace: true });
    const setup = new SetupClient(d.client);
    const before = await setup.bindings("-");
    for (const checkouts of [
      [{ project: "billing-api", path: "work/billing-api" }],
      [{ project: "billing-api", path: join(d.home, "missing") }],
      [{ project: "nope", path: d.home }],
    ]) {
      expect((await apiError(setup.editBindings("-", { checkouts }))).status).toBe(400);
    }
    expect((await apiError(setup.editBindings("-", {}))).status).toBe(400);
    expect(await setup.bindings("-")).toEqual(before);
  });

  it("refuses a checkout in the workspace folder, also by a link, in the route and the CLI (cf-2)", async () => {
    d = await startTestDaemon({ workspace: true });
    const setup = new SetupClient(d.client);
    const before = await setup.bindings("-");
    const inside = join(d.folder, "code", "billing-api");
    await mkdir(inside, { recursive: true });
    const link = join(d.home, "billing-link");
    await symlink(inside, link);
    for (const path of [d.folder, inside, link]) {
      const error = await apiError(
        setup.editBindings("-", { checkouts: [{ project: "billing-api", path }] }),
      );
      expect(error.status).toBe(400);
      expect(error.message).toContain("inside the workspace folder");
    }
    const cli = await d.aw(["binding", "set", "billing-api", inside]);
    expect(cli.code).not.toBe(0);
    expect(cli.stderr).toContain("inside the workspace folder");
    expect(await setup.bindings("-")).toEqual(before);
    // A folder next to the workspace folder with the same name start is not inside it.
    const next = `${d.folder}-code`;
    await mkdir(next, { recursive: true });
    const [saved, ...others] = (
      await setup.editBindings("-", { checkouts: [{ project: "billing-api", path: next }] })
    ).checkouts;
    expect(others).toEqual([]);
    expect(saved).toEqual({ project: "billing-api", path: next, bound_at: saved!.bound_at });
    expect(saved!.bound_at).toMatch(/#\d{4}$/);
  });
});

describe("community switch", () => {
  it("is on by default, saves off in config.yaml, and keeps it after a restart", async () => {
    d = await startTestDaemon();
    const shown = await d.aw(["sync", "community"]);
    expect(shown.code, shown.stderr).toBe(0);
    expect(shown.stdout).toContain("on: community discovery and relay servers (default)");
    expect(shown.stdout).toContain("They see your IP address");
    const off = await d.aw(["sync", "community", "off"]);
    expect(off.code, off.stderr).toBe(0);
    expect(off.stdout).toContain("off: LAN and Tailscale only");
    // No engine binary in the tests: the next engine start applies it.
    expect(off.stdout).toContain("next start");
    expect((await yamlOf(join(d.home, "config.yaml"))).sync).toEqual({ community: false });
    expect(d.server.daemon.sync.community).toBe(false);
    await d.restart();
    expect(await new SetupClient(d.client).syncSettings()).toMatchObject({
      community: false,
      source: "config",
    });
    expect(d.server.daemon.sync.community).toBe(false);
  });

  it("lets an agent session read the switch but not set it (gap-setup L8)", async () => {
    d = await startTestDaemon();
    const env = {
      AW_HOME: d.home,
      HOME: d.home,
      AW_SESSION: "0198a5c3-0000-7000-8000-000000000001",
    };
    const read = await d.aw(["sync", "community"], { env });
    expect(read.code, read.stderr).toBe(0);
    const set = await d.aw(["sync", "community", "off"], { env });
    expect(set.code).toBe(1);
    expect(set.stderr).toContain("aw sync community on|off is a command of a person");
    expect(d.server.daemon.sync.community).toBe(true);
  });

  it("refuses a change when AW_SYNC_COMMUNITY sets it", async () => {
    d = await startTestDaemon({ env: { AW_SYNC_COMMUNITY: "off" } });
    const setup = new SetupClient(d.client);
    expect(await setup.syncSettings()).toMatchObject({ community: false, source: "env" });
    const error = await apiError(setup.setSyncSettings(true));
    expect(error.status).toBe(409);
    expect(error.message).toContain("AW_SYNC_COMMUNITY");
    expect((await d.aw(["sync", "community", "maybe"])).code).toBe(2);
  });
});

describe("permission mode of new projects (openspec permissions-default)", () => {
  it("gives new projects the workspace default; an explicit mode wins; old projects keep theirs", async () => {
    d = await startTestDaemon({ workspace: true });
    const edit = await d.aw(["workspace", "edit", "--new-project-permission-mode", "skip"]);
    expect(edit.code, edit.stderr).toBe(0);
    expect(edit.stdout).toContain("New projects get the permission mode skip");
    expect(await yamlOf(join(d.folder, "tasks", "workspace.yaml"))).toMatchObject({
      new_project_permission_mode: "skip",
    });
    expect((await d.client.workspaces())[0]).toMatchObject({ new_project_permission_mode: "skip" });
    const added = await d.aw(["project", "add", "web-app"]);
    expect(added.code, added.stderr).toBe(0);
    const projects = join(d.folder, "tasks", "projects");
    expect(await yamlOf(join(projects, "web-app", "project.yaml"))).toMatchObject({
      permission_mode: "skip",
    });
    const own = await d.aw(["project", "add", "docs-site", "--permission-mode", "default"]);
    expect(own.code, own.stderr).toBe(0);
    expect(await yamlOf(join(projects, "docs-site", "project.yaml"))).toMatchObject({
      permission_mode: "default",
    });
    expect(await yamlOf(join(projects, "billing-api", "project.yaml"))).toMatchObject({
      permission_mode: "default",
    });
  });

  it("gives new projects skip with the default setting (polish-skip-default)", async () => {
    d = await startTestDaemon({ workspace: true });
    const reply = await d.client.addProject("-", { slug: "web-app" });
    expect(reply.permission_mode).toBe("skip");
    expect((await d.client.workspaces())[0]).toMatchObject({
      new_project_permission_mode: "skip",
    });
  });

  it("refuses an edit with no field, and keeps the name with a mode edit", async () => {
    d = await startTestDaemon({ workspace: true });
    const setup = new SetupClient(d.client);
    const error = await apiError(setup.editWorkspace("-", {}));
    expect(error.status).toBe(400);
    const empty = await d.aw(["workspace", "edit"]);
    expect(empty.code).not.toBe(0);
    expect(empty.stderr).toContain("Give at least one option");
    const bad = await d.aw(["workspace", "edit", "--new-project-permission-mode", "bypass"]);
    expect(bad.code).not.toBe(0);
    const before = (await d.client.workspaces())[0]!.name;
    const reply = await setup.editWorkspace("-", { new_project_permission_mode: "accept_edits" });
    expect(reply).toMatchObject({ name: before, new_project_permission_mode: "accept_edits" });
  });

  it("refuses aw workspace edit in an agent session", async () => {
    d = await startTestDaemon({ workspace: true });
    const result = await d.aw(
      ["workspace", "edit", "--new-project-permission-mode", "accept_edits"],
      {
        env: { AW_HOME: d.home, HOME: d.home, AW_SESSION: "0193a7c2-5b1e-7c3a-9f20-6d1e2a4b8c09" },
      },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("is a command of a person");
    // Unchanged: an agent session tried to change it.
    expect(await yamlOf(join(d.folder, "tasks", "workspace.yaml"))).toMatchObject({
      new_project_permission_mode: "skip",
    });
  });
});

describe("agent sessions", () => {
  it("refuse the setup commands in the CLI", async () => {
    d = await startTestDaemon({ workspace: true });
    const result = await d.aw(["project", "archive", "billing-api"], {
      env: { AW_HOME: d.home, HOME: d.home, AW_SESSION: "0193a7c2-5b1e-7c3a-9f20-6d1e2a4b8c09" },
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("is a command of a person");
  });
});
