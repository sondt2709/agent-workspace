// The aw CLI in process against awd on a temp socket (specs aw-cli, test plan 1).
import { MergeEngine, systemClock, type Clock } from "@aw/core";
import { FileKeystore } from "@aw/identity";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { otherDevice, startTestDaemon, tempDir, type TestDaemon } from "../testing.ts";
import { run } from "./run.ts";

let d: TestDaemon;
let out = "";
beforeEach(async () => {
  d = await startTestDaemon();
});
afterEach(async () => {
  await d.close();
});

const FIRST_MESSAGE =
  '/opsx:explore Fix "the" test.\nIt uses `date` and $(touch x).\nLine 3 ends here.\n';

async function setUp() {
  expect((await d.aw(["workspace", "init", d.folder, "--name", "acme"])).code).toBe(0);
  expect((await d.aw(["project", "add", "billing-api", "--name", "Billing API"])).code).toBe(0);
  await writeFile(join(d.folder, "m.md"), FIRST_MESSAGE);
}

describe("aw", () => {
  it("creates a workspace, a project and a task from a file, and prints the key", async () => {
    await setUp();
    const created = await d.aw([
      "task",
      "create",
      "--project",
      "billing-api",
      "--title",
      "Fix the flaky test",
      "--first-message-file",
      "m.md",
    ]);
    expect(created).toMatchObject({ code: 0, stderr: "" });
    expect(created.stdout).toMatch(/^Created AW-1 [0-9a-f-]{36} \(needs you: assign\)\n$/);
    const show = await d.aw(["task", "show", "aw-1", "--json"]);
    expect((JSON.parse(show.stdout) as { first_message: string }).first_message).toBe(
      FIRST_MESSAGE,
    );
    await expect(readFile(join(d.folder, "x"))).rejects.toThrow(/ENOENT/);
  });

  it("sends the session host of --host in task.created and task.assigned", async () => {
    await setUp();
    const created = await d.aw([
      "task",
      "create",
      "--project",
      "billing-api",
      "--title",
      "T",
      "--first-message",
      "x",
      "--assignee",
      "claude@macbook-pro",
      "--host",
      "orca",
    ]);
    expect(created.code).toBe(0);
    expect(
      (await d.aw(["task", "assign", "AW-1", "claude@macbook-pro", "--host", "tmux"])).code,
    ).toBe(0);
    expect((await d.aw(["task", "assign", "AW-1", "claude@macbook-pro"])).code).toBe(0);
    const bad = await d.aw(["task", "assign", "AW-1", "claude@macbook-pro", "--host", "screen"]);
    expect(bad.code).toBe(2);
    const events = (await d.client.thread("-", "AW-1", { limit: 100 })).events as unknown as {
      type: string;
      event: { data: Record<string, unknown> };
    }[];
    const hosts = events
      .filter((e) => e.type === "task.created" || e.type === "task.assigned")
      .map((e) => [e.type, e.event.data.session_host]);
    expect(hosts).toEqual([
      ["task.created", "orca"],
      ["task.assigned", "tmux"],
      ["task.assigned", undefined],
    ]);
    // The local API refuses another host with 400 invalid.
    await expect(
      d.client.assignTask("-", "AW-1", "claude@macbook-pro", "screen" as "orca"),
    ).rejects.toMatchObject({ status: 400 });
    // An agent does not choose the host of a subtask: the CLI refuses --host in a session.
    const inSession = await d.aw(
      ["task", "create", "--title", "Sub", "--first-message", "x", "--host", "orca"],
      {
        env: { AW_HOME: d.home, HOME: d.home, AW_SESSION: "0198a5c3-0000-7000-8000-000000000001" },
      },
    );
    expect(inSession.code).toBe(1);
    expect(inSession.stderr).toContain("Leave out --host");
  });

  it("writes only one JSON document to stdout with --json, before or after the command", async () => {
    await setUp();
    await d.aw([
      "task",
      "create",
      "--project",
      "billing-api",
      "--title",
      "A",
      "--first-message",
      "x",
    ]);
    for (const argv of [
      ["task", "list", "--json"],
      ["--json", "task", "list"],
    ]) {
      const list = await d.aw(argv);
      expect(list.code).toBe(0);
      expect(list.stderr).toBe("");
      const parsed = JSON.parse(list.stdout) as { key: string }[];
      expect(parsed.map((t) => t.key)).toEqual(["AW-1"]);
    }
    const status = await d.aw(["status", "--json"]);
    expect(JSON.parse(status.stdout)).toMatchObject({
      device: { slug: "macbook-pro" },
      ready: true,
    });
  });

  it("prints text tables and the thread", async () => {
    await setUp();
    await d.aw([
      "task",
      "create",
      "--project",
      "billing-api",
      "--title",
      "A",
      "--first-message-file",
      "m.md",
    ]);
    await d.aw(["task", "assign", "AW-1", "claude@macbook-pro"]);
    expect((await d.aw(["task", "list"])).stdout).toMatch(/KEY\s+STAGE\s+ASSIGNEE\s+TITLE/);
    expect((await d.aw(["workspace", "list"])).stdout).toContain("acme");
    expect((await d.aw(["project", "list"])).stdout).toContain("billing-api");
    const thread = await d.aw(["thread", "AW-1"]);
    expect(thread.code).toBe(0);
    expect(thread.stdout).toContain("task.created");
    expect(thread.stdout).toContain("  Line 3 ends here.");
    expect(thread.stdout).toContain("task.assigned");
    expect((await d.aw(["status"])).stdout).toContain("on macbook-pro (local)");
  });

  it("reads the first message from stdin with -", async () => {
    await setUp();
    const created = await d.aw(
      [
        "task",
        "create",
        "--project",
        "billing-api",
        "--title",
        "A",
        "--first-message-file",
        "-",
        "--json",
      ],
      { stdin: () => Promise.resolve("from stdin\n") },
    );
    expect(
      (JSON.parse(created.stdout) as { task: { first_message: string } }).task.first_message,
    ).toBe("from stdin\n");
  });

  it("answers a gate of another device and refuses a second answer after the resolution", async () => {
    await setUp();
    const created = await d.aw([
      "task",
      "create",
      "--project",
      "billing-api",
      "--title",
      "Rate limit",
      "--first-message",
      "x",
      "--assignee",
      "claude@ubuntu-01",
      "--json",
    ]);
    const taskId = (JSON.parse(created.stdout) as { task: { id: string } }).task.id;
    const ubuntu = otherDevice(d.folder, "ubuntu-01");
    const log = `tasks/${taskId}/log/ubuntu-01.jsonl`;
    await ubuntu.writeEvent(
      log,
      "task.claimed",
      { epoch: 1, device: "ubuntu-01", session: ubuntu.newId() },
      { task: taskId },
    );
    const gate = ubuntu.newId();
    await ubuntu.writeEvent(
      log,
      "gate.opened",
      {
        gate,
        kind: "question",
        version: 1,
        title: "Which limit?",
        options: ["100/min", "1000/min"],
      },
      { task: taskId, by: "claude@ubuntu-01" },
    );
    await d.server.daemon.workspace().refresh();
    const list = await d.aw(["gate", "list"]);
    expect(list.stdout).toContain(gate);
    expect(list.stdout).toContain("Options: 100/min | 1000/min");
    const answer = await d.aw(["gate", "answer", gate.slice(0, 12), "1000/min"]);
    expect(answer.code).toBe(0);
    expect(answer.stdout).toContain(
      "pending answer from human@macbook-pro on macbook-pro: 1000/min",
    );
    await ubuntu.writeEvent(
      log,
      "gate.resolved",
      { gate, version: 1, answer_event: null, answer: "1000/min" },
      { task: taskId },
    );
    await d.server.daemon.workspace().refresh();
    const again = await d.aw(["gate", "answer", gate, "100/min"]);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("gate_not_open");
  });
});

