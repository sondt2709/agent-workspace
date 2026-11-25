// The agent runtime adapter interface (docs/architecture.md 6.2): Claude Code in phase 1.

export interface AgentInfo {
  /** The agent name of an assignee, for example `claude` in `claude@ubuntu-01`. */
  name: string;
  available: boolean;
  /** The binary that awd runs. */
  binary: string;
  /** The version, for example `2.1.330`, or null. */
  version: string | null;
  /** True when the contract tests cover this version. */
  covered: boolean;
  reason: string | null;
}

/** The sign-in state. It never has a token or a credential value. */
export interface AuthStatus {
  loggedIn: boolean;
  /** For example `claude.ai` or `console`, or null. */
  method: string | null;
  /** ISO time, or null. */
  expiresAt: string | null;
}

/** One usage window of the agent login: the percent used and the reset time (ms), or null. */
export interface UsageWindowSignal {
  used_percentage: number;
  resets_at: number | null;
}

/** The usage windows from the statusline of the agent (docs/architecture.md 4.6.6). */
export interface UsageSignal {
  five_hour: UsageWindowSignal | null;
  seven_day: UsageWindowSignal | null;
}

export interface LaunchInput {
  mode: "new" | "resume";
  sessionId: string;
  /** The session name, for example the task key. */
  name: string;
  pluginDir: string;
  settingsFile: string;
  /**
   * The AW permission mode: `default`, `accept_edits` or `skip` (openspec session-options). The
   * adapter maps it to the flag of its agent.
   */
  permissionMode: string;
  model: string | null;
}

/** The input of the session settings file (openspec session-options). */
export interface SessionSettingsInput {
  /** The AW permission mode of the session. */
  permissionMode: string;
  /** Turn on the agent team setting of the agent, with one pane (in-process). */
  agentTeams: boolean;
  /** The `aw` commands of a person, for example `gate answer`: the settings deny them. */
  personCommands: readonly string[];
  /** The status line command, or null. */
  statusLine: string | null;
}

/**
 * A question for the human that a tool call holds (AskUserQuestion, ExitPlanMode). The title is the
 * full text: awd redacts it before it cuts it to 500 characters.
 */
/**
 * One question of a gate tool with its header, its multi-select value and each option with its
 * description (the `gate.opened` field `questions`, openspec gate-context).
 */
export interface ToolQuestion {
  question: string;
  header: string | null;
  multi_select: boolean;
  options: { label: string; description: string }[];
}

export type ToolGate =
  | {
      kind: "question";
      title: string;
      text: string;
      /** The labels for one-click buttons: only for one single-choice question, else []. */
      options: string[];
      questions?: ToolQuestion[];
    }
  | { kind: "approve_proposal"; title: string; plan: string };

/** One hook event, parsed from the payload of the agent. */
export type AgentHookEvent =
  | { kind: "session_start"; source: string; sessionId: string | null; transcript: string | null }
  | { kind: "prompt"; text: string }
  | {
      kind: "tool_start";
      tool: string;
      input: Record<string, unknown>;
      toolUseId: string | null;
      gate: ToolGate | null;
      /**
       * The teammate or subagent that calls the tool (Claude Code `agent_id`), or null for the lead.
       * AW follows the lead only: a gate tool of a teammate opens no gate (openspec session-options).
       */
      agent?: string | null;
    }
  | { kind: "tool_end"; tool: string; toolUseId: string | null }
  | { kind: "permission"; tool: string; input: Record<string, unknown> }
  | { kind: "notification"; type: string; message: string }
  | { kind: "stop"; text: string }
  | { kind: "stop_failure"; error: string }
  | { kind: "session_end"; reason: string }
  | { kind: "other"; event: string };

export type PermissionDecision =
  { behavior: "allow" } | { behavior: "deny"; message: string; interrupt: boolean };

export interface AgentRuntimeAdapter {
  readonly name: string;
  detect(): Promise<AgentInfo>;
  authStatus(): Promise<AuthStatus>;
  /** The arguments before `--` and the message. */
  launchArgs(input: LaunchInput): string[];
  /** The text of the session settings file that `launchArgs` names (`settingsFile`). */
  sessionSettings(input: SessionSettingsInput): string;
  /** Parses one hook payload. Unknown fields stay out of the result; nothing throws. */
  parseHook(event: string, payload: unknown): AgentHookEvent;
  /**
   * The agent session id of one hook payload (Claude Code `session_id`), or null. awd compares it
   * with the AW session id (openspec agent-pushes-updates).
   */
  hookSessionId?(payload: unknown): string | null;
  /** The stdout JSON of a hook that answers, or null. */
  hookOutput(
    event: string,
    reply: { context: string } | { deny: string } | { permission: PermissionDecision },
  ): string | null;
  /**
   * True when the agent has a conversation of the session that a resume can open (for example a
   * transcript file). An adapter that cannot tell leaves it out: awd then uses its own record.
   */
  hasConversation?(input: { sessionId: string; cwd: string }): Promise<boolean>;
  /**
   * The usage windows of one statusline input, or null when it has none (an API login, or before
   * the first answer of the model).
   */
  parseStatusLine?(payload: unknown): UsageSignal | null;
  /**
   * Marks a working folder that AW created as trusted in the state of the agent, before the agent
   * starts (aw-launch). Only for a version that the contract tests cover.
   */
  trustFolder?(input: TrustInput): Promise<void>;
}

export interface TrustInput {
  /** The state file of the agent, for example `~/.claude.json`. */
  stateFile: string;
  /** The working folder. */
  path: string;
  /** The folder of the backup of the state file. */
  backupDir: string;
  /** A time stamp for the backup name. */
  stamp: string;
}
