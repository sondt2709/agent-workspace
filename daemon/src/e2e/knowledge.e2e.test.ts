// E2E of the knowledge store with real processes (handoff knowledge, test plan): awd as a child
// process with a temp AW_HOME and a temp AW folder, the aw binary, writes through the API and
// directly on disk (also while awd is stopped), a change of another device, Undo of each, then a
// check of the files, the history store and the change log.
import { AwClient } from "@aw/client";
import { sha256Of } from "@aw/kb-files";
import { eventV1 } from "@aw/schema";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSettings } from "../settings.ts";
import { otherDevice, tempDir, waitFor, writeTestConfig } from "../testing.ts";

const AWD = fileURLToPath(new URL("../bin/awd.ts", import.meta.url));
const AW = fileURLToPath(new URL("../bin/aw.ts", import.meta.url));
const run = promisify(execFile);

let home: string;
let folder: string;
let awd: ChildProcess | null = null;
const env = () => ({ ...process.env, AW_HOME: home, AW_LOG_LEVEL: "info" });

function startAwd(): ChildProcess {
  return spawn(process.execPath, [AWD], { env: env(), stdio: ["ignore", "ignore", "pipe"] });
}

async function stopAwd(): Promise<void> {
  if (!awd) return;
  const exited = new Promise((resolve) => awd!.once("exit", resolve));
  awd.kill("SIGTERM");
  await exited;
  awd = null;
}

async function aw(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await run(process.execPath, [AW, ...args], { env: env(), cwd: folder });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

async function waitReady(): Promise<void> {
  const client = new AwClient({ socketPath: join(home, "run", "awd.sock") });
  await waitFor(async () => {
    try {
      return (await client.ready()).ready;
    } catch {
      return false;
    }
  }, 10_000);
}

const kfile = (path: string) => join(folder, "knowledge", ...path.split("/"));

interface LogLine {
  id: string;
  type: string;
  dev: string;
  by?: string;
  data: { path: string; hash: string | null; base: string | null; author: string; kind: string };
}

async function log(device: string): Promise<LogLine[]> {
  const text = await readFile(join(folder, "knowledge", "log", `${device}.jsonl`), "utf8").catch(
    () => "",
  );
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogLine);
}

async function waitForChange(device: string, check: (line: LogLine) => boolean): Promise<LogLine> {
  let found: LogLine | undefined;
  await waitFor(async () => {
    found = (await log(device)).find(check);
    return found !== undefined;
  }, 15_000);
  return found!;
}

beforeAll(async () => {
  home = await tempDir("awk-");
  folder = await tempDir("awkf-");
  await writeTestConfig(loadSettings({ AW_HOME: home, HOME: home }));
});

afterAll(async () => {
  awd?.kill("SIGKILL");
  await rm(home, { recursive: true, force: true });
  await rm(folder, { recursive: true, force: true });
});

