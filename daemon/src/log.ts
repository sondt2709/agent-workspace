// The logger of awd: pino JSON lines to stderr, so stdout stays clean (docs/tech-stack.md 2.1).
// It redacts the fields named like a secret (docs/engineering-rules.md 5.10).
import { pino, type DestinationStream, type Logger } from "pino";
import type { LogLevel } from "./settings.ts";

const SECRET_NAMES = ["token", "secret", "key", "cookie", "password", "authorization"];

/** The pino redact paths: the secret names at depth 1 and 2, and in the request headers. */
export const REDACT_PATHS = [
  ...SECRET_NAMES,
  ...SECRET_NAMES.map((name) => `*.${name}`),
  ...SECRET_NAMES.map((name) => `req.headers.${name}`),
  'req.headers["x-aw-token"]',
  'req.headers["set-cookie"]',
];

export type { Logger };

export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: { name: "awd" },
      redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination ?? pino.destination({ fd: 2, sync: true }),
  );
}

/** True for the ExperimentalWarning of `node:sqlite` (Node 24 before 24.22 prints it). */
export function isSqliteExperimentalWarning(warning: Error): boolean {
  return warning.name === "ExperimentalWarning" && /^SQLite\b/.test(warning.message);
}

/**
 * Replaces the default warning printer of Node: the `node:sqlite` ExperimentalWarning is dropped,
 * each other warning goes to the log. Call it before the first import of `node:sqlite`.
 */
export function installWarningFilter(log: () => Logger): void {
  process.removeAllListeners("warning");
  process.on("warning", (warning) => {
    if (isSqliteExperimentalWarning(warning)) return;
    log().warn({ warning: { name: warning.name, message: warning.message } }, "Node warning");
  });
}
