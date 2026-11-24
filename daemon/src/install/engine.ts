// The engine install of `aw engine install` and `aw service install` (openspec gap-install,
// install-packaging: engine install command). It places the pinned Syncthing binary at
// `<AW_HOME>/engine/syncthing` with the sha256 check of the pins (docs/phase-1.md 6.1).
import {
  fetchEngine,
  loadPins,
  platformKey,
  type EnginePins,
  type EnginePlatform,
} from "@aw/sync-syncthing";
import { access, constants, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Where the engine goes: `settings.sync` (the binary path and whether `AW_SYNC_ENGINE` set it). */
export interface EngineTarget {
  engine: string;
  engineFromEnv: boolean;
}

export interface EngineInstallResult {
  /** The binary path. */
  binary: string;
  /** The tag of the pins, for example `v2.1.7`. */
  tag: string;
  platform: EnginePlatform;
  /** False when a binary of the same pin was already there. */
  installed: boolean;
}

export interface EngineInstallOptions {
  /** A local archive in place of the download (an offline computer). */
  archive?: string;
  /** The pins; default the version file of the plugin. */
  pins?: EnginePins;
  platform?: NodeJS.Platform;
  arch?: string;
  /** The fetch; tests give a fake. Default `fetchEngine` of the plugin. */
  fetch?: typeof fetchEngine;
}

/** An install that the person must fix: the message names the fix. */
export class EngineInstallError extends Error {}

const marker = (dest: string) => join(dest, ".aw-engine-sha256");

/** True when the folder has a binary that a fetch of this pin wrote. */
async function current(dest: string, sha256: string): Promise<boolean> {
  const known = await readFile(marker(dest), "utf8").catch(() => "");
  if (known.trim() !== sha256) return false;
  return access(join(dest, "syncthing"), constants.X_OK).then(
    () => true,
    () => false,
  );
}

/** Installs the pinned engine for this computer into the folder of `target.engine`. */
export async function installEngine(
  target: EngineTarget,
  options: EngineInstallOptions = {},
): Promise<EngineInstallResult> {
  if (target.engineFromEnv) {
    throw new EngineInstallError(
      `AW_SYNC_ENGINE names the engine (${target.engine}). Unset AW_SYNC_ENGINE to install the pinned engine.`,
    );
  }
  const platform = platformKey(options.platform ?? process.platform, options.arch ?? process.arch);
  if (!platform) {
    throw new EngineInstallError(
      `AW ships no sync engine for ${options.platform ?? process.platform}-${options.arch ?? process.arch}.`,
    );
  }
  const pins = options.pins ?? (await loadPins());
  const entry = pins.platforms[platform];
  if (!entry) throw new EngineInstallError(`The engine pins have no entry for ${platform}.`);
  const dest = dirname(target.engine);
  const binary = join(dest, "syncthing");
  if (await current(dest, entry.sha256)) {
    return { binary, tag: pins.tag, platform, installed: false };
  }
  let archiveBytes: Uint8Array | undefined;
  if (options.archive !== undefined) {
    try {
      archiveBytes = new Uint8Array(await readFile(options.archive));
    } catch (error) {
      throw new EngineInstallError(
        `Cannot read ${options.archive}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`,
      );
    }
  }
  const fetch = options.fetch ?? fetchEngine;
  const written = await fetch({
    pins,
    platform,
    dest,
    ...(archiveBytes ? { archiveBytes } : {}),
  });
  return { binary: written, tag: pins.tag, platform, installed: true };
}