describe("knowledge with awd and aw as real processes", { timeout: 90_000 }, () => {
  let workspaceId: string;
  const testing = "shared/testing.md";
  const notes = "projects/billing-api/notes.md";
  const v1 = "# Testing\n\nUse the fake clock.\n";
  const v2 = "# Testing\n\nUse the fake clock.\nNever sleep in a test.\n";
  const notesText = "Billing notes, written in an editor.\n";
  let apiChange: string;
  let directEdit: LogLine;
  let directNew: LogLine;

  it("writes through the API with aw kb write", async () => {
    awd = startAwd();
    await waitReady();
    expect((await aw(["workspace", "init", folder, "--name", "acme"])).code).toBe(0);
    expect((await aw(["project", "add", "billing-api"])).code).toBe(0);
    workspaceId = (
      JSON.parse((await aw(["workspace", "list", "--json"])).stdout) as { id: string }[]
    )[0]!.id;
    await writeFile(join(folder, "v1.md"), v1);
    const write = await aw(["kb", "write", testing, "--file", "v1.md", "--new", "--json"]);
    expect(write.code).toBe(0);
    apiChange = (JSON.parse(write.stdout) as { change: { id: string } }).change.id;
    expect(await readFile(kfile(testing), "utf8")).toBe(v1);
  });

  it("finds direct edits on disk with the watcher and logs them as human edits", async () => {
    await writeFile(kfile(testing), v2);
    await mkdir(join(folder, "knowledge", "projects", "billing-api"), { recursive: true });
    await writeFile(kfile(notes), notesText);
    directEdit = await waitForChange(
      "macbook-pro",
      (l) => l.data.path === testing && l.data.hash === sha256Of(v2),
    );
    directNew = await waitForChange("macbook-pro", (l) => l.data.path === notes);
    expect(directEdit).toMatchObject({
      by: "human@macbook-pro",
      data: { kind: "edit", base: sha256Of(v1), author: "human@macbook-pro" },
    });
    expect(directNew.data).toMatchObject({ kind: "edit", base: null, hash: sha256Of(notesText) });
  });

  it("undoes the direct edit and the API write with aw kb undo", async () => {
    const undoEdit = await aw(["kb", "undo", directEdit.id]);
    expect(undoEdit.code).toBe(0);
    expect(await readFile(kfile(testing), "utf8")).toBe(v1);
    const undoNew = await aw(["kb", "undo", directNew.id]);
    expect(undoNew.code).toBe(0);
    await expect(stat(kfile(notes))).rejects.toThrow(/ENOENT/);
    const undoApi = await aw(["kb", "undo", apiChange]);
    expect(undoApi.code).toBe(0);
    await expect(stat(kfile(testing))).rejects.toThrow(/ENOENT/);
    // Undo of the undo brings the file back.
    const undoLines = (await log("macbook-pro")).filter((l) => l.data.kind === "undo");
    expect(undoLines).toHaveLength(3);
    expect((await aw(["kb", "undo", undoLines[2]!.id])).code).toBe(0);
    expect(await readFile(kfile(testing), "utf8")).toBe(v1);
  });

  it("logs an edit made while awd was stopped at the next start", async () => {
    await stopAwd();
    await writeFile(kfile(testing), v2);
    awd = startAwd();
    await waitReady();
    const offline = await waitForChange(
      "macbook-pro",
      (l) => l.data.path === testing && l.data.hash === sha256Of(v2) && l.id !== directEdit.id,
    );
    expect(offline.data).toMatchObject({ kind: "edit", base: sha256Of(v1) });
  });

  it("logs no event for a change of another device, and undoes it", async () => {
    const ubuntu = otherDevice(folder, "ubuntu-01");
    const remote = "# Testing\n\nThe server version.\n";
    await ubuntu.writeFile(`knowledge/${testing}`, remote);
    await ubuntu.writeEvent("knowledge/log/ubuntu-01.jsonl", "knowledge.changed", {
      path: testing,
      hash: sha256Of(remote),
      base: sha256Of(v2),
      author: "human@ubuntu-01",
      kind: "edit",
    });
    const remoteId = (await log("ubuntu-01"))[0]!.id;
    const before = (await log("macbook-pro")).length;
    // The version reaches the history store of this device; no event of this device is logged.
    const store = join(home, "history", workspaceId);
    await waitFor(async () => (await readdir(store)).includes(sha256Of(remote)), 15_000);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect((await log("macbook-pro")).length).toBe(before);
    const undo = await aw(["kb", "undo", remoteId]);
    expect(undo.code).toBe(0);
    expect(await readFile(kfile(testing), "utf8")).toBe(v2);
  });

  it("keeps each version in the history store and a valid change log", async () => {
    const store = join(home, "history", workspaceId);
    expect((await stat(store)).mode & 0o777).toBe(0o700);
    for (const text of [v1, v2, notesText]) {
      const file = join(store, sha256Of(text));
      expect(await readFile(file, "utf8")).toBe(text);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
    // The history store is outside the synced folder.
    expect(store.startsWith(folder)).toBe(false);
    const lines = await log("macbook-pro");
    for (const line of lines) expect(eventV1.safeParse(line).success).toBe(true);
    const kinds = lines.map((l) => `${l.data.kind}:${l.data.path}`);
    // The 2 direct edits of one watcher batch are logged in path order.
    expect(kinds.slice(1, 3).sort()).toEqual([`edit:${notes}`, `edit:${testing}`]);
    expect([kinds[0], ...kinds.slice(3)]).toEqual([
      `edit:${testing}`,
      `undo:${testing}`,
      `undo:${notes}`,
      `undo:${testing}`,
      `undo:${testing}`,
      `edit:${testing}`,
      `undo:${testing}`,
    ]);
    const history = JSON.parse((await aw(["kb", "history", testing, "--json"])).stdout) as {
      dev: string;
      kind: string;
    }[];
    expect(history.map((h) => `${h.dev}:${h.kind}`)).toEqual([
      "macbook-pro:edit",
      "macbook-pro:edit",
      "macbook-pro:undo",
      "macbook-pro:undo",
      "macbook-pro:undo",
      "macbook-pro:edit",
      "ubuntu-01:edit",
      "macbook-pro:undo",
    ]);
    await stopAwd();
  });
});
