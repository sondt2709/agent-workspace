// Tests against a real tmux on a private socket. AW_E2E_TMUX selects the binary (AGENTS.md "Tests").
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  findTmux,
  groupProcessesSince,
  packageName,
  parseElapsed,
  parseFields,
  parseProcessTable,
  processExists,
  sessionProcesses,
  TmuxHost,
} from "./index.ts";

async function waitFor(check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`The condition was not true after ${ms} ms`);
}

const binary = process.env.AW_E2E_TMUX ?? (await findTmux(process.env.PATH));
let dir: string;
let host: TmuxHost;

describe("@aw/host-tmux", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@aw/host-tmux");
  });

  it("parses a format line with the | separator and refuses another field count", () => {
    expect(parseFields("@1|%1|271", 3, "3.4")).toEqual(["@1", "%1", "271"]);
    expect(parseFields("aw-x|@1|%1|271|1|3", 6, "3.4")).toEqual([
      "aw-x",
      "@1",
      "%1",
      "271",
      "1",
      "3",
    ]);
    // tmux 3.3a (Debian 12) printed a tab of a format as "_": the line is refused, not cut.
    expect(() => parseFields("@1_%1_271", 3, "3.3a")).toThrow(
      "tmux 3.3a gave 1 fields, not 3: @1_%1_271",
    );
    expect(() => parseFields("@1|%1", 3, null)).toThrow("tmux (unknown version) gave 2 fields");
  });

  it("skips a tmux in a /.orca/ folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "awt-"));
    const shim = join(root, ".orca", "bin");
    const real = join(root, "usr", "bin");
    for (const folder of [shim, real]) {
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "tmux"), "#!/bin/sh\n");
      await chmod(join(folder, "tmux"), 0o755);
    }
    expect(await findTmux(`${shim}:${real}`)).toBe(join(real, "tmux"));
    await rm(root, { recursive: true, force: true });
  });

  it("finds the session processes from the pids, never by name", () => {
    const rows = parseProcessTable(" 10 1 10\n 11 10 10\n 12 11 12\n 13 1 13\n 14 12 12\n");
    expect([...sessionProcesses(rows, 10, 10)].sort()).toEqual([10, 11, 12, 14]);
  });

  it("keeps only the group members that started after the pane opened", () => {
    expect(parseElapsed("05:07")).toBe(307);
    expect(parseElapsed("2-01:00:00")).toBe(2 * 86_400 + 3600);
    expect(parseElapsed("x")).toBeNull();
    const now = 1_000_000_000;
    // 20 started 1 h ago (a reused pid), 21 and its child 22 started 10 s ago.
    const rows = parseProcessTable(
      " 20 1 20 01:00:00\n 21 1 20 00:10\n 22 21 22 00:09\n 23 1 23 00:05\n",
      now,
    );
    expect([...groupProcessesSince(rows, 20, now - 60_000)].sort()).toEqual([21, 22]);
    expect([...groupProcessesSince(rows, 20, now - 2 * 3600_000)].sort()).toEqual([20, 21, 22]);
  });
});

/** A process of its own group that has nothing to do with AW. */
function unrelatedProcess(): number {
  const child = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
  child.unref();
  return child.pid!;
}

