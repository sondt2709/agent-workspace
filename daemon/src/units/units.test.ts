// The service units (spec awd-service: service units). The tests check the text and the commands
// with a fake runner; they never load a unit on this machine.
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "../testing.ts";
import {
  installUnit,
  launchAgentPlist,
  launchDaemonPlist,
  restartUnit,
  servicePath,
  sessionsUnit,
  systemdUnit,
  uninstallUnit,
  unitEnvOf,
  unitKind,
  unitPath,
  unitStatus,
  type CommandRunner,
  type UnitContext,
} from "./units.ts";

const context = (userHome = "/home/user"): UnitContext => ({
  nodePath: "/opt/node 24/bin/node",
  awdEntry: "/opt/aw/daemon/src/bin/awd.ts",
  awHome: `${userHome}/.aw`,
  customHome: false,
  userHome,
  userName: "someone",
  uid: 501,
});

function fakeRunner(exitCode = 0) {
  const calls: string[] = [];
  const runner: CommandRunner = (file, args) => {
    calls.push([file, ...args].join(" "));
    return Promise.resolve({ exitCode, stdout: "", stderr: exitCode === 0 ? "" : "failed" });
  };
  return { runner, calls };
}

let home: string | null = null;
afterEach(async () => {
  if (home) await rm(home, { recursive: true, force: true });
  home = null;
});

