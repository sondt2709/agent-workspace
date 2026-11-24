// The Orca session host (optional, off by default). See orca.ts.
export { OrcaCli, OrcaError, orcaReplies, parseReply } from "./orca-cli.ts";
export {
  CHECK_TIMEOUT_MS,
  MAC_APP_CLI,
  MAX_TEXT_BYTES,
  MIN_ORCA_VERSION,
  NOT_SENT_CODES,
  OrcaHost,
  SUBMIT_TIMEOUT_MS,
  WAIT_SUBMIT_S,
  compareVersions,
  orcaCandidates,
  shellWord,
  terminalCommand,
  type OrcaHostOptions,
} from "./orca.ts";
export const packageName = "@aw/host-orca";