describe.skipIf(!binary)("tmux host", () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "awt-"));
    host = new TmuxHost({
      binary,
      socket: `aw-test-${process.pid}`,
      configFile: join(dir, "tmux.conf"),
    });
  });
  afterAll(async () => {
    await host.killServer();
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps a dead pane with its exit status", async () => {
    expect((await host.detect()).available).toBe(true);
    const ref = await host.open({
      name: "aw-dead",
      cwd: dir,
      command: ["sh", "-c", "exit 3"],
      env: {},
    });
    expect(ref.pgid).toBeGreaterThan(1);
    await waitFor(async () => (await host.list()).some((p) => p.pane === ref.pane && p.dead));
    const pane = (await host.list()).find((p) => p.pane === ref.pane)!;
    expect(pane).toMatchObject({ name: "aw-dead", dead: true, status: 3 });
    expect(await host.alive(ref)).toBe(false);
    await host.close(ref);
    expect((await host.list()).some((p) => p.pane === ref.pane)).toBe(false);
  });

  it("lists a window whose name has a | and keeps the other panes (fix list 0-40)", async () => {
    const ref = await host.open({ name: "aw-pipe", cwd: dir, command: ["sleep", "30"], env: {} });
    const other = await host.open({
      name: "aw-other",
      cwd: dir,
      command: ["sleep", "30"],
      env: {},
    });
    const renamed = spawn(binary!, [
      "-L",
      `aw-test-${process.pid}`,
      "rename-window",
      "-t",
      ref.window,
      "build|test",
    ]);
    await new Promise((resolve) => renamed.on("exit", resolve));
    const panes = await host.list();
    expect(panes.find((p) => p.pane === ref.pane)).toMatchObject({
      name: "build|test",
      dead: false,
    });
    expect(panes.find((p) => p.pane === other.pane)).toMatchObject({ name: "aw-other" });
    expect(await host.alive(other)).toBe(true);
    await host.close(ref);
    await host.close(other);
  });

  it("refuses a command that tmux would give to a shell", async () => {
    await expect(
      host.open({ name: "aw-x", cwd: dir, command: ["echo hi"], env: {} }),
    ).rejects.toThrow(/2 or more/);
  });

  it("pastes a multi-line text as one bracketed paste", async () => {
    const out = join(dir, "paste.txt");
    const script = join(dir, "reader.mjs");
    await writeFile(
      script,
      [
        "import { appendFileSync } from 'node:fs';",
        "process.stdin.setRawMode(true);",
        "process.stdout.write('\\u001b[?2004h ready\\n');",
        `process.stdin.on('data', (d) => appendFileSync(${JSON.stringify(out)}, d));`,
      ].join("\n"),
    );
    const ref = await host.open({
      name: "aw-paste",
      cwd: dir,
      command: [process.execPath, script],
      env: { AW_TEST: "1" },
    });
    await waitFor(async () => (await host.capture(ref, 5)).includes("ready"));
    await host.paste(ref, "a\nb\nc");
    await host.keys(ref, ["Enter"]);
    await waitFor(async () => (await readFile(out, "utf8").catch(() => "")).endsWith("\r"));
    const text = (await readFile(out, "utf8")).replace(/\r(?!$)/g, "\n");
    expect(text).toBe("\u001b[200~a\nb\nc\u001b[201~\r");
    await expect(host.keys(ref, ["hello world"])).rejects.toThrow(/not a key name/);
    await host.stop(ref, { graceMs: 500 });
    await host.close(ref);
  });

  it("stops the process group and each descendant, also a background process", async () => {
    const pidFile = join(dir, "child.pid");
    const script = join(dir, "parent.mjs");
    await writeFile(
      script,
      [
        "import { spawn } from 'node:child_process';",
        "import { writeFileSync } from 'node:fs';",
        "const child = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });",
        `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
        "process.on('SIGTERM', () => {});",
        "setInterval(() => {}, 1000);",
      ].join("\n"),
    );
    const ref = await host.open({
      name: "aw-stop",
      cwd: dir,
      command: [process.execPath, script],
      env: {},
    });
    await waitFor(async () => (await readFile(pidFile, "utf8").catch(() => "")).length > 0);
    const child = Number(await readFile(pidFile, "utf8"));
    expect(processExists(child)).toBe(true);
    await host.stop(ref, { graceMs: 300 });
    await waitFor(() => !processExists(ref.pid) && !processExists(child));
    await host.close(ref);
  });

  it("signals nothing when the stored pane is gone and its pid belongs to another process", async () => {
    const other = unrelatedProcess();
    try {
      await host.stop(
        { host: "tmux", window: "@999", pane: "%999", pid: other, pgid: other, opened: 0 },
        { graceMs: 200 },
      );
      expect(processExists(other)).toBe(true);
    } finally {
      process.kill(other, "SIGKILL");
    }
  });

  it("in a dead pane, stops only the group members that started after the pane opened", async () => {
    const pidFile = join(dir, "bg.pid");
    const ref = await host.open({
      name: "aw-bg",
      cwd: dir,
      command: [
        "sh",
        "-c",
        `trap '' HUP; sleep 300 </dev/null >/dev/null 2>&1 & echo $! > ${pidFile}; exit 0`,
      ],
      env: {},
    });
    await waitFor(async () => (await host.list()).some((p) => p.pane === ref.pane && p.dead));
    const bg = Number(await readFile(pidFile, "utf8"));
    expect(processExists(bg)).toBe(true);
    // A pane that opened later than this process: the process is not of the session.
    await host.stop({ ...ref, opened: Date.now() + 60_000 }, { graceMs: 200 });
    expect(processExists(bg)).toBe(true);
    await host.stop(ref, { graceMs: 200 });
    await waitFor(() => !processExists(bg));
    await host.close(ref);
  });
});