/** A task of ubuntu-01 with an open question gate of ubuntu-01 (versions 1..`versions`). */
async function gateOfUbuntu(clock: Clock = systemClock, versions = 1) {
  await setUp();
  const created = await d.aw([
    "task",
    "create",
    "--project",
    "billing-api",
    "--title",
    "Rate limit",
    "--first-message",
    "x",
    "--assignee",
    "claude@ubuntu-01",
    "--json",
  ]);
  const taskId = (JSON.parse(created.stdout) as { task: { id: string } }).task.id;
  const ubuntu = otherDevice(d.folder, "ubuntu-01", { clock });
  const log = `tasks/${taskId}/log/ubuntu-01.jsonl`;
  await ubuntu.writeEvent(
    log,
    "task.claimed",
    { epoch: 1, device: "ubuntu-01", session: ubuntu.newId() },
    { task: taskId },
  );
  const gate = ubuntu.newId();
  for (let version = 1; version <= versions; version++) {
    await ubuntu.writeEvent(
      log,
      "gate.opened",
      { gate, kind: "question", version, title: "Which limit?", options: ["100/min", "1000/min"] },
      { task: taskId, by: "claude@ubuntu-01" },
    );
  }
  await d.server.daemon.workspace().refresh();
  return { taskId, gate };
}

