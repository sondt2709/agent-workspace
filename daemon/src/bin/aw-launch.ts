#!/usr/bin/env node
// aw-launch <session>: the fixed launcher of an AW session (docs/phase-1.md 9.1, design decision 12).
// It reads the launch file and the message file of the session, waits for /readyz, writes the trust
// entry of the worktree, and replaces itself with the agent (execve). No shell parses the message.
import { AwClient } from "@aw/client";
import { systemClock } from "@aw/core";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { mcpEnvironment } from "../mcp/launch.ts";
import { launchMessage } from "../sessions/context.ts";
import { makeAdapter } from "../sessions/plugins.ts";
import { launchFile, sessionPaths } from "../sessions/records.ts";
import { loadSettings, processEnvironment } from "../settings.ts";

const READY_WAIT_MS = 10_000;
const clock = systemClock;

function fail(code: number, message: string): never {
  process.stderr.write(`aw-launch: ${message}\n`);
  process.exit(code);
}

async function resolveBinary(binary: string, path: string): Promise<string> {
  if (binary.includes("/")) return binary;
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, binary);
    if (
      await access(candidate, constants.X_OK).then(
        () => true,
        () => false,
      )
    )
      return candidate;
  }
  return fail(2, `${binary} is not in PATH`);
}

const session = process.argv[2] ?? "";
if (!/^[0-9a-f-]{36}$/.test(session)) fail(2, "usage: aw-launch <session-id>");
const settings = loadSettings();
const paths = sessionPaths(settings.home, session);
const parsed = launchFile.safeParse(
  JSON.parse(await readFile(paths.launch, "utf8").catch(() => "{}")),
);
if (!parsed.success) fail(2, `${paths.launch} is missing or not valid`);
const launch = parsed.data;

// awd must answer before the agent starts: Claude Code marks a failed MCP server as failed for the
// whole session (docs/architecture.md 6.4.5).
const client = new AwClient({ socketPath: launch.socket, timeoutMs: 2000 });
const wait = launch.ready_wait_ms ?? READY_WAIT_MS;
const end = clock.now() + wait;
for (;;) {
  const ready = await client.ready().catch(() => null);
  if (ready?.ready) break;
  if (clock.now() >= end) {
    fail(3, `awd did not answer /readyz on ${launch.socket} in ${wait / 1000} s`);
  }
  await clock.sleep(250);
}

const adapter = makeAdapter(settings);
if (launch.trust && adapter.trustFolder) {
  // With no trust entry, Claude Code shows the trust screen, and awd answers it (design 13).
  await adapter
    .trustFolder({
      stateFile: launch.state_file,
      path: process.cwd(),
      backupDir: launch.backup_dir,
      stamp: new Date(clock.now()).toISOString().replace(/[-:.]/g, ""),
    })
    .catch((error: unknown) => {
      process.stderr.write(`aw-launch: no trust entry: ${(error as Error).message}\n`);
    });
}

// A first input over 96 KiB stays in its file: one argv string that long fails with E2BIG.
const message = launchMessage(await readFile(launch.message_file, "utf8"), launch.message_file);
// The MCP server of awd: the URL from run/mcp.port (only when MCP runs) and the token of this
// session (always: the aw CLI and the hooks need it too). The token stays out of each command line
// and of launch.json (add-mcp-server, decision 10).
const inherited = processEnvironment();
delete inherited.AW_MCP_URL;
delete inherited.AW_MCP_TOKEN;
const env: Record<string, string | undefined> = {
  ...inherited,
  ...launch.env,
  ...(await mcpEnvironment(settings.mcp.portFile, settings.home, session)),
};
const binary = await resolveBinary(launch.binary, env.PATH ?? "");
if (!process.execve) fail(2, `Node ${process.version} has no process.execve`);
process.execve(binary, [binary, ...launch.args, "--", message], env);
