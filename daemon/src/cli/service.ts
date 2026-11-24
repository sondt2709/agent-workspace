// The install commands of the aw CLI (openspec gap-install): `aw service install|uninstall|status|
// move-keys` and `aw engine install`. `aw service install` places the sync engine, checks for tmux
// and writes the service unit, so one command installs awd, the session host check and the engine
// (prd DEV-09).
import { AwUnreachableError, type AwClient } from "@aw/client";
import { findTmux } from "@aw/host-tmux";
import type { Keystore } from "@aw/identity";
import type { Command } from "@commander-js/extra-typings";
import { chown, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { localUnitContext } from "../install/context.ts";
import {
  EngineInstallError,
  installEngine,
  type EngineInstallOptions,
  type EngineInstallResult,
  type EngineTarget,
} from "../install/engine.ts";
import {
  keyInKeychainText,
  keyOnlyInOsKeystore,
  moveKeys,
  MoveKeysError,
} from "../install/keys.ts";
import { localTmuxInstallCommand, tmuxMissingText } from "../install/tmux.ts";
import type { Settings } from "../settings.ts";
import { ensurePrivateFolder } from "../state.ts";
import {
  installUnit,
  renderUnit,
  restartUnit,
  servicePath,
  uninstallUnit,
  unitEnvOf,
  unitKind,
  unitPath,
  unitStatus,
  type CommandRunner,
  type UnitContext,
  type UnitResult,
} from "../units/units.ts";

export type EngineInstaller = (
  target: EngineTarget,
  options: EngineInstallOptions,
) => Promise<EngineInstallResult>;

export interface ServiceDeps {
  runner: CommandRunner;
  platform: NodeJS.Platform;
  uid: number;
  /** The engine install; tests give a fake. */
  engine?: EngineInstaller;
  /** The tmux search in a PATH; tests give a fake. */
  findTmux?: (path: string) => Promise<string | null>;
  /** The keystores of `aw service move-keys`; tests give 2 file keystores. */
  keystores?: { from?: Keystore; to?: Keystore };
}

export interface ServiceCommandContext {
  settings: Settings;
  client: AwClient;
  deps: ServiceDeps;
  print: (value: unknown, text: () => string) => void;
  resolvePath: (path: string) => string;
  inputError: (message: string) => Error;
  refusedError: (message: string) => Error;
}

/** The home folder of a macOS user, from the directory service (`dscl`). */
async function macUserHome(
  name: string,
  runner: CommandRunner,
  inputError: (message: string) => Error,
): Promise<string> {
  const result = await runner("dscl", [".", "-read", `/Users/${name}`, "NFSHomeDirectory"]);
  const home = /^NFSHomeDirectory:\s*(\/\S.*)$/m.exec(result.stdout)?.[1]?.trim();
  if (result.exitCode !== 0 || !home) {
    throw inputError(
      `Cannot find the home folder of the user ${name}: ${result.stderr.trim() || "no NFSHomeDirectory"}`,
    );
  }
  return home;
}

/**
 * The context of a LaunchDaemon. It runs at boot as root, so it must name the user that runs awd:
 * under `sudo`, the user that ran sudo, never root. Else awd makes root-owned files and a socket
 * that the person's `aw` cannot use. A preview (`--print`) by a normal user uses that user.
 */
async function launchDaemonContext(
  settings: Settings,
  base: UnitContext,
  runner: CommandRunner,
  inputError: (message: string) => Error,
): Promise<UnitContext & { gid: number | null }> {
  if (base.uid !== 0) return { ...base, gid: null };
  const user = settings.sudoUser;
  if (!user || user.name === "root" || user.uid === 0) {
    throw inputError(
      "Run it with sudo from the account that uses awd: sudo aw service install --headless. awd must not run as root.",
    );
  }
  const userHome = await macUserHome(user.name, runner, inputError);
  const defaultHome = join(userHome, ".aw");
  const awHome = settings.homeFromEnv ? settings.home : defaultHome;
  return {
    ...base,
    userName: user.name,
    uid: user.uid,
    gid: user.gid,
    userHome,
    awHome,
    customHome: awHome !== defaultHome,
    // The PATH of sudo has no folder of the user: add the user's ~/.local/bin.
    path: servicePath({
      installPath: settings.sessions.path,
      userHome,
      nodePath: base.nodePath,
    }),
  };
}

/** Gives a folder and each entry in it to a user (an engine that `sudo` installed). */
async function chownTree(path: string, uid: number, gid: number): Promise<void> {
  await chown(path, uid, gid);
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await chownTree(child, uid, gid);
    else await chown(child, uid, gid);
  }
}

