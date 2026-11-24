// The commands of a person in the aw CLI. The CLI refuses them inside an agent session, the
// session settings deny them, and the AW guard of the PreToolUse hook denies them (principle 4).

/** The person commands of the setup commands (`setup.ts`). */
export const SETUP_HUMAN_COMMANDS = [
  "workspace rename",
  "workspace edit",
  "workspace remove",
  "project edit",
  "project archive",
  "project unarchive",
  "project remove",
  "binding set",
  "binding remove",
  "binding slot",
  "binding orca",
] as const;

/**
 * The commands of a person. The CLI refuses them inside an agent session (AW_SESSION is set): an
 * agent never answers its own gate, moves its own task or stops a session (principle 4). The
 * allow rules of a session cover only the agent commands, so another way round this check asks
 * the human first.
 */
export const HUMAN_COMMANDS: ReadonlySet<string> = new Set<string>([
  "workspace init",
  "project add",
  "task edit",
  "task assign",
  "task archive",
  "task unarchive",
  "task stop",
  "gate answer",
  "kb accept",
  "kb reject",
  "service install",
  "service uninstall",
  "service move-keys",
  "engine install",
  "doctor",
  "queue",
  "terminal",
  "session stop",
  "identity show",
  "identity phrase",
  "device list",
  "device add",
  "device approve",
  "device cancel",
  "device revoke",
  "pair",
  "credential add",
  "credential list",
  "credential remove",
  "credential get",
  // The person routes of /v1/sync (final check fc1-12); `aw sync status` is a read.
  "sync now",
  "sync pause",
  "sync resume",
  "sync peer add",
  "sync peer remove",
  ...SETUP_HUMAN_COMMANDS,
]);
