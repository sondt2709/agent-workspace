// The Claude Code agent adapter and the AW plugin directory for Claude Code.
export {
  AGENT_COMMANDS,
  ALLOWED_TOOLS,
  COVERED_PATCH_FROM,
  ClaudeAdapter,
  MAX_CONTEXT_CHARS,
  PLUGIN_DIR,
  PLUGIN_NAME,
  hookOutput,
  isCoveredVersion,
  launchArgs,
  launchArgv,
  parseAuthStatus,
  parseHook,
  parseStatusLine,
  parseVersion,
  permissionFlag,
  sessionSettings,
  toolGate,
  transcriptPath,
} from "./claude.ts";
export { trustWorktree, type TrustResult } from "./trust.ts";
export const packageName = "@aw/agent-claude";
