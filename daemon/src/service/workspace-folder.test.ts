// The folder rule of a new or joined workspace (openspec workspace-folder). Real temp folders.
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkJoinFolder,
  chooseWorkspaceFolder,
  folderName,
  type FolderContext,
  type FolderMatch,
} from "./workspace-folder.ts";

const WS = "01960000-0000-7000-8000-000000000001";
const OTHER = "01960000-0000-7000-8000-000000000002";

let base: string;
let work: string;
let context: FolderContext;

async function workspaceIn(root: string, id: string, name = "demo", prefix = "DM"): Promise<void> {
  await mkdir(join(root, "tasks"), { recursive: true });
  await writeFile(
    join(root, "tasks", "workspace.yaml"),
    `kind: workspace\nschema: 1\nid: ${id}\nname: ${name}\nkey_prefix: ${prefix}\n`,
  );
}

async function fileIn(path: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "a file of the person\n");
}

const join_ = (parent: string) =>
  chooseWorkspaceFolder({ parent, name: "demo", match: { id: WS } }, context);

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "aw-wf-unit-"));
  work = join(base, "work");
  await mkdir(join(base, "state"), { recursive: true });
  context = { home: join(base, "state"), registered: [], checkouts: [], reserved: [] };
});

afterEach(async () => {
  await chmod(work, 0o755).catch(() => undefined);
  await rm(base, { recursive: true, force: true });
});

