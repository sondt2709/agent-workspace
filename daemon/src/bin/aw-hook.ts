#!/usr/bin/env node
// aw-hook <Event>: the hook command of the AW plugin (docs/phase-1.md 9.3, design decisions 2 and 3).
// It writes the hook event to the spool of the session and exits, so it works while awd is down.
// SessionStart, PreToolUse (AskUserQuestion, ExitPlanMode, the AW guard) and PermissionRequest answer
// Claude Code.
import { AwApiError, AwClient, AwUnreachableError } from "@aw/client";
import { systemClock } from "@aw/core";
import { newId } from "@aw/schema";
import { readFile } from "node:fs/promises";
import {
  guardDenyText,
  guardReason,
  teammateGateReason,
  type GuardContext,
} from "../sessions/guard.ts";
import { makeAdapter } from "../sessions/plugins.ts";
import { launchFile, sessionPaths } from "../sessions/records.ts";
import { writeSpool } from "../sessions/spool.ts";
import { loadSettings } from "../settings.ts";

/** The longest wait of a permission request: awd answers at 120 s; this is the margin. */
const PERMISSION_DEADLINE_MS = 125_000;
const clock = systemClock;

const event = process.argv[2] ?? "";
const settings = loadSettings();
const session = settings.sessions.session;
if (!session || !/^[A-Za-z]+$/.test(event)) process.exit(0);

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const raw = Buffer.concat(chunks).toString("utf8");
let payload: unknown;
try {
  payload = JSON.parse(raw);
} catch {
  payload = { raw };
}

const adapter = makeAdapter(settings);
const paths = sessionPaths(settings.home, session.id);
const parsed = adapter.parseHook(event, payload);
// A gate tool of a teammate opens no gate: AW follows the lead only (openspec session-options).
const teammate = teammateGateReason(parsed);
const gate = parsed.kind === "tool_start" && parsed.gate && teammate === null ? newId(clock) : null;

/**
 * The guard context of the session from launch.json (openspec session-options). With no readable
 * file the hook uses AW_HOME and the working folder: the guard still protects the state folder.
 */
async function guardContext(): Promise<GuardContext> {
  try {
    const launch = launchFile.parse(JSON.parse(await readFile(paths.launch, "utf8")));
    if (launch.guard) {
      return {
        home: launch.guard.home,
        userHome: launch.guard.user_home,
        workspaces: launch.guard.workspaces,
        credentialsDir: launch.guard.credentials_dir,
        cwd: launch.guard.cwd,
      };
    }
  } catch {
    // The fallback below.
  }
  return {
    home: settings.home,
    userHome: settings.userHome,
    workspaces: [],
    credentialsDir: null,
    cwd: process.cwd(),
  };
}

// The AW guard runs before each tool call, in each permission mode, with no awd call: a deny rule
// of the agent matches only the command text, and in skip mode no permission request comes.
const denied =
  parsed.kind === "tool_start" && gate === null
    ? (guardReason(parsed.tool, parsed.input, await guardContext()) ?? teammate)
    : null;
// The spool order needs microseconds: the clock module has ms only. The `at` field is the clock.
const micros = (performance.timeOrigin + performance.now()) * 1000;
// A failed spool write must not drop the answer to Claude Code: a hook that fails prints nothing,
// and Claude Code then runs the tool (fail-open). The deny of the guard prints in each case.
const spooled = await writeSpool(
  paths.spool,
  { event, at: clock.now(), payload, gate, denied },
  micros,
).then(
  () => true,
  (error: unknown) => {
    process.stderr.write(`aw-hook: the spool write failed: ${(error as Error).message}\n`);
    return false;
  },
);

const print = (text: string | null) => {
  if (text !== null) process.stdout.write(text);
};

if (parsed.kind === "session_start") {
  const context = await readFile(paths.context, "utf8").catch(() => "");
  if (context) print(adapter.hookOutput("SessionStart", { context }));
} else if (denied !== null) {
  print(adapter.hookOutput("PreToolUse", { deny: guardDenyText(denied) }));
} else if (gate !== null) {
  print(
    adapter.hookOutput("PreToolUse", {
      deny: spooled
        ? `AW sent this to the human as gate ${gate}. End your turn now. The answer arrives as your next input, after "[AW answer ${gate}]".`
        : "AW could not send this to the human (the hook could not write its event). End your turn.",
    }),
  );
} else if (parsed.kind === "permission") {
  const requestId = `p-${newId(clock)}`;
  const end = clock.now() + PERMISSION_DEADLINE_MS;
  for (;;) {
    // Each retry waits only the rest of the deadline (awd also waits only the rest since the gate
    // opened), so the hook ends before the 135 s timeout of hooks.json.
    const client = new AwClient({
      socketPath: settings.socketPath,
      timeoutMs: Math.max(1000, end - clock.now() + 5000),
      // The session token from the agent environment (aw-launch exports AW_MCP_TOKEN).
      token: settings.sessions.token,
    });
    try {
      const reply = await client.permission(session.id, {
        request_id: requestId,
        tool: parsed.tool,
        input: parsed.input,
      });
      print(adapter.hookOutput("PermissionRequest", { permission: reply.decision }));
      break;
    } catch (error) {
      const retry =
        error instanceof AwUnreachableError ||
        (error instanceof AwApiError && error.status === 503);
      if (!retry || clock.now() >= end) {
        print(
          adapter.hookOutput("PermissionRequest", {
            permission: {
              behavior: "deny",
              message: `AW could not ask the human (${(error as Error).message}). End your turn.`,
              interrupt: true,
            },
          }),
        );
        break;
      }
      await clock.sleep(1000);
    }
  }
}
