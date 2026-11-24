// Test helpers of @aw/host-orca: the fake Orca CLI and the captured replies.
import { readFileSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The fake Orca CLI for `AW_ORCA` (src/testing/fake-orca.ts). */
export const FAKE_ORCA = fileURLToPath(new URL("../../testing/bin/orca", import.meta.url));

/** A captured reply of `orca-ide` 1.4.257 (fixtures/orca-1.4.257/<name>). */
export function capturedReply(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../fixtures/orca-1.4.257/${name}`, import.meta.url)),
    "utf8",
  );
}

/**
 * A wrapper of the fake Orca CLI with its environment, for `AW_ORCA` (the host passes the
 * environment of awd to the CLI, as with the real Orca).
 */
export async function fakeOrcaWrapper(options: {
  dir: string;
  state: string;
  tmux: string;
  socket: string;
  version?: string;
}): Promise<string> {
  await mkdir(options.dir, { recursive: true });
  const path = join(options.dir, "orca");
  const lines = [
    "#!/bin/sh",
    `export FAKE_ORCA_STATE='${options.state}'`,
    `export FAKE_ORCA_TMUX='${options.tmux}'`,
    `export FAKE_ORCA_SOCKET='${options.socket}'`,
    `export FAKE_ORCA_NODE='${process.execPath}'`,
    ...(options.version ? [`export FAKE_ORCA_VERSION='${options.version}'`] : []),
    `exec '${FAKE_ORCA}' "$@"`,
    "",
  ];
  await writeFile(path, lines.join("\n"));
  await chmod(path, 0o755);
  return path;
}