describe("chooseWorkspaceFolder", () => {
  it("uses <location>/<name> in a missing location", async () => {
    expect(await join_(work)).toEqual({ root: join(work, "demo"), note: null });
  });

  it("uses <location>/<name> in a location with other files", async () => {
    await fileIn(join(work, "notes.txt"));
    expect(await join_(work)).toEqual({ root: join(work, "demo"), note: null });
  });

  it("uses an empty folder with the name", async () => {
    await mkdir(join(work, "demo", "tasks"), { recursive: true });
    expect((await join_(work)).root).toBe(join(work, "demo"));
  });

  it("uses -aw1 when the name has other files, and says why", async () => {
    await fileIn(join(work, "demo", "report.pdf"));
    expect(await join_(work)).toEqual({
      root: join(work, "demo-aw1"),
      note: `${join(work, "demo")} is in use (other files), so AW uses ${join(work, "demo-aw1")}.`,
    });
  });

  it("uses -aw2 when the name has another workspace and -aw1 has other files", async () => {
    await workspaceIn(join(work, "demo"), OTHER);
    await fileIn(join(work, "demo-aw1", "a.txt"));
    const choice = await join_(work);
    expect(choice.root).toBe(join(work, "demo-aw2"));
    expect(choice.note).toBe(
      `${join(work, "demo")} is in use (another workspace), ${join(work, "demo-aw1")} is in use (other files), so AW uses ${join(work, "demo-aw2")}.`,
    );
  });

  it("uses the folder of the same workspace again, also behind a suffix", async () => {
    await fileIn(join(work, "demo", "a.txt"));
    await workspaceIn(join(work, "demo-aw1"), WS);
    expect(await join_(work)).toMatchObject({ root: join(work, "demo-aw1") });
  });

  it("matches a new workspace by its name and key prefix", async () => {
    await workspaceIn(join(work, "demo"), OTHER, "demo", "DM");
    const same = await chooseWorkspaceFolder(
      { parent: work, name: "demo", match: { name: "demo", key_prefix: "DM" } },
      context,
    );
    expect(same.root).toBe(join(work, "demo"));
    const other = await chooseWorkspaceFolder(
      { parent: work, name: "demo", match: { name: "demo", key_prefix: "XY" } },
      context,
    );
    expect(other.root).toBe(join(work, "demo-aw1"));
  });

  it("skips a file and a symbolic link with the name", async () => {
    await fileIn(join(work, "demo"));
    await mkdir(join(base, "empty"));
    await symlink(join(base, "empty"), join(work, "demo-aw1"));
    const choice = await join_(work);
    expect(choice.root).toBe(join(work, "demo-aw2"));
    expect(choice.note).toContain("(a file)");
    expect(choice.note).toContain("(a symbolic link)");
  });

  it("skips a folder of an open join and a registered folder of another workspace", async () => {
    context.reserved = [{ id: OTHER, path: join(work, "demo") }];
    context.registered = [{ id: OTHER, path: join(work, "demo-aw1") }];
    expect((await join_(work)).root).toBe(join(work, "demo-aw2"));
  });

  it("uses a registered folder that is a symbolic link again for the same workspace", async () => {
    await workspaceIn(join(base, "disk", "demo"), OTHER);
    await mkdir(work, { recursive: true });
    await symlink(join(base, "disk", "demo"), join(work, "demo"));
    context.registered = [{ id: OTHER, path: join(work, "demo") }];
    const init = (match: FolderMatch) =>
      chooseWorkspaceFolder({ parent: work, name: "demo", match }, context);
    expect(await init({ name: "demo", key_prefix: "DM" })).toEqual({
      root: join(work, "demo"),
      note: null,
    });
    // Another workspace still skips it.
    expect((await init({ name: "demo", key_prefix: "XY" })).root).toBe(join(work, "demo-aw1"));
  });

  it.skipIf(process.getuid?.() === 0)("skips a folder that AW cannot read", async () => {
    await fileIn(join(work, "demo", "a.txt"));
    await chmod(join(work, "demo"), 0o000);
    try {
      const choice = await join_(work);
      expect(choice.root).toBe(join(work, "demo-aw1"));
      expect(choice.note).toContain("(AW cannot read it)");
      await expect(checkJoinFolder(join(work, "demo"), WS, context)).rejects.toMatchObject({
        code: "refused",
      });
    } finally {
      // The cleanup of the temp folder must read it.
      await chmod(join(work, "demo"), 0o755);
    }
  });

  it("refuses after -aw99", async () => {
    await fileIn(join(work, "demo", "a"));
    for (let n = 1; n <= 99; n += 1) await fileIn(join(work, `demo-aw${n}`, "a"));
    await expect(join_(work)).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses a location in the state folder, also through a symbolic link", async () => {
    await expect(join_(join(base, "state", "x"))).rejects.toMatchObject({ code: "conflict" });
    await symlink(join(base, "state"), join(base, "link"));
    await expect(join_(join(base, "link"))).rejects.toThrow(/state folder/);
  });

  it("refuses a location that holds the state folder", async () => {
    context.home = join(work, "demo", ".aw");
    await expect(join_(work)).rejects.toThrow(/state folder/);
  });

  it("refuses a location in another workspace folder", async () => {
    await workspaceIn(join(base, "personal"), OTHER);
    context.registered = [{ id: OTHER, path: join(base, "personal") }];
    await expect(join_(join(base, "personal", "sub"))).rejects.toThrow(/workspace folder/);
  });

  it("refuses a location in a checkout, and a folder that holds a checkout", async () => {
    await mkdir(join(base, "billing-api", ".git"), { recursive: true });
    context.checkouts = [join(base, "billing-api")];
    await expect(join_(join(base, "billing-api"))).rejects.toThrow(/checkout/);
    context.checkouts = [join(work, "demo", "api")];
    await expect(join_(work)).rejects.toThrow(/checkout/);
  });

  it("resolves a symbolic link location for the checks and keeps the path as given", async () => {
    await mkdir(work, { recursive: true });
    await symlink(work, join(base, "work-link"));
    expect((await join_(join(base, "work-link"))).root).toBe(join(base, "work-link", "demo"));
    context.checkouts = [join(work, "demo")];
    await expect(join_(join(base, "work-link"))).rejects.toThrow(/checkout/);
  });

  it("skips a registered folder of another workspace behind a symbolic link location", async () => {
    // The folder of a joined workspace before its files arrive: only an empty tasks folder.
    await mkdir(join(work, "demo", "tasks"), { recursive: true });
    await symlink(work, join(base, "work-link"));
    context.registered = [{ id: OTHER, path: join(work, "demo") }];
    expect((await join_(join(base, "work-link"))).root).toBe(join(base, "work-link", "demo-aw1"));
    await rm(join(work, "demo"), { recursive: true });
    expect((await join_(join(base, "work-link"))).root).toBe(join(base, "work-link", "demo-aw1"));
  });

  it("skips a folder of an open join behind a symbolic link location", async () => {
    await mkdir(work, { recursive: true });
    await symlink(work, join(base, "work-link"));
    context.reserved = [{ id: OTHER, path: join(work, "demo") }];
    expect((await join_(join(base, "work-link"))).root).toBe(join(base, "work-link", "demo-aw1"));
  });

  it("refuses a location in a workspace folder that is not registered", async () => {
    await workspaceIn(join(base, "acme"), OTHER, "acme");
    await expect(join_(join(base, "acme", "sub"))).rejects.toThrow(
      /sub\/demo is in the workspace folder \S*\/acme: /,
    );
  });

  it("uses the location when it is the folder of this workspace", async () => {
    await workspaceIn(join(base, "demo"), WS);
    expect((await join_(join(base, "demo"))).root).toBe(join(base, "demo"));
  });

  it.skipIf(process.getuid?.() === 0)("refuses a location that is not writable", async () => {
    await mkdir(work, { recursive: true });
    await chmod(work, 0o555);
    await expect(join_(work)).rejects.toMatchObject({ code: "refused" });
  });

  it("refuses a relative location and a location that is a file", async () => {
    await expect(join_("work")).rejects.toMatchObject({ code: "invalid_input" });
    await fileIn(work);
    await expect(join_(work)).rejects.toThrow(/not a folder/);
  });
});

