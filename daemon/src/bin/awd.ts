#!/usr/bin/env node
// awd: the Agent Workspace daemon. The service units start this file (design decision 20).
// The warning filter must run before the first import of node:sqlite, so the daemon modules load
// with a dynamic import after it (design decision 16).
import { systemClock } from "@aw/core/clock";
import { awdLogPath, LogRotator } from "../log-rotation.ts";
import { createLogger, installWarningFilter, type Logger } from "../log.ts";
import { loadSettings } from "../settings.ts";

const settings = loadSettings();
const log: Logger = createLogger(settings.logLevel);
installWarningFilter(() => log);

const { startServer, AlreadyRunningError } = await import("../server.ts");

try {
  const server = await startServer({ settings, log });
  // The log file of the launchd unit has no size limit of its own (gap-install).
  const rotator = new LogRotator({ path: awdLogPath(settings.home), clock: systemClock, log });
  rotator.start();
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "awd stops");
    rotator.close();
    server
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        log.error({ err: error }, "The stop failed");
        process.exit(1);
      });
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
} catch (error) {
  if (error instanceof AlreadyRunningError) {
    log.error(error.message);
    process.exit(1);
  }
  log.fatal({ err: error }, "awd did not start");
  process.exit(1);
}
