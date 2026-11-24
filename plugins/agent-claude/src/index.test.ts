// Contract tests of the AW plugin and the Claude adapter (docs/engineering-rules.md 7.1.6): the
// manifest name and the allow rule, the skill size, the hooks, the recorded help, version, auth and
// hook payloads of Claude Code 2.1.330, and the trust entry.
import { execa } from "execa";
import { readFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_TOOLS,
  ClaudeAdapter,
  hookOutput,
  hookSessionId,
  isCoveredVersion,
  launchArgv,
  packageName,
  parseAuthStatus,
  parseHook,
  parseStatusLine,
  parseVersion,
  permissionFlag,
  PLUGIN_DIR,
  sessionSettings,
  toolGate,
  transcriptPath,
  trustWorktree,
} from "./index.ts";
import { capturedPayloads, payload } from "./testing/index.ts";

const fixture = (name: string) => readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const plugin = (path: string) => readFile(join(PLUGIN_DIR, path), "utf8");

const launch = {
  sessionId: "0193a7d1-0000-7000-8000-000000000001",
  name: "AW-7",
  pluginDir: "/opt/aw/plugin",
  settingsFile: "/opt/aw/settings.json",
  permissionMode: "default",
  model: null,
};

describe("@aw/agent-claude plugin directory", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@aw/agent-claude");
  });

  it("names the plugin aw, and the allow rule of aw-launch matches the name", async () => {
    const manifest = JSON.parse(await plugin(".claude-plugin/plugin.json")) as { name: string };
    expect(manifest.name).toBe("aw");
    expect(ALLOWED_TOOLS).toContain(`mcp__plugin_${manifest.name}_aw__*`);
    expect(ALLOWED_TOOLS).toContain("Bash(aw ask *)");
    expect(ALLOWED_TOOLS).toContain("Bash(aw thread *)");
    // Only the agent commands: a rule for the whole CLI lets the agent answer its own gates.
    expect(ALLOWED_TOOLS).not.toContain("Bash(aw *)");
    // Of the gate and task groups, only the agent subcommands: never `aw gate answer` or
    // `aw task assign` (the work loop, add-task-loop).
    expect(ALLOWED_TOOLS.filter((r) => /^Bash\(aw (gate|task|session|service)/.test(r))).toEqual([
      "Bash(aw gate open *)",
      "Bash(aw task create *)",
    ]);
  });

  it("registers the MCP server aw in .mcp.json, so the tools match the allow rule", async () => {
    const manifest = JSON.parse(await plugin(".claude-plugin/plugin.json")) as { name: string };
    const config = JSON.parse(await plugin(".mcp.json")) as {
      mcpServers: Record<string, { type: string; url: string; headers: Record<string, string> }>;
    };
    expect(Object.keys(config.mcpServers)).toEqual(["aw"]);
    const [server] = Object.keys(config.mcpServers);
    // Claude Code names the tools mcp__plugin_<plugin>_<server>__<tool>.
    expect(ALLOWED_TOOLS).toContain(`mcp__plugin_${manifest.name}_${server}__*`);
    expect(config.mcpServers.aw).toEqual({
      type: "http",
      url: "${AW_MCP_URL:-http://aw-mcp-url-not-set.invalid/mcp}",
      headers: { Authorization: "Bearer ${AW_MCP_TOKEN:-none}" },
    });
  });

  it("keeps each SKILL.md below 6,000 characters", async () => {
    const text = await plugin("skills/aw/SKILL.md");
    expect(text.length).toBeLessThan(6000);
    expect(text).toMatch(/^---\nname: aw\n/);
  });

  it("allows the knowledge commands of an agent, never the person commands (agent-learning)", () => {
    expect(ALLOWED_TOOLS.filter((r) => /^Bash\(aw (kb|learn)\b/.test(r))).toEqual([
      "Bash(aw learn *)",
      "Bash(aw kb write *)",
      "Bash(aw kb search *)",
      "Bash(aw kb show *)",
      "Bash(aw kb list *)",
      "Bash(aw kb context *)",
    ]);
  });

  it("tells the agent to search the knowledge first and to learn or record nothing new before done", async () => {
    const text = await plugin("skills/aw/SKILL.md");
    expect(text).toMatch(
      /Search the knowledge first\..*`aw:\/\/knowledge`.*`aw kb search <terms>`/,
    );
    expect(text).toMatch(/Before `done`, record what you learned: `learn`.*`nothing_new: true`/);
    expect(text).toContain("`aw learn <TASK> --nothing-new`");
  });

  it("tells the agent to send its updates through AW (agent-pushes-updates)", async () => {
    const text = await plugin("skills/aw/SKILL.md");
    expect(text).toContain("Your text output goes only to the Session log.");
    expect(text).toMatch(/End EACH turn with one AW call: `ask`.*`message`.*`done`\./);
    expect(text).toContain("`[AW notice <id>] Your turn ended with no AW update` means");
  });

  it("tells the agent to put the decision context in the question (gate-context)", async () => {
    const text = await plugin("skills/aw/SKILL.md");
    expect(text).toContain("`details`");
    expect(text).toContain("--details-file");
    expect(text).toMatch(/never .*see the message above/i);
  });

  it("tells the agent to commit and that AW pushes the task branch (move-paused-task)", async () => {
    const text = await plugin("skills/aw/SKILL.md");
    expect(text).toContain(
      "Commit your work on the task branch of this worktree. AW pushes the branch to `origin` at each turn end. Do not push it yourself.",
    );
  });

  it("has a command hook for each event, and the permission hook waits more than 120 s", async () => {
    const config = JSON.parse(await plugin("hooks/hooks.json")) as {
      hooks: Record<string, { hooks: { type: string; command: string; timeout: number }[] }[]>;
    };
    const events = Object.keys(config.hooks).sort();
    expect(events).toEqual(
      [
        "Notification",
        "PermissionRequest",
        "PostToolUse",
        "PreToolUse",
        "SessionEnd",
        "SessionStart",
        "Stop",
        "StopFailure",
        "UserPromptSubmit",
      ].sort(),
    );
    for (const event of events) {
      const hook = config.hooks[event]![0]!.hooks[0]!;
      expect(hook.type).toBe("command");
      expect(hook.command).toBe(`"\${CLAUDE_PLUGIN_ROOT}/bin/aw-hook" ${event}`);
    }
    expect(config.hooks.PermissionRequest![0]!.hooks[0]!.timeout).toBeGreaterThan(120);
    for (const bin of ["bin/aw", "bin/aw-hook"]) {
      expect((await stat(join(PLUGIN_DIR, bin))).mode & 0o111).not.toBe(0);
    }
  });
});