describe("checkJoinFolder (the old --path form)", () => {
  it("allows a missing folder, an empty folder and the folder of this workspace", async () => {
    await expect(checkJoinFolder(join(work, "a"), WS, context)).resolves.toBeUndefined();
    await mkdir(join(work, "b", "knowledge"), { recursive: true });
    await expect(checkJoinFolder(join(work, "b"), WS, context)).resolves.toBeUndefined();
    await workspaceIn(join(work, "c"), WS);
    await expect(checkJoinFolder(join(work, "c"), WS, context)).resolves.toBeUndefined();
  });

  it("refuses other files and another workspace, and names --in", async () => {
    await fileIn(join(work, "notes.txt"));
    await expect(checkJoinFolder(work, WS, context)).rejects.toThrow(`--in ${work}`);
    await workspaceIn(join(base, "other"), OTHER);
    await expect(checkJoinFolder(join(base, "other"), WS, context)).rejects.toThrow(OTHER);
    // The hint names the folder that holds the other workspace, not the workspace folder.
    const error = await checkJoinFolder(join(base, "other"), WS, context).catch((e: Error) => e);
    expect((error as Error).message.endsWith(`with --in ${base}`)).toBe(true);
  });

  it("refuses the registered folder of another workspace before its files arrive", async () => {
    await mkdir(join(work, "demo", "tasks"), { recursive: true });
    context.registered = [{ id: OTHER, path: join(work, "demo") }];
    await expect(checkJoinFolder(join(work, "demo"), WS, context)).rejects.toThrow(
      /workspace folder/,
    );
  });

  it("refuses the folder of another open join, and allows the own one", async () => {
    context.reserved = [{ id: OTHER, path: join(work, "demo") }];
    await expect(checkJoinFolder(join(work, "demo"), WS, context)).rejects.toThrow(/open join/);
    await expect(checkJoinFolder(join(work, "demo"), OTHER, context)).resolves.toBeUndefined();
  });

  it("runs the safety checks", async () => {
    await expect(checkJoinFolder(join(base, "state", "w"), WS, context)).rejects.toThrow(
      /state folder/,
    );
  });
});

describe("folderName", () => {
  it("removes path separators and a leading dot", () => {
    expect(folderName("../a/b", "x")).toBe("a-b");
    expect(folderName("...", "fallback")).toBe("fallback");
    expect(folderName("Side projects", "x")).toBe("Side projects");
  });
});
