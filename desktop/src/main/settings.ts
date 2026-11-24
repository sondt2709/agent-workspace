// The only reader of the environment in the desktop app (docs/engineering-rules.md 5.8).
import { homedir } from "node:os";
import { join } from "node:path";

export interface DesktopSettings {
  /** The AW state folder: `AW_HOME`, default `~/.aw`. */
  awHome: string;
  /** The awd socket: `<awHome>/run/awd.sock`. */
  socketPath: string;
  /**
   * The Vite dev server of `electron-vite dev` (`ELECTRON_RENDERER_URL`), or null. The window loads
   * it and trusts its origin for the bridge, so the packaged app never reads it, and a dev build
   * accepts only an `http:` URL on this computer (fix list 0-6).
   */
  devServerUrl: string | null;
  /** `AW_LOG_LEVEL`, default `info`. */
  logLevel: string;
}

export interface LoadOptions {
  /** `app.isPackaged`: true for the built app that a person starts. */
  packaged: boolean;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The dev server URL when it is a local `http:` URL, else null. */
export function localDevServerUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname) ? value : null;
  } catch {
    return null;
  }
}

export function loadSettings(
  options: LoadOptions,
  env: NodeJS.ProcessEnv = process.env,
): DesktopSettings {
  const awHome = env.AW_HOME || join(env.HOME || homedir(), ".aw");
  return {
    awHome,
    socketPath: join(awHome, "run", "awd.sock"),
    devServerUrl: options.packaged ? null : localDevServerUrl(env.ELECTRON_RENDERER_URL),
    logLevel: env.AW_LOG_LEVEL || "info",
  };
}