describe("Claude adapter", () => {
  it("uses only flags that the recorded help of 2.1.330 lists", async () => {
    const help = await fixture("help-2.1.330.txt");
    const argv = launchArgv({ ...launch, mode: "new", model: "haiku" }, "hello");
    for (const flag of argv.filter((a) => /^-{1,2}[a-zA-Z]/.test(a))) {
      expect(help, flag).toMatch(new RegExp(`(^|[ ,])${flag}[ ,]`, "m"));
    }
  });

  it("keeps the flags on resume and puts the message last, after --", () => {
    const first = launchArgv({ ...launch, mode: "new" }, "first message");
    const resume = launchArgv({ ...launch, mode: "resume" }, "[AW resume] continue");
    expect(first.slice(0, 2)).toEqual(["--session-id", launch.sessionId]);
    expect(resume.slice(0, 2)).toEqual(["--resume", launch.sessionId]);
    expect(resume.slice(2, -2)).toEqual(first.slice(2, -2));
    expect(resume.slice(-2)).toEqual(["--", "[AW resume] continue"]);
  });

  it("maps the AW permission modes to the --permission-mode values (session-options)", () => {
    // The values of the CLI reference (code.claude.com/docs/en/cli-reference, 2026-11-24); the
    // spike ran bypassPermissions on 2.1.330 and 2.1.331 (evidence session-options/spike).
    expect(["default", "accept_edits", "skip"].map(permissionFlag)).toEqual([
      "default",
      "acceptEdits",
      "bypassPermissions",
    ]);
    // An unknown or old value never gives a mode with fewer gates.
    expect(permissionFlag("plan")).toBe("default");
    expect(permissionFlag("bypassPermissions")).toBe("default");
    const argv = launchArgv({ ...launch, mode: "new", permissionMode: "skip" }, "hello");
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
  });

  it("writes the session settings of each option (session-options)", () => {
    const input = {
      permissionMode: "default",
      agentTeams: false,
      personCommands: ["gate answer", "task assign"],
      statusLine: '"/opt/aw/plugin/bin/aw-statusline"',
    };
    const plain = JSON.parse(sessionSettings(input)) as Record<string, unknown>;
    expect(plain).toEqual({
      permissions: {
        allow: ALLOWED_TOOLS,
        deny: [
          "Bash(aw gate answer)",
          "Bash(aw gate answer *)",
          "Bash(aw task assign)",
          "Bash(aw task assign *)",
        ],
      },
      statusLine: { type: "command", command: input.statusLine, padding: 0 },
    });
    const skip = JSON.parse(
      sessionSettings({ ...input, permissionMode: "skip", agentTeams: true, statusLine: null }),
    ) as Record<string, unknown>;
    expect(skip.skipDangerousModePermissionPrompt).toBe(true);
    expect(skip.env).toEqual({ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" });
    expect(skip.teammateMode).toBe("in-process");
    expect(skip.statusLine).toBeUndefined();
    const edits = JSON.parse(
      sessionSettings({ ...input, permissionMode: "accept_edits" }),
    ) as Record<string, unknown>;
    expect(edits.skipDangerousModePermissionPrompt).toBeUndefined();
  });

  it("reads the version and the covered range", async () => {
    const auth = JSON.parse(await fixture("auth-status-2.1.330.json")) as {
      output: unknown;
      version_output: string;
    };
    expect(parseVersion(auth.version_output)).toBe("2.1.330");
    expect(isCoveredVersion("2.1.330")).toBe(true);
    expect(isCoveredVersion("2.1.318")).toBe(false);
    expect(isCoveredVersion("2.2.0")).toBe(false);
    expect(isCoveredVersion(null)).toBe(false);
  });

  it("keeps only the sign-in fields of auth status, never the account values", async () => {
    const auth = JSON.parse(await fixture("auth-status-2.1.330.json")) as { output: unknown };
    const status = parseAuthStatus(JSON.stringify(auth.output));
    expect(status).toEqual({
      loggedIn: true,
      method: "claude.ai",
      expiresAt: "2026-11-25T13:35:11.530Z",
    });
    expect(JSON.stringify(status)).not.toContain("example.com");
    expect(parseAuthStatus("not json")).toEqual({ loggedIn: false, method: null, expiresAt: null });
  });

  it("reads the session id of each captured hook payload", () => {
    for (const value of Object.values(capturedPayloads)) {
      expect(hookSessionId(value)).toBe("0193a7d1-0000-7000-8000-000000000001");
    }
    expect(hookSessionId({})).toBeNull();
    expect(hookSessionId("not an object")).toBeNull();
  });

  it("parses each captured hook payload", () => {
    const kinds = Object.fromEntries(
      Object.entries(capturedPayloads).map(([key, value]) => [
        key,
        parseHook(key.split(".")[0]!, value).kind,
      ]),
    );
    expect(kinds).toEqual({
      "SessionStart.startup": "session_start",
      "SessionStart.resume": "session_start",
      UserPromptSubmit: "prompt",
      "UserPromptSubmit.answer": "prompt",
      "UserPromptSubmit.resume": "prompt",
      "PreToolUse.Skill": "tool_start",
      "PreToolUse.Bash": "tool_start",
      "PreToolUse.Write": "tool_start",
      "PreToolUse.AskUserQuestion": "tool_start",
      PostToolUse: "tool_end",
      "PermissionRequest.Bash": "permission",
      "PermissionRequest.Write": "permission",
      Notification: "notification",
      Stop: "stop",
      SessionEnd: "session_end",
    });
    expect(parseHook("Notification", capturedPayloads.Notification)).toEqual({
      kind: "notification",
      type: "permission_prompt",
      message: "Claude needs your permission",
    });
    expect(parseHook("SessionStart", capturedPayloads["SessionStart.resume"])).toMatchObject({
      source: "resume",
    });
    const answer = parseHook("UserPromptSubmit", capturedPayloads["UserPromptSubmit.answer"]);
    expect(answer).toMatchObject({ kind: "prompt" });
    expect((answer as { text: string }).text).toMatch(/^\[AW answer q-1\] /);
    expect(parseHook("Bogus", {})).toEqual({ kind: "other", event: "Bogus" });
    // The real AskUserQuestion payload of the run on 2026-11-23 becomes a question gate.
    expect(parseHook("PreToolUse", capturedPayloads["PreToolUse.AskUserQuestion"])).toMatchObject({
      kind: "tool_start",
      tool: "AskUserQuestion",
      gate: { kind: "question", title: "Which color?", options: ["red", "blue"] },
    });
  });

  it("keeps the header, multiSelect and each description of AskUserQuestion (gate-context)", () => {
    // The captured PreToolUse of Claude Code 2.1.330 (fixtures/hooks-2.1.330.json).
    const captured = parseHook("PreToolUse", capturedPayloads["PreToolUse.AskUserQuestion"]);
    expect((captured as { gate: unknown }).gate).toEqual({
      kind: "question",
      title: "Which color?",
      text: "Which color?\nOptions: red | blue",
      options: ["red", "blue"],
      questions: [
        {
          question: "Which color?",
          header: "Color",
          multi_select: false,
          options: [
            { label: "red", description: "Use red" },
            { label: "blue", description: "Use blue" },
          ],
        },
      ],
    });
    // 2 questions in the shape of that capture, the second a multiSelect: no one-click options.
    const two = toolGate("AskUserQuestion", {
      questions: [
        {
          question: "Which queue library do we use?",
          header: "Library",
          multiSelect: false,
          options: [
            { label: "Library A", description: "Same process" },
            { label: "Library B", description: "A separate service" },
          ],
        },
        {
          question: "Which checks must run?",
          header: "Checks",
          multiSelect: true,
          options: [
            { label: "Unit tests", description: "Vitest" },
            { label: "E2E", description: "Docker" },
          ],
        },
      ],
    });
    expect(two).toMatchObject({
      kind: "question",
      title: "Which queue library do we use?",
      options: [],
    });
    const questions = (two as { questions: { header: string; multi_select: boolean }[] }).questions;
    expect(questions.map((q) => [q.header, q.multi_select])).toEqual([
      ["Library", false],
      ["Checks", true],
    ]);
    expect(JSON.stringify(questions)).toContain('"description":"A separate service"');
    // The text is the listing that the cards hide (contracts/fixtures/gates/context.json).
    const listing = (
      JSON.parse(
        readFileSync(
          fileURLToPath(new URL("../../../contracts/fixtures/gates/context.json", import.meta.url)),
          "utf8",
        ),
      ) as { body: { name: string; text: string; questions: unknown[] }[] }
    ).body.find((b) => b.name === "AskUserQuestion listing")!;
    expect((two as { text: string }).text).toBe(listing.text);
    expect(
      toolGate("AskUserQuestion", {
        questions: (
          listing.questions as {
            question: string;
            header: string;
            multi_select: boolean;
            options: unknown[];
          }[]
        ).map((q) => ({
          question: q.question,
          header: q.header,
          multiSelect: q.multi_select,
          options: q.options,
        })),
      }),
    ).toMatchObject({ text: listing.text });
    // One multiSelect question: the card lists it with choices, so no one-click options either.
    expect(
      toolGate("AskUserQuestion", {
        questions: [
          { question: "Which?", multiSelect: true, options: [{ label: "a" }, { label: "b" }] },
        ],
      }),
    ).toMatchObject({ options: [] });
  });

  it("names the teammate of a tool event", () => {
    // A teammate PreToolUse of Claude Code 2.1.331 (spike S3 of session-options, 2026-11-24, agent
    // teams in-process); the session and tool ids are replaced.
    const teammate = {
      session_id: "00000000-0000-4000-8000-000000000001",
      permission_mode: "bypassPermissions",
      agent_id: "ahelper-204629dffab38048",
      agent_type: "helper",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "echo teammate-hello", description: "Print teammate-hello" },
      tool_use_id: "toolu_01",
    };
    expect(parseHook("PreToolUse", teammate)).toMatchObject({
      kind: "tool_start",
      tool: "Bash",
      agent: "ahelper-204629dffab38048",
    });
    expect(parseHook("PreToolUse", capturedPayloads["PreToolUse.Bash"])).toMatchObject({
      agent: null,
    });
  });

  it("makes gates of AskUserQuestion and ExitPlanMode", () => {
    expect(
      toolGate("AskUserQuestion", {
        questions: [
          { question: "Which limit?", options: [{ label: "100/min" }, { label: "1000/min" }] },
        ],
      }),
    ).toEqual({
      kind: "question",
      title: "Which limit?",
      text: "Which limit?\nOptions: 100/min | 1000/min",
      options: ["100/min", "1000/min"],
      questions: [
        {
          question: "Which limit?",
          header: null,
          multi_select: false,
          options: [
            { label: "100/min", description: "" },
            { label: "1000/min", description: "" },
          ],
        },
      ],
    });
    // The full question is the title: awd redacts it before its 500-character cut (fix list 0-41).
    const long = `${"q".repeat(495)}stg_live_9f8e7d6c5b4a?`;
    expect(toolGate("AskUserQuestion", { questions: [{ question: long }] })).toMatchObject({
      title: long,
    });
    expect(toolGate("ExitPlanMode", { plan: "1. Do it" })).toEqual({
      kind: "confirm_approach",
      title: "Confirm approach",
      plan: "1. Do it",
    });
    expect(toolGate("Bash", { command: "ls" })).toBeNull();
  });

  it("writes the hook answers in the format of Claude Code", () => {
    expect(JSON.parse(hookOutput("SessionStart", { context: "x".repeat(12_000) })!)).toMatchObject({
      hookSpecificOutput: { hookEventName: "SessionStart" },
    });
    expect(
      (
        JSON.parse(hookOutput("SessionStart", { context: "x".repeat(12_000) })!) as {
          hookSpecificOutput: { additionalContext: string };
        }
      ).hookSpecificOutput.additionalContext.length,
    ).toBe(10_000);
    expect(JSON.parse(hookOutput("PreToolUse", { deny: "gate g" })!)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "gate g",
      },
    });
    expect(
      JSON.parse(
        hookOutput("PermissionRequest", {
          permission: { behavior: "deny", message: "no", interrupt: true },
        })!,
      ),
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message: "no", interrupt: true },
      },
    });
    expect(hookOutput("Stop", { deny: "x" })).toBeNull();
  });

  it("builds the transcript path of Claude Code", () => {
    expect(transcriptPath("/c", "/work/my.repo", "s1")).toBe("/c/projects/-work-my-repo/s1.jsonl");
  });

  it("finds a conversation only when its transcript exists, also under the real path", async () => {
    const root = await mkdtemp(join(tmpdir(), "awc-"));
    try {
      const config = join(root, ".claude");
      const real = join(root, "real");
      const link = join(root, "link");
      await mkdir(real);
      await symlink(real, link);
      const adapter = new ClaudeAdapter({ binary: "claude", configDir: config });
      const input = { sessionId: "s1", cwd: link };
      expect(await adapter.hasConversation(input)).toBe(false);
      // Claude Code names the folder after the working folder as the process sees it.
      const transcript = transcriptPath(config, await realpath(link), "s1");
      await mkdir(dirname(transcript), { recursive: true });
      await writeFile(transcript, "{}\n");
      expect(await adapter.hasConversation(input)).toBe(true);
      await expect(
        new ClaudeAdapter({ binary: "claude" }).hasConversation(input),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("gives the fake agent payloads with the captured fields", () => {
    const value = payload(
      "PreToolUse.Write",
      { session_id: "s", transcript_path: "t", cwd: "/w", permission_mode: "default" },
      { tool_name: "Write", tool_input: { file_path: "/w/a" } },
    );
    expect(Object.keys(value).sort()).toEqual(
      Object.keys(capturedPayloads["PreToolUse.Write"]!).sort(),
    );
    expect(value).toMatchObject({ session_id: "s", hook_event_name: "PreToolUse" });
  });
});

describe("fake agent", () => {
  it("refuses --resume of a session with no transcript, like claude", async () => {
    const home = await mkdtemp(join(tmpdir(), "awf-"));
    const result = await execa(
      process.execPath,
      [
        fileURLToPath(new URL("./testing/fake-claude.ts", import.meta.url)),
        "--resume",
        "0193a7d1-0000-7000-8000-000000000009",
      ],
      { env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: "" }, reject: false, cwd: home },
    );
    expect(result.exitCode).toBe(1);
    expect(String(result.stdout)).toContain(
      "No conversation found with session ID: 0193a7d1-0000-7000-8000-000000000009",
    );
    await rm(home, { recursive: true, force: true });
  });
});

describe("continuity (add-continuity)", () => {
  const fake = fileURLToPath(new URL("./testing/fake-claude.ts", import.meta.url));

  it("refuses --session-id of a session that has a transcript, like claude", async () => {
    const home = await mkdtemp(join(tmpdir(), "awf-"));
    try {
      const id = "0193a7d1-0000-7000-8000-000000000009";
      const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: "" };
      const path = transcriptPath(join(home, ".claude"), await realpath(home), id);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "{}\n");
      const result = await execa(process.execPath, [fake, "--session-id", id], {
        env,
        reject: false,
        cwd: home,
      });
      expect(result.exitCode).toBe(1);
      expect(String(result.stdout)).toContain(`Session ID ${id} is already in use`);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("answers auth status --json, logged in or out", async () => {
    const run = (extra: Record<string, string>) =>
      execa(process.execPath, [fake, "auth", "status", "--json"], {
        env: { ...process.env, ...extra },
        reject: false,
      });
    expect(parseAuthStatus(String((await run({})).stdout)).loggedIn).toBe(true);
    const out = await run({ FAKE_CLAUDE_LOGGED_OUT: "1" });
    expect(parseAuthStatus(String(out.stdout)).loggedIn).toBe(false);
  });

  it("reads the usage windows of the statusline (resets_at in Unix seconds)", () => {
    expect(
      parseStatusLine({
        model: { id: "x" },
        rate_limits: {
          five_hour: { used_percentage: 100, resets_at: 1795442400 },
          seven_day: { used_percentage: 41.5, resets_at: 1795788000 },
        },
      }),
    ).toEqual({
      five_hour: { used_percentage: 100, resets_at: 1795442400_000 },
      seven_day: { used_percentage: 41.5, resets_at: 1795788000_000 },
    });
    expect(parseStatusLine({ model: { id: "x" } })).toBeNull();
    expect(parseStatusLine({ rate_limits: { five_hour: { used_percentage: "a" } } })).toBeNull();
    expect(new ClaudeAdapter({ binary: "claude" }).parseStatusLine({})).toBeNull();
  });

  it("has the statusline command in the plugin bin folder", async () => {
    expect((await stat(join(PLUGIN_DIR, "bin", "aw-statusline"))).mode & 0o111).not.toBe(0);
  });
});

describe("trust entry", () => {
  it("changes only the entry of the worktree, and the backup has the old bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "awc-"));
    const stateFile = join(dir, ".claude.json");
    const old = `${JSON.stringify(
      {
        numStartups: 3,
        projects: {
          "/other": { hasTrustDialogAccepted: true, lastCost: 1 },
          "/wt": { lastCost: 2 },
        },
      },
      null,
      2,
    )}\n`;
    await writeFile(stateFile, old);
    const result = await trustWorktree({
      stateFile,
      path: "/wt",
      backupDir: join(dir, "backups"),
      stamp: "20261123",
    });
    expect(result.changed).toBe(true);
    expect(await readFile(result.backup!, "utf8")).toBe(old);
    expect((await stat(result.backup!)).mode & 0o777).toBe(0o600);
    const now = JSON.parse(await readFile(stateFile, "utf8")) as Record<string, unknown>;
    const before = JSON.parse(old) as { projects: Record<string, Record<string, unknown>> };
    before.projects["/wt"]!.hasTrustDialogAccepted = true;
    expect(now).toEqual(before);
    const again = await trustWorktree({
      stateFile,
      path: "/wt",
      backupDir: join(dir, "backups"),
      stamp: "20261124",
    });
    expect(again).toEqual({ changed: false, backup: null });
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps each entry when sessions start at the same time in one process (ssc-1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "awc-"));
    const stateFile = join(dir, ".claude.json");
    await writeFile(stateFile, '{"numStartups":1,"projects":{}}\n');
    const paths = Array.from({ length: 12 }, (_, i) => `/wt${i}`);
    const results = await Promise.allSettled(
      paths.map((path, i) =>
        trustWorktree({ stateFile, path, backupDir: join(dir, "backups"), stamp: `2026112${i}` }),
      ),
    );
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    const state = JSON.parse(await readFile(stateFile, "utf8")) as {
      numStartups: number;
      projects: Record<string, { hasTrustDialogAccepted?: boolean }>;
    };
    expect(state.numStartups).toBe(1);
    for (const path of paths) expect(state.projects[path]?.hasTrustDialogAccepted, path).toBe(true);
    expect((await readdir(dir)).filter((n) => n.includes(".tmp"))).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the target of a symlinked state file, and keeps only the last 5 backups", async () => {
    const dir = await mkdtemp(join(tmpdir(), "awc-"));
    await mkdir(join(dir, "dotfiles"));
    const target = join(dir, "dotfiles", "claude.json");
    const stateFile = join(dir, ".claude.json");
    await writeFile(target, '{"projects":{}}\n');
    await symlink(target, stateFile);
    const backupDir = join(dir, "backups");
    for (let i = 0; i < 7; i++) {
      await trustWorktree({ stateFile, path: `/wt${i}`, backupDir, stamp: `2026112${i}` });
    }
    expect((await lstat(stateFile)).isSymbolicLink()).toBe(true);
    const state = JSON.parse(await readFile(target, "utf8")) as {
      projects: Record<string, unknown>;
    };
    expect(Object.keys(state.projects)).toHaveLength(7);
    expect((await readdir(backupDir)).sort()).toEqual(
      [2, 3, 4, 5, 6].map((i) => `claude-2026112${i}.json`),
    );
    await rm(dir, { recursive: true, force: true });
  });
});
