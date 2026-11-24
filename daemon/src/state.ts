// The state folder of this device (`~/.aw`, never synced): the folder modes and `config.yaml` with
// the device and the registered workspace folders (docs/phase-1.md 3.1).
import { writeFileAtomic } from "@aw/core";
import { deviceRole, deviceSlug, uuidv7 } from "@aw/schema";
import { chmod, mkdir, readFile, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import type { Settings } from "./settings.ts";

export const FOLDER_MODE = 0o700;
export const SOCKET_MODE = 0o600;
/** macOS allows 104 bytes in a socket path, Linux 108. Keep 1 byte for the end mark. */
export const MAX_SOCKET_PATH_BYTES = 103;

// A loose object: the keys of a newer awd survive a save of this version (a rollback of a
// self-update), for example a privacy setting (gap-setup L3).
export const awdConfig = z.looseObject({
  kind: z.literal("awd-config"),
  schema: z.literal(1),
  /** This device. Pairing (identity-pairing) replaces it with the signed device record. */
  device: z.object({
    slug: deviceSlug,
    name: z.string().min(1).max(200),
    role: deviceRole,
  }),
  workspaces: z.array(z.object({ id: uuidv7, path: z.string().min(1) })).default([]),
  /**
   * The sync settings of this device (gap-setup): `community` is the switch "Use community
   * discovery and relay servers". Not set: on (decision D18). `AW_SYNC_COMMUNITY` wins.
   */
  sync: z.looseObject({ community: z.boolean().optional() }).optional(),
});
export type AwdConfig = z.infer<typeof awdConfig>;
export type WorkspaceEntry = AwdConfig["workspaces"][number];

/** A device slug from a host name: lower case, each other character to `-`, at most 63 characters. */
export function slugFromHostname(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\.local$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "device";
}

/** Creates a folder with mode 0700, and sets the mode again when it differs. */
export async function ensurePrivateFolder(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: FOLDER_MODE });
  const info = await stat(path);
  if ((info.mode & 0o777) !== FOLDER_MODE) await chmod(path, FOLDER_MODE);
}

/** The folders of the state folder. */
export function statePaths(settings: Settings) {
  return {
    home: settings.home,
    run: dirname(settings.socketPath),
    index: join(settings.home, "index"),
    logs: join(settings.home, "logs"),
    config: join(settings.home, "config.yaml"),
  };
}

/** Throws a clear error when the socket path is too long for the operating system. */
export function checkSocketPath(settings: Settings): void {
  if (Buffer.byteLength(settings.socketPath) > MAX_SOCKET_PATH_BYTES) {
    throw new Error(
      `The socket path ${settings.socketPath} is longer than ${MAX_SOCKET_PATH_BYTES} bytes. Use a shorter AW_HOME.`,
    );
  }
}

/** Creates the state folder, `run/`, `index/` and `logs/` with mode 0700. */
export async function prepareStateFolders(settings: Settings): Promise<void> {
  const paths = statePaths(settings);
  checkSocketPath(settings);
  for (const folder of [paths.home, paths.run, paths.index, paths.logs]) {
    await ensurePrivateFolder(folder);
  }
}

/** Reads `config.yaml`, or creates it with a slug from the host name and the role `local`. */
export async function loadConfig(settings: Settings): Promise<AwdConfig> {
  const path = statePaths(settings).config;
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const name = hostname();
    const config: AwdConfig = {
      kind: "awd-config",
      schema: 1,
      device: { slug: slugFromHostname(name), name: name.replace(/\.local$/, ""), role: "local" },
      workspaces: [],
    };
    await saveConfig(settings, config);
    return config;
  }
  const parsed = awdConfig.safeParse(parse(text));
  if (!parsed.success) {
    throw new Error(`${path} is not valid: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export async function saveConfig(settings: Settings, config: AwdConfig): Promise<void> {
  await ensurePrivateFolder(settings.home);
  await writeFileAtomic(statePaths(settings).config, stringify(awdConfig.parse(config)));
}
