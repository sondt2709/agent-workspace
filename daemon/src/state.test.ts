// The settings module and the state folder (spec awd-service: settings, modes, config).
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { loadSettings } from "./settings.ts";
import {
  loadConfig,
  MAX_SOCKET_PATH_BYTES,
  prepareStateFolders,
  saveConfig,
  slugFromHostname,
} from "./state.ts";
import { tempDir } from "./testing.ts";

let home: string | null = null;
afterEach(async () => {
  if (home) await rm(home, { recursive: true, force: true });
  home = null;
});

describe("settings", () => {
  it("uses AW_HOME for the state folder and the socket", () => {
    const settings = loadSettings({ AW_HOME: "/tmp/x", HOME: "/home/user" }, "linux");
    expect(settings).toEqual({
      home: "/tmp/x",
      socketPath: "/tmp/x/run/awd.sock",
      logLevel: "info",
      userHome: "/home/user",
      homeFromEnv: true,
      sudoUser: null,
      sync: {
        engine: "/tmp/x/engine/syncthing",
        engineFromEnv: false,
        listen: "tcp://0.0.0.0:22300",
        community: true,
        communityFromEnv: false,
        testPeers: false,
      },
      sessions: {
        tmux: null,
        tmuxSocket: "aw",
        orca: null,
        claude: "claude",
        claudeModel: null,
        claudeConfigDir: "/home/user/.claude",
        claudeConfigEnv: null,
        maxWorking: 2,
        diskFullPercent: 95,
        path: "/usr/local/bin:/usr/bin:/bin",
        session: null,
        token: null,
      },
      mcp: {
        ports: [7433, 7434, 7435, 7436, 7437, 7438, 7439, 7440, 7441, 7442],
        portFile: "/tmp/x/run/mcp.port",
        error: null,
      },
      keystore: "file",
    });
  });

  it("selects the keystore: os on macOS with ~/.aw, else file, and AW_KEYSTORE wins", () => {
    expect(loadSettings({ HOME: "/h" }, "darwin").keystore).toBe("os");
    expect(loadSettings({ HOME: "/h", AW_HOME: "/tmp/aw" }, "darwin").keystore).toBe("file");
    expect(loadSettings({ HOME: "/h" }, "linux").keystore).toBe("file");
    expect(
      loadSettings({ HOME: "/h", AW_HOME: "/tmp/aw", AW_KEYSTORE: "os" }, "linux").keystore,
    ).toBe("os");
    expect(loadSettings({ HOME: "/h", AW_KEYSTORE: "FILE" }, "darwin").keystore).toBe("file");
    // A moved key (aw service move-keys): the file keystore, also with no AW_KEYSTORE.
    const moved = (path: string) => path === "/h/.aw/keys/device";
    expect(loadSettings({ HOME: "/h" }, "darwin", moved).keystore).toBe("file");
    expect(loadSettings({ HOME: "/h", AW_KEYSTORE: "os" }, "darwin", moved).keystore).toBe("os");
    expect(() => loadSettings({ HOME: "/h", AW_KEYSTORE: "vault" })).toThrow(
      "AW_KEYSTORE must be one of os, file, not vault",
    );
  });

  it("has no setting for the VAPID contact (owner decision Q9)", () => {
    const settings = loadSettings({ HOME: "/h", AW_PUSH_SUBJECT: "mailto:ops@example.com" });
    expect(JSON.stringify(settings)).not.toContain("ops@example.com");
  });

  it("reads the sync engine settings and refuses bad values", () => {
    const env = {
      HOME: "/h",
      AW_SYNC_ENGINE: "/opt/aw/syncthing",
      AW_SYNC_LISTEN: "tcp://127.0.0.1:22310",
      AW_SYNC_COMMUNITY: "OFF",
      AW_SYNC_TEST_PEERS: "on",
    };
    expect(loadSettings(env).sync).toEqual({
      engine: "/opt/aw/syncthing",
      engineFromEnv: true,
      listen: "tcp://127.0.0.1:22310",
      community: false,
      communityFromEnv: true,
      testPeers: true,
    });
    expect(loadSettings({ HOME: "/h" }).sync.testPeers).toBe(false);
    expect(() => loadSettings({ HOME: "/h", AW_SYNC_TEST_PEERS: "yes" })).toThrow(
      "AW_SYNC_TEST_PEERS must be one of on, off, not yes",
    );
    expect(() => loadSettings({ HOME: "/h", AW_SYNC_COMMUNITY: "maybe" })).toThrow(
      "AW_SYNC_COMMUNITY must be one of on, off, not maybe",
    );
    expect(() => loadSettings({ HOME: "/h", AW_SYNC_LISTEN: "22300" })).toThrow(/AW_SYNC_LISTEN/);
  });

  it("reads the session settings: tmux, the agent binary, the model and the session", () => {
    const settings = loadSettings({
      HOME: "/h",
      PATH: "/opt/bin:/usr/bin",
      AW_TMUX: "/opt/tmux",
      AW_TMUX_SOCKET: "aw-e2e",
      AW_ORCA: "/opt/orca/bin/orca-ide",
      AW_CLAUDE: "/opt/fake/claude",
      AW_CLAUDE_MODEL: "haiku",
      CLAUDE_CONFIG_DIR: "/h/claude-config",
      AW_SESSION: "0193a7d1-0000-7000-8000-000000000001",
      AW_TASK: "0193a7c2-5b1e-7c3a-9f20-6d1e2a4b8c01",
      AW_MCP_TOKEN: "awt_example",
    });
    expect(settings.sessions).toEqual({
      tmux: "/opt/tmux",
      tmuxSocket: "aw-e2e",
      orca: "/opt/orca/bin/orca-ide",
      claude: "/opt/fake/claude",
      claudeModel: "haiku",
      claudeConfigDir: "/h/claude-config",
      claudeConfigEnv: "/h/claude-config",
      maxWorking: 2,
      diskFullPercent: 95,
      path: "/opt/bin:/usr/bin",
      session: {
        id: "0193a7d1-0000-7000-8000-000000000001",
        task: "0193a7c2-5b1e-7c3a-9f20-6d1e2a4b8c01",
        workspace: null,
      },
      token: "awt_example",
    });
    expect(() => loadSettings({ HOME: "/h", AW_TMUX_SOCKET: "a b" })).toThrow(/AW_TMUX_SOCKET/);
    expect(loadSettings({ HOME: "/h", AW_MAX_WORKING: "4" }).sessions.maxWorking).toBe(4);
    expect(() => loadSettings({ HOME: "/h", AW_MAX_WORKING: "0" })).toThrow(/AW_MAX_WORKING/);
  });

  it("reads the MCP port range", () => {
    const range = loadSettings({ HOME: "/h" }).mcp;
    expect(range.ports).toEqual([7433, 7434, 7435, 7436, 7437, 7438, 7439, 7440, 7441, 7442]);
    expect(range.portFile).toBe("/h/.aw/run/mcp.port");
    expect(loadSettings({ HOME: "/h", AW_MCP_PORT: "7500" }).mcp.ports).toEqual([7500]);
    expect(loadSettings({ HOME: "/h", AW_MCP_PORT: "0" }).mcp.ports).toEqual([0]);
    expect(loadSettings({ HOME: "/h", AW_MCP_PORT: "OFF" }).mcp.ports).toEqual([]);
    // A bad value: only awd fails on it (startServer), so aw, aw-hook and aw-launch of a session
    // with a bad inherited value still work.
    expect(loadSettings({ HOME: "/h", AW_MCP_PORT: "abc" }).mcp).toMatchObject({
      ports: [],
      error: "AW_MCP_PORT must be a port number, 0 or off, not abc",
    });
    expect(loadSettings({ HOME: "/h", AW_MCP_PORT: "70000" }).mcp.error).toMatch(/AW_MCP_PORT/);
    expect(loadSettings({ HOME: "/h", AW_MCP_PORT: "7500" }).mcp.error).toBeNull();
  });

  it("reads the user that ran sudo", () => {
    const env = { HOME: "/var/root", SUDO_USER: "user", SUDO_UID: "501", SUDO_GID: "20" };
    expect(loadSettings(env)).toMatchObject({
      homeFromEnv: false,
      sudoUser: { name: "user", uid: 501, gid: 20 },
    });
    expect(loadSettings({ HOME: "/h", SUDO_USER: "user" }).sudoUser).toBeNull();
    expect(loadSettings({ HOME: "/h", SUDO_USER: "x", SUDO_UID: "5x" }).sudoUser).toBeNull();
  });

  it("defaults to ~/.aw and refuses an unknown log level", () => {
    expect(loadSettings({ HOME: "/home/user" }).home).toBe("/home/user/.aw");
    expect(loadSettings({ HOME: "/h", AW_LOG_LEVEL: "DEBUG" }).logLevel).toBe("debug");
    expect(() => loadSettings({ HOME: "/h", AW_LOG_LEVEL: "loud" })).toThrow(/AW_LOG_LEVEL/);
  });
});