describe("gate answers that do not count", () => {
  it("counts an answer to a gate of a device whose clock runs 60 s ahead", async () => {
    const ahead: Clock = { now: () => Date.now() + 60_000, sleep: (ms) => systemClock.sleep(ms) };
    const { gate } = await gateOfUbuntu(ahead);
    const answer = await d.aw(["gate", "answer", gate, "1000/min", "--json"]);
    expect(answer.stderr).toBe("");
    expect(answer.code).toBe(0);
    const reply = JSON.parse(answer.stdout) as {
      reason: string | null;
      gate: { state: string; answers: { answer: string; use: string }[] };
    };
    expect(reply.reason).toBeNull();
    expect(reply.gate.answers).toEqual([
      expect.objectContaining({ answer: "1000/min", use: "pending" }),
    ]);
  });

  it("exits with 1 and the reason when the answer has an old gate version", async () => {
    const { gate } = await gateOfUbuntu(systemClock, 2);
    const answer = await d.aw(["gate", "answer", gate, "100/min", "--gate-version", "1"]);
    expect(answer.code).toBe(1);
    expect(answer.stderr).toContain("old_version");
    expect(answer.stderr).toContain("The gate still waits");
    const [open] = await d.client.gates("-");
    expect(open).toMatchObject({ gate, state: "open", version: 2 });
  });
});

describe("a write that is saved but not merged", () => {
  it("says that the write is saved, and the next merge shows it", async () => {
    await setUp();
    const update = vi.spyOn(MergeEngine.prototype, "update");
    update.mockRejectedValueOnce(new Error("EMFILE: too many open files"));
    try {
      const created = await d.aw([
        "task",
        "create",
        "--project",
        "billing-api",
        "--title",
        "A",
        "--first-message",
        "x",
      ]);
      expect(created.code).toBe(1);
      expect(created.stderr).toContain("written_not_merged");
      expect(created.stderr).toContain("Do not run the command again");
    } finally {
      update.mockRestore();
    }
    await d.server.daemon.workspace().refresh();
    const list = await d.client.tasks("-");
    expect(list.map((t) => t.key)).toEqual(["AW-1"]);
    expect(d.server.daemon.workspace().lastError).toBeNull();
  });
});

