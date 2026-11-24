// The credential values of a session (docs/workflow.md 4.8.5, task-model decision §4.3): the
// implementing device gives the values to the session as files with mode 0600 when the session
// starts, and again at each resume. The values come from a CredentialProvider: awd gives the
// credential service (`CredentialService.sessionValues`), which also puts each value in the
// redaction of the events before the session gets it.
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CredentialProvider {
  /** The values of the names that this device can open. A missing name has no value. */
  values(workspace: string, names: string[]): Promise<Map<string, string>>;
}

/** The provider of a session manager with no credential service (tests). */
export const noCredentials: CredentialProvider = {
  values: () => Promise.resolve(new Map()),
};

/**
 * Writes each value to `<dir>/<name>` (mode 0600, folder 0700) and removes the files of names that
 * have no value now. Returns the names with no value.
 */
export async function writeCredentialFiles(
  dir: string,
  names: string[],
  values: Map<string, string>,
): Promise<string[]> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const missing: string[] = [];
  for (const name of names) {
    const value = values.get(name);
    if (value === undefined) {
      missing.push(name);
      continue;
    }
    // The name is an entryName (lower-case letters, digits, '-', '_', '.'), never a path.
    await writeFile(join(dir, name), value, { mode: 0o600 });
  }
  return missing;
}