describe("state folder", () => {
  it("creates the folders with mode 0700 and does not touch ~/.aw", async () => {
    home = await tempDir("awh-");
    const settings = loadSettings({ AW_HOME: join(home, "state"), HOME: home });
    await prepareStateFolders(settings);
    for (const folder of ["state", "state/run", "state/index", "state/logs"]) {
      expect((await stat(join(home, folder))).mode & 0o777).toBe(0o700);
    }
    await expect(stat(join(home, ".aw"))).rejects.toThrow(/ENOENT/);
  });

  it("refuses a socket path longer than the system allows", async () => {
    home = await tempDir("awh-");
    const settings = loadSettings({
      AW_HOME: join(home, "x".repeat(MAX_SOCKET_PATH_BYTES)),
      HOME: home,
    });
    await expect(prepareStateFolders(settings)).rejects.toThrow(/Use a shorter AW_HOME/);
  });

  it("creates config.yaml with a slug from the host name and the role local", async () => {
    home = await tempDir("awh-");
    const settings = loadSettings({ AW_HOME: home, HOME: home });
    const config = await loadConfig(settings);
    expect(config.device.role).toBe("local");
    expect(config.device.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(config.workspaces).toEqual([]);
    expect(parse(await readFile(join(home, "config.yaml"), "utf8"))).toEqual(config);
  });

  it("keeps the keys of a newer awd at a save (gap-setup L3: a rollback keeps the switch)", async () => {
    home = await tempDir("awh-");
    const settings = loadSettings({ AW_HOME: home, HOME: home });
    const config = await loadConfig(settings);
    const later = { ...config, later: { setting: true } };
    await writeFile(join(home, "config.yaml"), stringify(later));
    await saveConfig(settings, await loadConfig(settings));
    expect(parse(await readFile(join(home, "config.yaml"), "utf8"))).toMatchObject({
      later: { setting: true },
    });
  });

  it("makes a device slug from a host name", () => {
    expect(slugFromHostname("MacBook-Pro.local")).toBe("macbook-pro");
    expect(slugFromHostname("ubuntu_01.example.com")).toBe("ubuntu-01-example-com");
    expect(slugFromHostname("--")).toBe("device");
    expect(slugFromHostname("a".repeat(70))).toHaveLength(63);
  });
});
