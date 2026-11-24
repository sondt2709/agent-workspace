// The one place where awd joins the bundled session plugins (design decision 1): the tmux host, the
// optional Orca host (add-orca-session-host) and the Claude Code adapter. A plugin never imports another plugin, and the rest of awd (the hook and
// launch binaries, the CLI) uses the plugins only through this file and the interfaces of
// @aw/plugin-api.
import { ClaudeAdapter, PLUGIN_DIR } from "@aw/agent-claude";
import { OrcaHost } from "@aw/host-orca";
import { findTmux, serverStartArgs, TmuxHost } from "@aw/host-tmux";
import type { AgentRuntimeAdapter, SessionHost } from "@aw/plugin-api";
import { execa } from "execa";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { entryPath } from "../entry.ts";
import type { Logger } from "../log.ts";
import type { Settings } from "../settings.ts";
import type { SessionTools } from "./manager.ts";

export const AW_LAUNCH = fileURLToPath(new URL("../../bin/aw-launch", import.meta.url));
export const AW_CLI = entryPath(import.meta.url, "../bin/aw");
export const AW_HOOK = entryPath(import.meta.url, "../bin/aw-hook");
export const AW_STATUSLINE = entryPath(import.meta.url, "../bin/aw-statusline");
export const SESSIONS_UNIT = "aw-sessions.service";

export type Runner = (command: string, args: string[]) => Promise<{ exitCode: number }>;

const execRunner: Runner = async (command, args) => ({
  exitCode: (await execa(command, args, { reject: false })).exitCode ?? 1,
});

/**
 * Linux: starts the tmux server outside the unit of awd, so a restart of awd
 * (`KillMode=control-group`) never stops the sessions (docs/architecture.md 4.6.1). First
 * `aw-sessions.service` when `aw service install` wrote it; else a transient scope of the systemd
 * user manager (`systemd-run --user --scope`), with a warning to run `aw service install` again.
 * Returns false on macOS, or when systemd cannot start it: the host then starts tmux itself.
 */
export async function startTmuxOutsideAwd(input: {
  platform: NodeJS.Platform;
  binary: string | null;
  socket: string;
  configFile: string;
  run?: Runner;
  warn?: (message: string) => void;
}): Promise<boolean> {
  if (input.platform !== "linux") return false;
  const run = input.run ?? execRunner;
  if ((await run("systemctl", ["--user", "cat", SESSIONS_UNIT])).exitCode === 0) {
    return (await run("systemctl", ["--user", "start", SESSIONS_UNIT])).exitCode === 0;
  }
  if (input.binary === null) return false;
  const scope = await run("systemd-run", [
    "--user",
    "--scope",
    "--quiet",
    "--collect",
    `--description=AW sessions (tmux -L ${input.socket})`,
    input.binary,
    ...serverStartArgs(input.socket, input.configFile),
  ]);
  if (scope.exitCode === 0) {
    input.warn?.(
      `${SESSIONS_UNIT} is not installed: tmux runs in a transient systemd scope. Run aw service install again.`,
    );
    return true;
  }
  input.warn?.(
    `${SESSIONS_UNIT} is not installed and systemd-run failed: tmux runs in the process tree of awd, so an awd restart can stop the sessions. Run aw service install again.`,
  );
  return false;
}

/** The tmux binary: `AW_TMUX`, else the first `tmux` in PATH that is not a shim. */
export async function hostBinary(settings: Settings): Promise<string | null> {
  return settings.sessions.tmux ?? (await findTmux(settings.sessions.path));
}

export async function makeHost(settings: Settings, log?: Logger): Promise<TmuxHost> {
  const binary = await hostBinary(settings);
  const configFile = join(settings.home, "run", "tmux.conf");
  return new TmuxHost({
    binary,
    socket: settings.sessions.tmuxSocket,
    configFile,
    startInUnit: () =>
      startTmuxOutsideAwd({
        platform: process.platform,
        binary,
        socket: settings.sessions.tmuxSocket,
        configFile,
        warn: (message) => log?.warn(message),
      }),
    warn: (message) => log?.warn(message),
  });
}

/** The agent adapter of the sessions (Claude Code in phase 1). */
export function makeAdapter(settings: Settings): AgentRuntimeAdapter {
  return new ClaudeAdapter({
    binary: settings.sessions.claude,
    configDir: settings.sessions.claudeConfigDir,
  });
}

/**
 * The Orca host: optional, off by default, on per device ("Use Orca on this device" in the
 * bindings). It looks for Orca only when a session asks for it.
 */
export function makeOrcaHost(settings: Settings, log?: Logger): OrcaHost {
  return new OrcaHost({
    configured: settings.sessions.orca,
    path: settings.sessions.path,
    warn: (message) => log?.warn(message),
  });
}

export async function makeTools(
  settings: Settings,
  host: TmuxHost,
  log?: Logger,
): Promise<SessionTools> {
  const adapter = makeAdapter(settings);
  return {
    host,
    hosts: new Map<string, SessionHost>([["orca", makeOrcaHost(settings, log)]]),
    adapter,
    agent: await adapter.detect(),
    pluginDir: PLUGIN_DIR,
    awLaunch: AW_LAUNCH,
    awCli: AW_CLI,
    awHook: AW_HOOK,
    awStatusline: AW_STATUSLINE,
  };
}