export function addServiceCommands(program: Command, ctx: ServiceCommandContext): void {
  const { settings, deps, print } = ctx;
  const { runner, platform, uid } = deps;
  const engineInstaller = deps.engine ?? installEngine;

  const printUnit = (result: UnitResult) =>
    print(result, () =>
      [
        `${result.kind} ${result.path}: ${result.installed ? "installed" : "not installed"}, ${result.loaded ? "loaded" : "not loaded"}`,
        ...result.commands.map((c) => `  ran: ${c}`),
        ...result.notes,
      ].join("\n"),
    );

  const describeEngine = (result: EngineInstallResult) =>
    result.installed
      ? `Installed the sync engine Syncthing ${result.tag} (${result.platform}) at ${result.binary}`
      : `The sync engine Syncthing ${result.tag} (${result.platform}) is already at ${result.binary}`;

  // ---- engine ----
  const engine = program.command("engine").description("The sync engine (Syncthing) of awd");
  engine
    .command("install")
    .description("Install the pinned sync engine at ~/.aw/engine/syncthing (sha256 checked)")
    .option("--archive <file>", "a downloaded release archive in place of the download")
    .action(async (options) => {
      try {
        const result = await engineInstaller(settings.sync, {
          platform,
          ...(options.archive ? { archive: ctx.resolvePath(options.archive) } : {}),
        });
        print(result, () =>
          [
            describeEngine(result),
            ...(result.installed
              ? ["A running awd starts the engine within 5 s, with no restart."]
              : []),
          ].join("\n"),
        );
      } catch (error) {
        if (error instanceof EngineInstallError) throw ctx.refusedError(error.message);
        throw error;
      }
    });

  // ---- service ----
  const service = program.command("service").description("The service unit that keeps awd running");
  service
    .command("install")
    .description(
      "Install the sync engine, check for tmux, and write and load the service unit (systemd user unit, LaunchAgent or LaunchDaemon)",
    )
    .option("--headless", "macOS: a LaunchDaemon that starts at boot with no login (needs sudo)")
    .option("--print", "print the unit text and change nothing")
    .option("--no-engine", "do not install the sync engine")
    .action(async (options) => {
      const kind = unitKind(platform, options.headless ?? false);
      const base = localUnitContext(settings, uid);
      if (kind === "launch-daemon" && !options.print && uid !== 0) {
        throw ctx.inputError("A LaunchDaemon needs root. Run: sudo aw service install --headless");
      }
      const daemon =
        kind === "launch-daemon"
          ? await launchDaemonContext(settings, base, runner, ctx.inputError)
          : null;
      const context = daemon ?? base;
      // The tmux of the unit PATH: awd under launchd or systemd has that PATH, not the terminal's.
      const tmux =
        settings.sessions.tmux ??
        (await (deps.findTmux ?? findTmux)(context.path ?? settings.sessions.path));
      if (kind === "systemd") {
        context.sessions = tmux
          ? {
              tmux,
              socket: settings.sessions.tmuxSocket,
              config: join(context.awHome, "run", "tmux.conf"),
            }
          : null;
      }
      if (options.print) {
        const text = renderUnit(kind, context);
        print({ kind, path: unitPath(kind, context), text }, () => text.trimEnd());
        return;
      }
      if (kind === "launch-daemon" && (await keyOnlyInOsKeystore(context.awHome))) {
        throw ctx.refusedError(keyInKeychainText(context.userName));
      }
      if (daemon !== null && daemon.gid !== null) {
        // launchd opens the log file before awd starts: the folders must be the user's, not root's.
        for (const folder of [daemon.awHome, join(daemon.awHome, "logs")]) {
          await ensurePrivateFolder(folder);
          await chown(folder, daemon.uid, daemon.gid);
        }
      }
      const notes: string[] = [];
      let engineResult: EngineInstallResult | null = null;
      if (options.engine) {
        const target: EngineTarget = settings.sync.engineFromEnv
          ? settings.sync
          : { engine: join(context.awHome, "engine", "syncthing"), engineFromEnv: false };
        if (target.engineFromEnv) {
          notes.push(`The sync engine comes from AW_SYNC_ENGINE (${target.engine}).`);
        } else {
          try {
            engineResult = await engineInstaller(target, { platform });
            notes.push(describeEngine(engineResult));
            if (daemon !== null && daemon.gid !== null) {
              await chownTree(dirname(engineResult.binary), daemon.uid, daemon.gid);
            }
          } catch (error) {
            // A failed download can leave a root-owned engine folder: give it to the user, so
            // `aw engine install` as the user works (gap-install low 5).
            if (daemon !== null && daemon.gid !== null) {
              await chownTree(dirname(target.engine), daemon.uid, daemon.gid).catch(
                () => undefined,
              );
            }
            notes.push(
              `The sync engine was not installed: ${(error as Error).message}`,
              "Fix: run aw engine install again, or aw engine install --archive <file>. awd runs with sync off until then.",
            );
          }
        }
      }
      if (tmux === null) notes.push(tmuxMissingText(await localTmuxInstallCommand(platform)));
      // The variables that the person added to the old unit stay (fc1-lead-2; Q12 is open).
      const oldUnit = await readFile(unitPath(kind, context), "utf8").catch(() => null);
      const kept = oldUnit === null ? {} : unitEnvOf(kind, oldUnit);
      if (Object.keys(kept).length > 0) {
        context.env = { ...kept, ...context.env };
        notes.push(`Kept the variables of the old unit: ${Object.keys(kept).sort().join(", ")}.`);
      }
      const result = await installUnit(kind, context, runner);
      if (engineResult?.installed) {
        // A unit with the same text is not restarted by the load: restart awd for the engine.
        try {
          result.commands.push(await restartUnit(kind, context, runner));
        } catch (error) {
          notes.push(
            `awd did not restart (${(error as Error).message}). A running awd starts the engine within 5 s.`,
          );
        }
      }
      result.notes.push(...notes);
      printUnit(result);
    });
  service
    .command("uninstall")
    .description("Unload and remove the service unit")
    .option("--headless", "macOS: the LaunchDaemon")
    .action(async (options) => {
      const kind = unitKind(platform, options.headless ?? false);
      const context = localUnitContext(settings, uid);
      // The tmux server of the sessions stops with the unit (on Linux through aw-sessions.service).
      const tmux =
        settings.sessions.tmux ??
        (await (deps.findTmux ?? findTmux)(context.path ?? settings.sessions.path));
      context.sessions = tmux
        ? {
            tmux,
            socket: settings.sessions.tmuxSocket,
            config: join(context.awHome, "run", "tmux.conf"),
          }
        : null;
      printUnit(await uninstallUnit(kind, context, runner));
    });
  service
    .command("status")
    .description("Show whether the service unit is installed and loaded")
    .option("--headless", "macOS: the LaunchDaemon")
    .action(async (options) => {
      const kind = unitKind(platform, options.headless ?? false);
      printUnit(await unitStatus(kind, localUnitContext(settings, uid), runner));
    });
  service
    .command("move-keys")
    .description(
      "Move the device key and the recovery phrase from the Keychain to ~/.aw/keys/ (before --headless)",
    )
    .action(async () => {
      if (uid === 0) {
        throw ctx.inputError("Run aw service move-keys as the user that uses awd, with no sudo.");
      }
      const running = await ctx.client.health().then(
        () => true,
        (error: unknown) => !(error instanceof AwUnreachableError),
      );
      if (running) {
        throw ctx.refusedError("awd is running. Stop it first: aw service uninstall");
      }
      try {
        const result = await moveKeys(settings.home, deps.keystores ?? {});
        print(result, () =>
          result.moved.length === 0
            ? `The keys are already in ${result.folder}.`
            : `Moved ${result.moved.join(" and ")} to ${result.folder}. Now run: sudo aw service install --headless`,
        );
      } catch (error) {
        if (error instanceof MoveKeysError) throw ctx.refusedError(error.message);
        throw error;
      }
    });
}