describe("exit codes", () => {
  it("0 for help and version", async () => {
    expect((await d.aw(["--help"])).code).toBe(0);
    const version = await d.aw(["--version"]);
    expect(version).toMatchObject({ code: 0, stdout: "0.0.0\n" });
  });

  it("2 for invalid input: an unknown option, a bad assignee, an unknown task, a missing message", async () => {
    await setUp();
    await d.aw([
      "task",
      "create",
      "--project",
      "billing-api",
      "--title",
      "A",
      "--first-message",
      "x",
    ]);
    expect((await d.aw(["task", "list", "--nothing"])).code).toBe(2);
    const bad = await d.aw(["task", "assign", "AW-1", "nobody"]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("invalid_input");
    expect((await d.aw(["task", "show", "AW-9"])).code).toBe(2);
    expect((await d.aw(["task", "create", "--project", "billing-api", "--title", "A"])).code).toBe(
      2,
    );
    expect(
      (
        await d.aw([
          "task",
          "create",
          "--project",
          "billing-api",
          "--title",
          "A",
          "--first-message-file",
          "no.md",
        ])
      ).code,
    ).toBe(2);
    expect((await d.aw(["thread", "AW-1", "--limit", "0"])).code).toBe(2);
  });

  it("1 when the merge did not apply the write", async () => {
    await setUp();
    const created = await d.aw([
      "task",
      "create",
      "--project",
      "billing-api",
      "--title",
      "A",
      "--first-message",
      "x",
      "--json",
    ]);
    const taskId = (JSON.parse(created.stdout) as { task: { id: string } }).task.id;
    const ws = d.server.daemon.workspace();
    await ws.files.writeEvent(`tasks/${taskId}/log/macbook-pro.jsonl`, "session.started", {
      session: ws.files.newId(),
      host: "tmux",
      cwd: "/work",
    });
    const edit = await d.aw(["task", "edit", "AW-1", "--first-message", "changed"]);
    expect(edit.code).toBe(1);
    expect(edit.stderr).toContain("first_message_locked");
  });

  it("3 when awd does not run", async () => {
    const home = await tempDir("awh-");
    let stderr = "";
    const code = await run(["status"], {
      stdout: () => undefined,
      stderr: (text) => (stderr += text),
      env: { AW_HOME: home, HOME: home },
    });
    expect(code).toBe(3);
    expect(stderr).toContain(join(home, "run", "awd.sock"));
    expect(stderr).toContain("aw service install");
    await rm(home, { recursive: true, force: true });
  });
});

describe("aw service", () => {
  it("prints the unit text and changes nothing with --print", async () => {
    const linux = await run(
      ["service", "install", "--print"],
      {
        stdout: (text) => (out += text),
        stderr: () => undefined,
        env: { AW_HOME: d.home, HOME: d.home },
      },
      { platform: "linux", runner: () => Promise.reject(new Error("no command may run")) },
    );
    expect(linux).toBe(0);
    expect(out).toContain("Restart=always");
    expect(out).toContain(`ExecStart=${process.execPath}`);
    await expect(readFile(join(d.home, ".config/systemd/user/awd.service"))).rejects.toThrow(
      /ENOENT/,
    );
    out = "";
    await run(
      ["service", "install", "--headless", "--print"],
      {
        stdout: (text) => (out += text),
        stderr: () => undefined,
        env: { AW_HOME: d.home, HOME: d.home },
      },
      { platform: "darwin" },
    );
    expect(out).toContain("<key>AbandonProcessGroup</key>");
  });

  it("installs with the runner, and refuses a LaunchDaemon without root", async () => {
    const calls: string[] = [];
    const io = {
      stdout: () => undefined,
      stderr: () => undefined,
      env: { AW_HOME: d.home, HOME: d.home },
    };
    const runner = (file: string, args: string[]) => {
      calls.push([file, ...args].join(" "));
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    };
    const engine = () =>
      Promise.resolve({
        binary: join(d.home, "engine", "syncthing"),
        tag: "v2.1.7",
        platform: "linux-x64" as const,
        installed: true,
      });
    expect(await run(["service", "install"], io, { platform: "linux", runner, engine })).toBe(0);
    expect(calls).toContain("systemctl --user enable --now awd.service");
    // A new engine: awd restarts, so it starts the engine.
    expect(calls.at(-1)).toBe("systemctl --user restart awd.service");
    expect(await readFile(join(d.home, ".config/systemd/user/awd.service"), "utf8")).toContain(
      "Restart=always",
    );
    expect(
      await run(["service", "install", "--headless"], io, { platform: "darwin", runner, uid: 501 }),
    ).toBe(2);
  });

  // The dscl reply copies a real reply of macOS 26 (`dscl . -read /Users/<name>
  // NFSHomeDirectory`, exit 0), with the user name replaced; a missing user gives exit 56 and
  // "<dscl_cmd> DS Error: -14136 (eDSRecordNotFound)".
  const dscl = (file: string, args: string[]) =>
    Promise.resolve(
      file === "dscl" && args[2] === "/Users/user"
        ? { exitCode: 0, stdout: "NFSHomeDirectory: /Users/user\n", stderr: "" }
        : { exitCode: 56, stdout: "", stderr: "<dscl_cmd> DS Error: -14136 (eDSRecordNotFound)" },
    );

  it("makes the LaunchDaemon for the user that ran sudo, never for root", async () => {
    let text = "";
    let errors = "";
    const sudo = (env: Record<string, string>) =>
      run(
        ["service", "install", "--headless", "--print"],
        {
          stdout: (value) => (text += value),
          stderr: (value) => (errors += value),
          env: { HOME: "/var/root", ...env },
        },
        { platform: "darwin", uid: 0, runner: dscl },
      );
    expect(await sudo({ SUDO_USER: "user", SUDO_UID: "501", SUDO_GID: "20" })).toBe(0);
    expect(text).toContain("<key>UserName</key>\n  <string>user</string>");
    expect(text).toContain("<key>HOME</key>\n    <string>/Users/user</string>");
    expect(text).toContain("<string>/Users/user/.aw/logs/awd.log</string>");
    expect(text).not.toContain("/var/root");
    expect(text).not.toContain("<string>root</string>");
    expect(text).not.toContain("AW_HOME");
    expect(await sudo({})).toBe(2);
    expect(await sudo({ SUDO_USER: "root", SUDO_UID: "0" })).toBe(2);
    expect(await sudo({ SUDO_USER: "nobody-here", SUDO_UID: "502" })).toBe(2);
    expect(errors).toContain("awd must not run as root");
    expect(errors).toContain("eDSRecordNotFound");
  });

  it("installs the unit with a warning when the engine fails, and names a missing tmux", async () => {
    let text = "";
    const calls: string[] = [];
    const runner = (file: string, args: string[]) => {
      calls.push([file, ...args].join(" "));
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    };
    const searched: string[] = [];
    const code = await run(
      ["service", "install"],
      {
        stdout: (value) => (text += value),
        stderr: () => undefined,
        env: { AW_HOME: d.home, HOME: d.home, PATH: "/nonexistent" },
      },
      {
        platform: "linux",
        runner,
        engine: () => Promise.reject(new Error("GET gave 404")),
        findTmux: (path) => {
          searched.push(path);
          return Promise.resolve(null);
        },
      },
    );
    // The search uses the PATH of the unit, not only the PATH of the terminal (fix list 0-24):
    // the folder of node, no folder of the terminal PATH with no tool (fc1-lead-2).
    expect(searched).toEqual([
      `${dirname(process.execPath)}:${d.home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
    ]);
    expect(await readFile(join(d.home, ".config/systemd/user/awd.service"), "utf8")).toContain(
      `Environment=PATH=${searched[0]}`,
    );
    expect(code).toBe(0);
    expect(text).toContain("The sync engine was not installed: GET gave 404");
    expect(text).toContain("aw engine install --archive <file>");
    expect(text).toContain("tmux is missing: AW sessions need it.");
    expect(calls).toContain("systemctl --user enable --now awd.service");
    expect(calls).not.toContain("systemctl --user restart awd.service");
  });

  it("refuses --headless when the device key is only in the Keychain", async () => {
    const userHome = await tempDir("awu-");
    await mkdir(join(userHome, ".aw"), { recursive: true });
    await writeFile(join(userHome, ".aw", "config.yaml"), "device: {}\n");
    let errors = "";
    const runner = (file: string) =>
      Promise.resolve(
        file === "dscl"
          ? { exitCode: 0, stdout: `NFSHomeDirectory: ${userHome}\n`, stderr: "" }
          : { exitCode: 0, stdout: "", stderr: "" },
      );
    const code = await run(
      ["service", "install", "--headless"],
      {
        stdout: () => undefined,
        stderr: (value) => (errors += value),
        env: { HOME: "/var/root", SUDO_USER: "user", SUDO_UID: "501", SUDO_GID: "20" },
      },
      { platform: "darwin", uid: 0, runner },
    );
    expect(code).toBe(1);
    expect(errors).toContain("aw service move-keys");
    await rm(userHome, { recursive: true, force: true });
  });

  it("move-keys: refuses while awd runs, then moves the keys to the file keystore", async () => {
    const io = { stdout: () => undefined, stderr: () => undefined };
    const from = new FileKeystore(join(d.home, "os-keys"));
    const to = new FileKeystore(join(d.home, "file-keys"));
    await from.set("device", "{}");
    const env = { AW_HOME: d.home, HOME: d.home };
    expect(await run(["service", "move-keys"], { ...io, env }, { keystores: { from, to } })).toBe(
      1,
    );
    const stopped = await tempDir("awm-");
    let text = "";
    const code = await run(
      ["service", "move-keys"],
      { stdout: (value) => (text += value), stderr: () => undefined, env: { AW_HOME: stopped } },
      { keystores: { from, to }, uid: 501 },
    );
    expect(code).toBe(0);
    expect(text).toContain("Moved device");
    expect(await to.get("device")).toBe("{}");
    expect(await from.get("device")).toBeNull();
    await rm(stopped, { recursive: true, force: true });
  });
});

describe("aw engine install", () => {
  it("prints the result, and refuses AW_SYNC_ENGINE with exit code 1", async () => {
    let text = "";
    let errors = "";
    const io = {
      stdout: (value: string) => (text += value),
      stderr: (value: string) => (errors += value),
    };
    const engine = () =>
      Promise.resolve({
        binary: "/h/.aw/engine/syncthing",
        tag: "v2.1.7",
        platform: "darwin-arm64" as const,
        installed: true,
      });
    expect(await run(["engine", "install"], { ...io, env: { AW_HOME: d.home } }, { engine })).toBe(
      0,
    );
    expect(text).toContain("Installed the sync engine Syncthing v2.1.7");
    expect(text).toContain("A running awd starts the engine within 5 s, with no restart.");
    expect(
      await run(["engine", "install"], {
        ...io,
        env: { AW_HOME: d.home, AW_SYNC_ENGINE: "/opt/st" },
      }),
    ).toBe(1);
    expect(errors).toContain("Unset AW_SYNC_ENGINE");
  });
});

describe("aw doctor", () => {
  it("adds a failed awd check and exits with 1 when awd does not answer", async () => {
    const home = await tempDir("awd-");
    let text = "";
    const code = await run(
      ["doctor"],
      {
        stdout: (value) => (text += value),
        stderr: () => undefined,
        env: { AW_HOME: home, HOME: home },
      },
      {
        platform: "linux",
        doctorProbes: {
          platform: "linux",
          device: "this device",
          unit: () => Promise.resolve(null),
          linger: () => Promise.resolve(null),
          tmux: () => Promise.resolve("/usr/bin/tmux"),
          tmuxInstall: () => Promise.resolve(null),
          orca: () => Promise.resolve(null),
          agent: () => Promise.resolve({ available: false, binary: "claude", version: null }),
          auth: () => Promise.reject(new Error("not used")),
          disk: () => Promise.resolve(10),
          diskLimit: 95,
          clock: () => Promise.resolve({ kind: "ntp", synced: true }),
          sync: () => Promise.resolve({ state: "not_installed", peers: [] }),
          power: () => Promise.resolve(null),
          fileVault: () => Promise.resolve(null),
          now: () => Date.now(),
        },
      },
    );
    expect(code).toBe(1);
    expect(text).toContain("[FAIL] awd: awd does not answer");
    expect(text).toContain("Fix: Run aw service install, or run awd in a terminal.");
    expect(text).toContain("Fix: Run aw engine install. awd starts the engine within 5 s.");
    await rm(home, { recursive: true, force: true });
  });
});
