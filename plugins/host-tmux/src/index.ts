// The tmux session host (default). See tmux.ts.
export {
  groupProcessesSince,
  parseElapsed,
  parseProcessTable,
  processExists,
  sessionProcesses,
  type ProcessRow,
} from "./process-table.ts";
export {
  DEFAULT_SOCKET,
  HOST_WINDOW,
  TMUX_CONFIG,
  TMUX_SESSION,
  TmuxError,
  TmuxHost,
  findTmux,
  parseFields,
  serverStartArgs,
  type TmuxHostOptions,
} from "./tmux.ts";
export const packageName = "@aw/host-tmux";
