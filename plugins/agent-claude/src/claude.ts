// The Claude Code adapter (docs/architecture.md 4.5, 6.2). It is the only module that knows the
// Claude Code CLI: its flags, its hook payloads and its state file. It never reads a credential
// (docs/engineering-rules.md 6.2): only `claude --version`, `claude auth status --json` and hooks.
import type {
  AgentHookEvent,
  AgentInfo,
  AgentRuntimeAdapter,
  AuthStatus,
  LaunchInput,
  PermissionDecision,
  SessionSettingsInput,
  ToolGate,
  ToolQuestion,
  TrustInput,
  UsageSignal,
  UsageWindowSignal,
} from "@aw/plugin-api";
import { execa } from "execa";
import { access, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { trustWorktree } from "./trust.ts";

/** The plugin name in `.claude-plugin/plugin.json`. The MCP tools are `mcp__plugin_aw_aw__*`. */
export const PLUGIN_NAME = "aw";
/** The AW plugin directory that `--plugin-dir` names. */
export const PLUGIN_DIR = fileURLToPath(new URL("../plugin", import.meta.url));
/**
 * The `aw` commands of an agent (docs/workflow.md 8). Only these run with no permission prompt.
 * A human command (`aw gate answer`, `aw task assign`, ...) asks the human, so an agent can never
 * answer its own gate or move its own task (principle 4).
 */
export const AGENT_COMMANDS = [
  "ask",
  "message",
  "stage",
  "artifact add",
  "handoff",
  "thread",
  // The work loop (add-task-loop).
  "approach",
  "ready",
  "result",
  "done",
  "gate open",
  "task create",
  // Test slots (add-continuity).
  "slot acquire",
  "slot release",
  // Knowledge (agent-learning): the learning step, an agent edit of a project file, and the reads.
  // awd refuses an agent write to shared knowledge or a rule; `kb accept|reject` stay a person's.
  "learn",
  "kb write",
  "kb search",
  "kb show",
  "kb list",
  "kb context",
];
/** The allow rules of each session (docs/phase-1.md 9.1.5). */
export const ALLOWED_TOOLS = [
  ...AGENT_COMMANDS.map((command) => `Bash(aw ${command} *)`),
  `mcp__plugin_${PLUGIN_NAME}_aw__*`,
];
/** The lowest covered patch of Claude Code 2.1 (docs/tech-stack.md 1.1: 2.1.319 or later). */
export const COVERED_PATCH_FROM = 319;
/** The longest SessionStart context (docs/phase-1.md 9.2.2). */
export const MAX_CONTEXT_CHARS = 10_000;

/** True when the contract tests cover the version (the trust entry and the hook payloads). */
export function isCoveredVersion(version: string | null): boolean {
  const match = /^2\.1\.(\d+)$/.exec(version ?? "");
  return match !== null && Number(match[1]) >= COVERED_PATCH_FROM;
}

/** The version from `claude --version`, for example "2.1.330 (Claude Code)". */
export function parseVersion(text: string): string | null {
  return /^\s*(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? null;
}

/** The sign-in state from `claude auth status --json`. Only these 3 fields are kept. */
export function parseAuthStatus(text: string): AuthStatus {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    return {
      loggedIn: value.loggedIn === true,
      method: typeof value.authMethod === "string" ? value.authMethod : null,
      expiresAt: typeof value.loginExpiresAt === "string" ? value.loginExpiresAt : null,
    };
  } catch {
    return { loggedIn: false, method: null, expiresAt: null };
  }
}

/** The transcript file of a session: `<config>/projects/<cwd with - for each other char>/<id>.jsonl`. */
export function transcriptPath(configDir: string, cwd: string, sessionId: string): string {
  return `${configDir}/projects/${cwd.replace(/[^A-Za-z0-9]/g, "-")}/${sessionId}.jsonl`;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The gate of a tool call that asks the human: AskUserQuestion or ExitPlanMode. */
export function toolGate(tool: string, input: Record<string, unknown>): ToolGate | null {
  if (tool === "AskUserQuestion") {
    const raw = Array.isArray(input.questions) ? input.questions.map(record) : [];
    // Each question with its header, multiSelect and option descriptions (openspec gate-context).
    // The field names are those of the PreToolUse capture of Claude Code 2.1.330.
    const questions: ToolQuestion[] = raw
      .map((q) => ({
        question: text(q.question),
        header: text(q.header) || null,
        multi_select: q.multiSelect === true,
        options: (Array.isArray(q.options) ? q.options : [])
          .map((o) =>
            typeof o === "string"
              ? { label: o, description: "" }
              : { label: text(record(o).label), description: text(record(o).description) },
          )
          .filter((o) => o.label.length > 0),
      }))
      .filter((q) => q.question.length > 0);
    const first = questions[0];
    // One-click buttons only for one single-choice question; else the card lists the questions.
    const options =
      questions.length === 1 && first && !first.multi_select
        ? first.options.map((o) => o.label)
        : [];
    const body = questions
      .map((q) =>
        q.options.length > 0
          ? `${q.question}\nOptions: ${q.options.map((o) => o.label).join(" | ")}`
          : q.question,
      )
      .join("\n\n");
    const title = first?.question || text(input.question) || "Question from the agent";
    // The full title: awd redacts it before its 500-character cut (fix list 0-41).
    return { kind: "question", title, text: body || title, options, questions };
  }
  if (tool === "ExitPlanMode") {
    return { kind: "confirm_approach", title: "Confirm approach", plan: text(input.plan) };
  }
  return null;
}

/** Parses one hook payload of Claude Code (fields of the capture of 2026-11-22, version 2.1.330). */
export function parseHook(event: string, payload: unknown): AgentHookEvent {
  const p = record(payload);
  switch (event) {
    case "SessionStart":
      return {
        kind: "session_start",
        source: text(p.source) || "startup",
        sessionId: text(p.session_id) || null,
        transcript: text(p.transcript_path) || null,
      };
    case "UserPromptSubmit":
      return { kind: "prompt", text: text(p.prompt) };
    case "PreToolUse": {
      const tool = text(p.tool_name);
      const input = record(p.tool_input);
      return {
        kind: "tool_start",
        tool,
        input,
        toolUseId: text(p.tool_use_id) || null,
        gate: toolGate(tool, input),
        // A teammate of agent teams or a subagent: its tool events carry `agent_id` (spike S3).
        agent: text(p.agent_id) || null,
      };
    }
    case "PostToolUse":
      return { kind: "tool_end", tool: text(p.tool_name), toolUseId: text(p.tool_use_id) || null };
    case "PermissionRequest":
      return { kind: "permission", tool: text(p.tool_name), input: record(p.tool_input) };
    case "Notification":
      return { kind: "notification", type: text(p.notification_type), message: text(p.message) };
    case "Stop":
      return { kind: "stop", text: text(p.last_assistant_message) };
    case "StopFailure":
      return {
        kind: "stop_failure",
        error: text(p.error) || text(p.error_type) || text(p.reason) || "unknown",
      };
    case "SessionEnd":
      return { kind: "session_end", reason: text(p.reason) || "other" };
    default:
      return { kind: "other", event };
  }
}

function usageWindow(value: unknown): UsageWindowSignal | null {
  const w = record(value);
  const used = w.used_percentage;
  if (typeof used !== "number" || !Number.isFinite(used)) return null;
  const reset = w.resets_at;
  return {
    used_percentage: Math.max(0, Math.min(100, used)),
    // Unix seconds in the statusline JSON (docs/feasibility-details.md); a text date also works.
    resets_at:
      typeof reset === "number" && Number.isFinite(reset)
        ? reset * 1000
        : typeof reset === "string" && Number.isFinite(Date.parse(reset))
          ? Date.parse(reset)
          : null,
  };
}

/**
 * The usage windows of a statusline input (`rate_limits.five_hour` and `rate_limits.seven_day`),
 * or null when it has none: an API login, or before the first answer of the model.
 */
export function parseStatusLine(payload: unknown): UsageSignal | null {
  const limits = record(record(payload).rate_limits);
  const five = usageWindow(limits.five_hour);
  const week = usageWindow(limits.seven_day);
  return five === null && week === null ? null : { five_hour: five, seven_day: week };
}

/** The stdout JSON of a hook that answers Claude Code, or null for a hook with no answer. */
export function hookOutput(
  event: string,
  reply: { context: string } | { deny: string } | { permission: PermissionDecision },
): string | null {
  if (event === "SessionStart" && "context" in reply) {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: reply.context.slice(0, MAX_CONTEXT_CHARS),
      },
    });
  }
  if (event === "PreToolUse" && "deny" in reply) {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reply.deny,
      },
    });
  }
  if (event === "PermissionRequest" && "permission" in reply) {
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: reply.permission },
    });
  }
  return null;
}

