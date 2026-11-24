// The engine pins (docs/tech-stack.md 1.2): one version file with the tag, the sha256 of each
// platform archive and the fingerprint of the release key. The fetch refuses an archive with
// another sha256. The pin check needs a valid signature of the pinned key on the release sums.
import { execa } from "execa";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** The plugin folder. */
export const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
/** The version file. */
export const PINS_FILE = join(PLUGIN_DIR, "engine", "engine.json");

const sha256Pattern = /^[0-9a-f]{64}$/;

const pinsSchema = z.object({
  engine: z.literal("syncthing"),
  tag: z.string().regex(/^v\d+\.\d+\.\d+$/),
  release_url: z.string().url(),
  signed_sums: z.string().min(1),
  release_key_url: z.string().url(),
  release_key_fingerprint: z.string().regex(/^[0-9A-F]{40}$/),
  platforms: z.record(
    z.string(),
    z.object({ archive: z.string().min(1), sha256: z.string().regex(sha256Pattern) }),
  ),
});

export type EnginePins = z.infer<typeof pinsSchema>;

/** The platforms that AW ships the engine for. */
export const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] as const;
export type EnginePlatform = (typeof PLATFORMS)[number];

/** Reads and checks the version file. */
export async function loadPins(file = PINS_FILE): Promise<EnginePins> {
  const pins = pinsSchema.parse(JSON.parse(await readFile(file, "utf8")));
  for (const platform of PLATFORMS) {
    const entry = pins.platforms[platform];
    if (!entry) throw new Error(`${file} has no pin for ${platform}`);
    if (!entry.archive.includes(pins.tag)) {
      throw new Error(`The archive ${entry.archive} of ${platform} is not of the tag ${pins.tag}`);
    }
  }
  return pins;
}

/** The pin platform of an OS and an architecture, or null when AW ships no engine for it. */
export function platformKey(
  platform: string = process.platform,
  arch: string = process.arch,
): EnginePlatform | null {
  const key = `${platform}-${arch}`;
  return (PLATFORMS as readonly string[]).includes(key) ? (key as EnginePlatform) : null;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Throws when the bytes do not have the pinned sha256. */
export function checkArchive(bytes: Uint8Array, archive: string, expected: string): void {
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(
      `The sha256 of ${archive} is ${actual}, not the pinned ${expected}. The archive is not used.`,
    );
  }
}

const SIGNED_BEGIN = "-----BEGIN PGP SIGNED MESSAGE-----";
const SIGNATURE_BEGIN = "-----BEGIN PGP SIGNATURE-----";
const SIGNATURE_END = "-----END PGP SIGNATURE-----";

/**
 * The one clear-signed block of a downloaded sums file, without the text before or after it.
 * Text outside the block has no signature, so it is never read. A file with 0 or 2 or more
 * blocks is refused.
 */
export function signedBlock(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const begins = lines.flatMap((line, i) => (line === SIGNED_BEGIN ? [i] : []));
  if (begins.length !== 1) {
    throw new Error(`The sums file has ${begins.length} clear-signed blocks, not 1`);
  }
  const start = begins[0]!;
  const end = lines.findIndex((line, i) => i > start && line === SIGNATURE_END);
  if (end < 0) throw new Error("The clear-signed block of the sums file has no end");
  return `${lines.slice(start, end + 1).join("\n")}\n`;
}

/** The signed text of a clear-signed block: the lines after the armor header, dash-unescaped. */
export function clearSignedText(block: string): string {
  const lines = signedBlock(block).split("\n");
  const blank = lines.indexOf("");
  const signature = lines.indexOf(SIGNATURE_BEGIN);
  if (blank < 0 || signature < blank) throw new Error("The clear-signed block is not valid");
  return lines
    .slice(blank + 1, signature)
    .map((line) => (line.startsWith("- ") ? line.slice(2) : line))
    .join("\n");
}

/**
 * Reads the `<sha256>  <name>` lines of a signed sums text. Give it only signed text (the gpg
 * output, or clearSignedText): it does not know the signature. A name that is twice in the text
 * is refused.
 */
export function parseSignedSums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]{64}) {1,2}\*?(\S+)$/.exec(line.trim());
    if (!match) continue;
    if (sums.has(match[2]!) && sums.get(match[2]!) !== match[1]) {
      throw new Error(`The signed sums give 2 values for ${match[2]}`);
    }
    sums.set(match[2]!, match[1]!);
  }
  return sums;
}

/** Returns one problem text for each pin that the signed sums do not confirm. */
export function comparePins(pins: EnginePins, sums: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const [platform, entry] of Object.entries(pins.platforms)) {
    const signed = sums.get(entry.archive);
    if (signed === undefined) {
      problems.push(`${platform}: ${entry.archive} is not in the signed sums`);
    } else if (signed !== entry.sha256) {
      problems.push(
        `${platform}: ${entry.archive} has ${signed} in the signed sums, not ${entry.sha256}`,
      );
    }
  }
  return problems;
}