describe("unit text", () => {
  it("systemd: Restart=always and an exec-form ExecStart with absolute paths", () => {
    const text = systemdUnit(context());
    expect(text).toContain("Restart=always");
    expect(text).toContain('ExecStart="/opt/node 24/bin/node" /opt/aw/daemon/src/bin/awd.ts');
    expect(text).toContain("WantedBy=default.target");
    expect(text).not.toContain("AW_HOME");
    expect(systemdUnit({ ...context(), customHome: true, awHome: "/srv/aw" })).toContain(
      "Environment=AW_HOME=/srv/aw",
    );
  });

  it("LaunchAgent: KeepAlive, RunAtLoad, the log file and the program arguments", () => {
    const text = launchAgentPlist(context("/Users/user"));
    expect(text).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(text).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(text).toContain("<string>/opt/node 24/bin/node</string>");
    expect(text).toContain("<string>/Users/user/.aw/logs/awd.log</string>");
    expect(text).not.toContain("UserName");
    // launchd does not stop the tmux server of the sessions when awd exits.
    expect(text).toContain("<key>AbandonProcessGroup</key>\n  <true/>");
  });

  it("aw-sessions: the tmux server in its own unit, never restarted, not stopped with awd", () => {
    const text = sessionsUnit({
      tmux: "/usr/bin/tmux",
      socket: "aw",
      config: "/home/user/.aw/run/tmux.conf",
    });
    expect(text).toContain("Type=forking");
    expect(text).toContain(
      "ExecStart=/usr/bin/tmux -L aw -f /home/user/.aw/run/tmux.conf new-session -d -s aw -n aw-host -- tail -f /dev/null",
    );
    expect(text).toContain("Restart=no");
    expect(text).toContain("KillMode=process");
    expect(text).not.toContain("Restart=always");
  });

  it("LaunchDaemon: also UserName, AbandonProcessGroup, HOME and the file keystore", () => {
    const text = launchDaemonPlist(context("/Users/user"));
    expect(text).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(text).toContain("<key>UserName</key>\n  <string>someone</string>");
    expect(text).toContain("<key>AbandonProcessGroup</key>\n  <true/>");
    expect(text).toContain("<key>HOME</key>\n    <string>/Users/user</string>");
    expect(text).toContain("<key>AW_KEYSTORE</key>\n    <string>file</string>");
    expect(launchAgentPlist(context("/Users/user"))).not.toContain("AW_KEYSTORE");
  });

  it("sets PATH in each unit, so awd finds Homebrew tmux and ~/.local/bin/claude (fix list 0-24)", () => {
    // The install PATH of an interactive shell: tool shims (an Orca folder with its own tmux),
    // version managers and many other folders (fc1-lead-2). The unit gets only the folders of
    // node, tmux, claude and git, then the usual folders.
    const tools: Record<string, string[]> = {
      "/Users/user/.orca/claude-agent-teams-bin": ["tmux", "claude"],
      "/Users/user/.cargo/bin": ["cargo"],
      "/opt/homebrew/bin": ["tmux", "git"],
      "/Users/user/.local/bin": ["claude"],
      "/usr/bin": ["git"],
    };
    const path = servicePath(
      {
        installPath:
          "/Users/user/.orca/claude-agent-teams-bin:/Users/user/.cargo/bin:relative/bin:/opt/homebrew/bin:/Users/user/.local/bin:/usr/bin:/bin",
        userHome: "/Users/user",
        nodePath: "/Users/user/.nvm/versions/node/v24.22.3/bin/node",
      },
      (dir, name) => tools[dir]?.includes(name) ?? false,
    );
    expect(path).toBe(
      "/Users/user/.nvm/versions/node/v24.22.3/bin:/opt/homebrew/bin:/Users/user/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    );
    const withPath = { ...context("/Users/user"), path };
    expect(launchAgentPlist(withPath)).toContain(`<key>PATH</key>\n    <string>${path}</string>`);
    expect(launchDaemonPlist(withPath)).toContain(`<key>PATH</key>\n    <string>${path}</string>`);
    expect(systemdUnit(withPath)).toContain(`Environment=PATH=${path}`);
  });

  it("keeps the variables that the person added to the unit (fc1-lead-2, Q12 open)", () => {
    const old = launchAgentPlist({
      ...context("/Users/user"),
      path: "/usr/bin",
      env: { AW_DISK_FULL_PERCENT: "99", AW_CLAUDE_MODEL: "haiku" },
    });
    expect(unitEnvOf("launch-agent", old)).toEqual({
      AW_DISK_FULL_PERCENT: "99",
      AW_CLAUDE_MODEL: "haiku",
    });
    const next = launchAgentPlist({
      ...context("/Users/user"),
      path: "/bin",
      env: unitEnvOf("launch-agent", old),
    });
    expect(next).toContain("<key>AW_DISK_FULL_PERCENT</key>\n    <string>99</string>");
    expect(next).toContain("<key>PATH</key>\n    <string>/bin</string>");
    const unit = systemdUnit({
      ...context(),
      path: "/usr/bin",
      env: { AW_DISK_FULL_PERCENT: "99" },
    });
    expect(unitEnvOf("systemd", unit)).toEqual({ AW_DISK_FULL_PERCENT: "99" });
  });

  it("escapes XML characters in a path", () => {
    expect(launchAgentPlist({ ...context(), awdEntry: "/a&b/<awd>.ts" })).toContain(
      "<string>/a&amp;b/&lt;awd&gt;.ts</string>",
    );
  });

  it("selects the unit kind and path per platform", () => {
    expect(unitKind("linux", false)).toBe("systemd");
    expect(unitKind("darwin", false)).toBe("launch-agent");
    expect(unitKind("darwin", true)).toBe("launch-daemon");
    expect(() => unitKind("win32", false)).toThrow(/macOS and Linux/);
    expect(unitPath("launch-daemon", context())).toBe(
      "/Library/LaunchDaemons/com.agentworkspace.awd.plist",
    );
  });
});

describe("install, status, uninstall with a fake runner", () => {
  it("systemd: writes the unit and enables it", async () => {
    home = await tempDir("awu-");
    const { runner, calls } = fakeRunner();
    const result = await installUnit("systemd", context(home), runner);
    expect(result.path).toBe(join(home, ".config/systemd/user/awd.service"));
    expect(await readFile(result.path, "utf8")).toBe(systemdUnit(context(home)));
    expect(calls).toEqual([
      "systemctl --user daemon-reload",
      "systemctl --user enable --now awd.service",
      "loginctl show-user someone -p Linger --value",
    ]);
    expect(result.notes.join(" ")).toContain("loginctl enable-linger someone");
    const status = await unitStatus("systemd", context(home), runner);
    expect(status).toMatchObject({ installed: true, loaded: true });
    await uninstallUnit("systemd", context(home), runner);
    await expect(readFile(result.path, "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("systemd: also writes aw-sessions.service when tmux was found, and removes it", async () => {
    home = await tempDir("awu-");
    const { runner, calls } = fakeRunner();
    const sessions = { tmux: "/usr/bin/tmux", socket: "aw", config: `${home}/.aw/run/tmux.conf` };
    const result = await installUnit("systemd", { ...context(home), sessions }, runner);
    const unit = join(home, ".config/systemd/user/aw-sessions.service");
    expect(await readFile(unit, "utf8")).toBe(sessionsUnit(sessions));
    expect(result.notes.join(" ")).toContain("aw-sessions.service");
    calls.length = 0;
    await uninstallUnit("systemd", { ...context(home), sessions }, runner);
    await expect(readFile(unit, "utf8")).rejects.toThrow(/ENOENT/);
    // The sessions unit stops before its file goes, and systemd reloads after it.
    expect(calls).toEqual([
      "systemctl --user disable --now awd.service",
      "systemctl --user daemon-reload",
      "systemctl --user stop aw-sessions.service",
      "systemctl --user daemon-reload",
    ]);
  });

  it("LaunchAgent: bootstraps the gui domain of the user", async () => {
    home = await tempDir("awu-");
    const { runner, calls } = fakeRunner();
    await installUnit("launch-agent", context(home), runner);
    expect(calls).toEqual([
      `launchctl bootstrap gui/501 ${join(home, "Library/LaunchAgents/com.agentworkspace.awd.plist")}`,
    ]);
  });

  it("LaunchAgent: waits until launchd drops the old unit, and tries the bootstrap again (fc1-lead-1)", async () => {
    home = await tempDir("awu-");
    const calls: string[] = [];
    let prints = 0;
    let bootstraps = 0;
    const runner: CommandRunner = (file, args) => {
      calls.push([file, ...args].join(" "));
      const fail = (code: number, stderr: string) =>
        Promise.resolve({ exitCode: code, stdout: "", stderr });
      if (args[0] === "print") return ++prints <= 2 ? fail(0, "") : fail(113, "not found");
      if (args[0] === "bootstrap" && ++bootstraps === 1)
        return fail(5, "Bootstrap failed: 5: Input/output error");
      return fail(0, "");
    };
    const waits: number[] = [];
    const sleep = (ms: number) => Promise.resolve(void waits.push(ms));
    await installUnit("launch-agent", context(home), runner, { sleep });
    // A new text: unload, then wait until the label is gone, then bootstrap (twice).
    calls.length = 0;
    prints = 0;
    bootstraps = 0;
    await installUnit("launch-agent", { ...context(home), path: "/usr/bin" }, runner, { sleep });
    const plist = join(home, "Library/LaunchAgents/com.agentworkspace.awd.plist");
    expect(calls).toEqual([
      "launchctl bootout gui/501/com.agentworkspace.awd",
      "launchctl print gui/501/com.agentworkspace.awd",
      "launchctl print gui/501/com.agentworkspace.awd",
      "launchctl print gui/501/com.agentworkspace.awd",
      `launchctl bootstrap gui/501 ${plist}`,
      `launchctl bootstrap gui/501 ${plist}`,
    ]);
    expect(waits.length).toBeGreaterThan(0);
  });

  it("systemd: no linger note when linger is on (verify-journeys finding 18)", async () => {
    home = await tempDir("awu-");
    const runner: CommandRunner = (file) =>
      Promise.resolve({ exitCode: 0, stdout: file === "loginctl" ? "yes\n" : "", stderr: "" });
    const result = await installUnit("systemd", context(home), runner);
    expect(result.notes.join(" ")).not.toContain("enable-linger");
  });

  it("LaunchAgent: the uninstall stops the tmux server of the sessions (finding 19)", async () => {
    home = await tempDir("awu-");
    const { runner, calls } = fakeRunner();
    const sessions = { tmux: "/opt/homebrew/bin/tmux", socket: "aw", config: "/x/tmux.conf" };
    await installUnit("launch-agent", context(home), runner);
    calls.length = 0;
    await uninstallUnit("launch-agent", { ...context(home), sessions }, runner);
    expect(calls).toEqual([
      "launchctl bootout gui/501/com.agentworkspace.awd",
      "/opt/homebrew/bin/tmux -L aw kill-server",
    ]);
  });

  it("restarts awd with kickstart or systemctl restart", async () => {
    const { runner, calls } = fakeRunner();
    await restartUnit("launch-agent", context("/Users/user"), runner);
    await restartUnit("launch-daemon", context("/Users/user"), runner);
    await restartUnit("systemd", context(), runner);
    expect(calls).toEqual([
      "launchctl kickstart -k gui/501/com.agentworkspace.awd",
      "launchctl kickstart -k system/com.agentworkspace.awd",
      "systemctl --user restart awd.service",
    ]);
  });

  it("reports a failed load with the command and the exit code", async () => {
    home = await tempDir("awu-");
    const { runner } = fakeRunner(5);
    await expect(installUnit("systemd", context(home), runner)).rejects.toThrow(
      /systemctl --user daemon-reload failed with exit code 5/,
    );
    const status = await unitStatus("systemd", context(home), runner);
    expect(status.loaded).toBe(false);
  });
});