/**
 * The `--permission-mode` value of an AW mode (openspec session-options). An unknown value (a
 * record of an older awd) is `default`: AW never turns on a mode with fewer gates by mistake.
 */
export function permissionFlag(mode: string): string {
  if (mode === "accept_edits") return "acceptEdits";
  if (mode === "skip") return "bypassPermissions";
  return "default";
}

/**
 * The session settings file (docs/phase-1.md 9.1.3, openspec session-options): the allow rules of
 * the agent commands, the deny rules of the person commands (Claude Code applies a deny rule in
 * each mode, also in bypassPermissions), the status line, and the settings of the options. A skip
 * session gets `skipDangerousModePermissionPrompt`: else the warning dialog of bypass mode blocks
 * the start (spike S2). The flag settings file holds it, so the user settings do not change.
 */
export function sessionSettings(input: SessionSettingsInput): string {
  const deny = input.personCommands.flatMap((command) => [
    `Bash(aw ${command})`,
    `Bash(aw ${command} *)`,
  ]);
  const settings: Record<string, unknown> = { permissions: { allow: ALLOWED_TOOLS, deny } };
  if (input.statusLine !== null) {
    settings.statusLine = { type: "command", command: input.statusLine, padding: 0 };
  }
  if (permissionFlag(input.permissionMode) === "bypassPermissions") {
    settings.skipDangerousModePermissionPrompt = true;
  }
  if (input.agentTeams) {
    // Agent teams (experimental in Claude Code): the teammates run in the pane of the lead, so the
    // hooks and the terminal snapshot see one pane (spike S3).
    settings.env = { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" };
    settings.teammateMode = "in-process";
  }
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** The arguments before `--` (docs/phase-1.md 9.1.3 and 9.1.4). Resume keeps the other flags. */
export function launchArgs(input: LaunchInput): string[] {
  return [
    input.mode === "new" ? "--session-id" : "--resume",
    input.sessionId,
    "-n",
    input.name,
    "--plugin-dir",
    input.pluginDir,
    "--settings",
    input.settingsFile,
    "--permission-mode",
    permissionFlag(input.permissionMode),
    ...(input.model ? ["--model", input.model] : []),
    "--allowedTools",
    ...ALLOWED_TOOLS,
  ];
}

/** The full argument list: the flags, `--`, then the message as the last argument. */
export function launchArgv(input: LaunchInput, message: string): string[] {
  return [...launchArgs(input), "--", message];
}

export class ClaudeAdapter implements AgentRuntimeAdapter {
  readonly name = "claude";
  readonly binary: string;
  /** The Claude Code config folder (`CLAUDE_CONFIG_DIR`, default `~/.claude`): the transcripts. */
  readonly configDir: string | null;

  constructor(options: { binary: string; configDir?: string | null }) {
    this.binary = options.binary;
    this.configDir = options.configDir ?? null;
  }

  /**
   * True when the transcript of the session exists: `--resume` needs it ("No conversation found"
   * else). Claude Code names the folder after the working folder as the process sees it, so both
   * the path and its real path are checked.
   */
  async hasConversation(input: { sessionId: string; cwd: string }): Promise<boolean> {
    // With no config folder the adapter cannot tell: the caller uses its own record.
    if (this.configDir === null) throw new Error("No Claude Code config folder");
    const cwds = new Set([input.cwd, await realpath(input.cwd).catch(() => input.cwd)]);
    for (const cwd of cwds) {
      const path = transcriptPath(this.configDir, cwd, input.sessionId);
      if (
        await access(path).then(
          () => true,
          () => false,
        )
      )
        return true;
    }
    return false;
  }

  /** The trust entry of a worktree that AW created (only for a covered version, see trust.ts). */
  async trustFolder(input: TrustInput): Promise<void> {
    await trustWorktree(input);
  }

  async detect(): Promise<AgentInfo> {
    const result = await execa(this.binary, ["--version"], { reject: false, timeout: 15_000 });
    const version = parseVersion(String(result.stdout ?? ""));
    const available = result.exitCode === 0 && version !== null;
    return {
      name: this.name,
      available,
      binary: this.binary,
      version,
      covered: isCoveredVersion(version),
      reason: available ? null : `${this.binary} --version failed`,
    };
  }

  async authStatus(): Promise<AuthStatus> {
    const result = await execa(this.binary, ["auth", "status", "--json"], {
      reject: false,
      timeout: 15_000,
    });
    const stdout = String(result.stdout ?? "");
    // No JSON (a timeout, an old version): the state is not known, which is not "logged out".
    try {
      JSON.parse(stdout);
    } catch {
      throw new Error(
        `${this.binary} auth status --json gave no JSON (exit ${result.exitCode ?? "?"})`,
      );
    }
    return parseAuthStatus(stdout);
  }

  parseStatusLine(payload: unknown): UsageSignal | null {
    return parseStatusLine(payload);
  }

  launchArgs(input: LaunchInput): string[] {
    return launchArgs(input);
  }

  sessionSettings(input: SessionSettingsInput): string {
    return sessionSettings(input);
  }

  parseHook(event: string, payload: unknown): AgentHookEvent {
    return parseHook(event, payload);
  }

  hookOutput(
    event: string,
    reply: { context: string } | { deny: string } | { permission: PermissionDecision },
  ): string | null {
    return hookOutput(event, reply);
  }
}