/** Reads the gpg status lines: true when a VALIDSIG line names the fingerprint. */
export function hasValidSignature(status: string, fingerprint: string): boolean {
  return status.split("\n").some((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== "[GNUPG:]" || parts[1] !== "VALIDSIG") return false;
    // VALIDSIG <signing key fpr> ... <primary key fpr> (the last field).
    return parts[2] === fingerprint || parts[parts.length - 1] === fingerprint;
  });
}

/**
 * Checks the one clear-signed block of the text with gpg in a temporary home that holds only the
 * given key. It returns the text that gpg verified (gpg `--output`): read only this text.
 */
export async function verifySignature(
  signedText: string,
  keyText: string,
  fingerprint: string,
  gpg = "gpg",
): Promise<string> {
  const block = signedBlock(signedText);
  const home = await mkdtemp(join(tmpdir(), "aw-gpg-"));
  try {
    await chmod(home, 0o700);
    await execa(gpg, ["--batch", "--quiet", "--homedir", home, "--import"], { input: keyText });
    const signed = join(home, "sums.asc");
    const plain = join(home, "sums.txt");
    await writeFile(signed, block);
    const result = await execa(
      gpg,
      ["--batch", "--homedir", home, "--status-fd", "1", "--output", plain, "--decrypt", signed],
      { reject: false },
    );
    // The release has a second signature of a key that is not pinned, so gpg exits with 2 (no
    // public key for it): only the VALIDSIG line of the pinned fingerprint counts.
    if (!hasValidSignature(result.stdout, fingerprint)) {
      throw new Error(`The signed sums have no valid signature of the key ${fingerprint}`);
    }
    return await readFile(plain, "utf8");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function download(url: string): Promise<Uint8Array> {
  const reply = await fetch(url, { redirect: "follow" });
  if (!reply.ok) throw new Error(`GET ${url} gave ${reply.status} ${reply.statusText}`);
  return new Uint8Array(await reply.arrayBuffer());
}

/** Downloads the signed sums and the release key, checks the signature and compares the pins. */
export async function verifyPins(pins: EnginePins, gpg = "gpg"): Promise<void> {
  const signed = Buffer.from(await download(`${pins.release_url}/${pins.signed_sums}`)).toString(
    "utf8",
  );
  const key = Buffer.from(await download(pins.release_key_url)).toString("utf8");
  const verified = await verifySignature(signed, key, pins.release_key_fingerprint, gpg);
  const problems = comparePins(pins, parseSignedSums(verified));
  if (problems.length > 0) throw new Error(`The pins do not match:\n${problems.join("\n")}`);
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

export interface FetchOptions {
  pins: EnginePins;
  platform: EnginePlatform;
  /** The folder for the binary: `<dest>/syncthing`. */
  dest: string;
  /** Bytes of the archive, for a test: no download. */
  archiveBytes?: Uint8Array;
}

/**
 * Downloads the archive of the platform, checks its sha256, extracts it and writes
 * `<dest>/syncthing`. A binary that a fetch of the same pin wrote stays (marker file).
 */
export async function fetchEngine(options: FetchOptions): Promise<string> {
  const { pins, platform, dest } = options;
  const entry = pins.platforms[platform];
  if (!entry) throw new Error(`No pin for ${platform}`);
  const binary = join(dest, "syncthing");
  const marker = join(dest, ".aw-engine-sha256");
  const known = await readFile(marker, "utf8").catch(() => "");
  if (known.trim() === entry.sha256 && (await exists(binary))) return binary;

  const bytes = options.archiveBytes ?? (await download(`${pins.release_url}/${entry.archive}`));
  checkArchive(bytes, entry.archive, entry.sha256);
  await mkdir(dest, { recursive: true });
  const work = await mkdtemp(join(dest, ".fetch-"));
  try {
    const archive = join(work, entry.archive);
    await writeFile(archive, bytes);
    // bsdtar (macOS) reads zip and tar.gz; GNU tar (Linux) reads the tar.gz of Linux.
    await execa("tar", ["-xf", archive, "-C", work]);
    const folder = entry.archive.replace(/\.(zip|tar\.gz)$/, "");
    await rename(join(work, folder, "syncthing"), binary);
    await chmod(binary, 0o755);
    await writeFile(marker, `${entry.sha256}\n`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return binary;
}

/** The cache folder of the engine for the tests of this repository. */
export function testEngineDir(pins: EnginePins, platform: EnginePlatform): string {
  return join(PLUGIN_DIR, "node_modules", ".cache", "aw-syncthing", pins.tag, platform);
}

/**
 * Fetches the engine of a platform (default: this computer) into the test cache
 * `node_modules/.cache/aw-syncthing/<tag>/<platform>/` once and returns the binary path.
 */
export async function ensureTestEngine(
  platform: EnginePlatform | null = platformKey(),
): Promise<string> {
  const pins = await loadPins();
  if (!platform) throw new Error(`AW ships no engine for ${process.platform}-${process.arch}`);
  return fetchEngine({ pins, platform, dest: testEngineDir(pins, platform) });
}
