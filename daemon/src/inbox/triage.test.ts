// The launch of the triage session (openspec inbox-mattermost, design 6, review of PR #8): the
// session reads messages of other people, so it starts as a session of untrusted input: no user
// settings, only the AW MCP server, read-only tools in the knowledge folder, and no prompt.
import { ClaudeAdapter, UNTRUSTED_MCP_TOOLS } from "@aw/agent-claude";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Logger } from "../log.ts";
import { SessionTokens } from "../mcp/tokens.ts";
import type { SessionTools } from "../sessions/manager.ts";
import { sessionPaths } from "../sessions/records.ts";
import type { Settings } from "../settings.ts";
import { TriageSession } from "./triage.ts";

let home: string | null = null;
afterEach(async () => {
  if (home) await rm(home, { recursive: true, force: true });
  home = null;
});

const log = { info() {}, warn() {}, error() {}, child: () => log } as unknown as Logger;

describe("Triage session launch", () => {
  it("starts with the untrusted launch, the AW MCP server only, and reads only knowledge", async () => {
    home = await mkdtemp(join(tmpdir(), "aw-triage-"));
    const opened: { command: string[] }[] = [];
    const tools = {
      host: {
        open: (o: { command: string[] }) => {
          opened.push(o);
          return Promise.resolve({
            host: "tmux",
            window: "aw-triage",
            pane: "%1",
            pid: 1,
            pgid: 1,
          });
        },
        alive: () => Promise.resolve(false),
      },
      adapter: new ClaudeAdapter({ binary: "/usr/bin/claude" }),
      agent: { covered: true },
      pluginDir: "/opt/aw/plugin",
      awLaunch: "/opt/aw/bin/aw-launch",
    } as unknown as SessionTools;
    const knowledge = join(home, "AW", "Personal", "knowledge");
    const settings = {
      home,
      userHome: home,
      socketPath: join(home, "run", "awd.sock"),
      sessions: { claude: "/usr/bin/claude", path: "/usr/bin", claudeConfigEnv: null },
    } as unknown as Settings;
    const triage = new TriageSession({
      settings,
      log,
      tools: () => Promise.resolve(tools),
      tokens: new SessionTokens(home),
      workspace: "ws-1",
      stateDir: join(home, "inbox", "ws-1"),
      knowledgeDir: knowledge,
      session: "01a20400-0000-7000-8000-00000000aa01",
      model: "haiku",
      instruction: "",
    });
    await triage.send("[AW triage batch b1] 2 new messages.");

    const paths = sessionPaths(home, triage.id);
    const launch = JSON.parse(await readFile(paths.launch, "utf8")) as { args: string[] };
    const value = (flag: string) => launch.args[launch.args.indexOf(flag) + 1];
    expect(value("--permission-mode")).toBe("dontAsk");
    expect(launch.args).toContain("--strict-mcp-config");
    expect(launch.args).not.toContain("--plugin-dir");
    expect(launch.args).not.toContain("--add-dir");

    const mcp = JSON.parse(await readFile(value("--mcp-config")!, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(mcp.mcpServers)).toEqual(["aw"]);

    const allow = (
      JSON.parse(await readFile(paths.settings, "utf8")) as { permissions: { allow: string[] } }
    ).permissions.allow;
    // No bare Read: a read outside the knowledge folder is refused.
    expect(allow).toEqual([UNTRUSTED_MCP_TOOLS, `Read(/${knowledge}/**)`]);
    expect(opened).toHaveLength(1);
  });
});
