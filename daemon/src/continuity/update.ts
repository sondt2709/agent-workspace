// Self-update without killing sessions (docs/architecture.md 4.6.11, design of add-continuity
// decision 18): a signed release tarball is unpacked to `~/.aw/versions/<version>/`, and the
// `current` link switches with a rename. tmux and the sessions are never touched: the new awd
// reconciles them at its start. The release pipeline that signs the tarballs comes later.
import { execa } from "execa";
import { createHash, createPublicKey, verify } from "node:crypto";
import { lstat, mkdir, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The failed starts before the launcher goes back to the previous version. */
export const MAX_FAILED_STARTS = 3;
/** awd counts as started after it was ready this long. */
export const HEALTHY_AFTER_MS = 60_000;

export const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * The update state is 2 links and 1 file, so the launcher (POSIX sh) can read it: `current` and
 * `previous` point at version folders, and `failed-starts` holds the count of starts that did not
 * reach the healthy time.
 */
export interface UpdateState {
  current: string | null;
  previous: string | null;
  failed_starts: number;
}

export interface VersionPaths {
  root: string;
  current: string;
  previous: string;
  failedStarts: string;
}

export function versionPaths(home: string): VersionPaths {
  const root = join(home, "versions");
  return {
    root,
    current: join(root, "current"),
    previous: join(root, "previous"),
    failedStarts: join(root, "failed-starts"),
  };
}

async function linkTarget(path: string): Promise<string | null> {
  try {
    if (!(await lstat(path)).isSymbolicLink()) return null;
    return await readlink(path);
  } catch {
    return null;
  }
}

export async function readUpdateState(paths: VersionPaths): Promise<UpdateState> {
  const count = Number.parseInt(await readFile(paths.failedStarts, "utf8").catch(() => "0"), 10);
  return {
    current: await linkTarget(paths.current),
    previous: await linkTarget(paths.previous),
    failed_starts: Number.isFinite(count) && count > 0 ? count : 0,
  };
}

async function writeCount(paths: VersionPaths, count: number): Promise<void> {
  const temp = `${paths.failedStarts}.${process.pid}.tmp`;
  await writeFile(temp, `${count}\n`, { mode: 0o600 });
  await rename(temp, paths.failedStarts);
}

/**
 * True when `signature` (base64, 64 bytes) is the Ed25519 signature of the sha256 of the tarball
 * by the release key (`publicKey`: 32 raw bytes, base64).
 */
export function verifyRelease(tarball: Buffer, signature: string, publicKey: string): boolean {
  try {
    const raw = Buffer.from(publicKey, "base64");
    const sig = Buffer.from(signature.trim(), "base64");
    if (raw.length !== 32 || sig.length !== 64) return false;
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") },
      format: "jwk",
    });
    const digest = createHash("sha256").update(tarball).digest();
    return verify(null, digest, key, sig);
  } catch {
    return false;
  }
}

/** Points a link (`current` or `previous`) at a version folder with an atomic rename. */
export async function switchLink(link: string, version: string): Promise<void> {
  const temp = `${link}.${process.pid}.tmp`;
  await rm(temp, { force: true });
  await symlink(version, temp);
  await rename(temp, link);
}

export interface InstallInput {
  home: string;
  version: string;
  tarball: string;
  signatureFile: string;
  publicKey: string;
}

/**
 * Checks the signature, unpacks the tarball to `versions/<version>/` and switches `current`. The
 * caller then stops the sync engine and exits; the service manager starts the new version, which
 * reconciles the sessions (4.6.3).
 */
export async function installRelease(input: InstallInput): Promise<UpdateState> {
  if (!VERSION_RE.test(input.version)) throw new Error(`Not a version: ${input.version}`);
  const paths = versionPaths(input.home);
  const tarball = await readFile(input.tarball);
  const signature = await readFile(input.signatureFile, "utf8");
  if (!verifyRelease(tarball, signature, input.publicKey)) {
    throw new Error(`The signature of ${input.tarball} does not match the release key`);
  }
  // The running version is never unpacked again: a second install of it would remove the folder
  // of the running awd (review continuity low 6).
  if ((await readUpdateState(paths)).current === input.version) return readUpdateState(paths);
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  const target = join(paths.root, input.version);
  const staging = `${target}.${process.pid}.partial`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true, mode: 0o755 });
  // tar reads the checked bytes on stdin, never the file again: a file that changed after the
  // check is not unpacked (review continuity low 5).
  const result = await execa("tar", ["-xzf", "-", "-C", staging, "--no-same-owner"], {
    reject: false,
    input: tarball,
  });
  if (result.exitCode !== 0) {
    await rm(staging, { recursive: true, force: true });
    throw new Error(`tar failed: ${String(result.stderr ?? "").trim()}`);
  }
  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
  const before = await readUpdateState(paths);
  if (before.current !== null && before.current !== input.version) {
    await switchLink(paths.previous, before.current);
  }
  await writeCount(paths, 0);
  await switchLink(paths.current, input.version);
  return readUpdateState(paths);
}

/** awd was ready for HEALTHY_AFTER_MS: the start of this version counts as good. */
export async function markStarted(home: string): Promise<void> {
  const paths = versionPaths(home);
  const state = await readUpdateState(paths);
  if (state.failed_starts === 0) return;
  await writeCount(paths, 0);
}

/**
 * The decision of the launcher before a start (the same rule as `launcherScript`): after
 * MAX_FAILED_STARTS failed starts, go back to the previous version; then count this start.
 */
export function startDecision(state: UpdateState): { state: UpdateState; rollback: boolean } {
  if (
    state.failed_starts >= MAX_FAILED_STARTS &&
    state.previous !== null &&
    state.previous !== state.current
  ) {
    return {
      state: { current: state.previous, previous: state.current, failed_starts: 1 },
      rollback: true,
    };
  }
  return { state: { ...state, failed_starts: state.failed_starts + 1 }, rollback: false };
}
