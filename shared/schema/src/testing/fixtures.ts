// Reads the shared fixture AW folder for tests (contracts/fixtures/workspace).
// Not in the package index: tests of other packages import it as `@aw/schema/testing`.
// Product code must not import it. It uses `yaml`, a dependency of @aw/schema.
import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/** The fixture AW folder: `tasks/`, `knowledge/` and `secure/`. */
export const fixtureRoot = fileURLToPath(
  new URL("../../../../contracts/fixtures/workspace", import.meta.url),
);

export const FIXTURE_TASK_ID = "01a2038e-7f00-70eb-b429-fa86d481c263";

/** Each file of the fixture folder, as a path relative to fixtureRoot with `/` separators. */
export function fixtureFiles(): string[] {
  return readdirSync(fixtureRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(fixtureRoot.length + 1))
    .map((path) => path.split("\\").join("/"))
    .sort();
}

export function readFixtureText(path: string): string {
  return readFileSync(join(fixtureRoot, path), "utf8");
}

/** The YAML documents of the fixture folder. */
export function fixtureDocuments(): { path: string; value: Record<string, unknown> }[] {
  return fixtureFiles()
    .filter((path) => path.endsWith(".yaml"))
    .map((path) => ({ path, value: parse(readFixtureText(path)) as Record<string, unknown> }));
}

/** The JSON Lines logs of the fixture folder, one entry per line. */
export function fixtureEvents(): { path: string; line: number; value: Record<string, unknown> }[] {
  return fixtureFiles()
    .filter((path) => path.endsWith(".jsonl"))
    .flatMap((path) =>
      readFixtureText(path)
        .split("\n")
        .filter((line) => line !== "")
        .map((line, index) => ({
          path,
          line: index + 1,
          value: JSON.parse(line) as Record<string, unknown>,
        })),
    );
}

/** A deep copy of a fixture value, for a test that changes it. */
export function copy<T>(value: T): T {
  return structuredClone(value);
}

/** The merge cases: `contracts/fixtures/merge/<case>/` with `case.json`, `files/` and `expected.json`. */
export const mergeCasesRoot = fileURLToPath(
  new URL("../../../../contracts/fixtures/merge", import.meta.url),
);

export interface MergeCase {
  name: string;
  description: string;
  /** The local time of the merge, ISO 8601. */
  now: string;
  /** The HLC bound in ms, when the case sets one. */
  max_skew_ms?: number;
}

/** Each merge case, sorted by name. */
export function mergeCases(): MergeCase[] {
  return readdirSync(mergeCasesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const value = JSON.parse(
        readFileSync(join(mergeCasesRoot, name, "case.json"), "utf8"),
      ) as Omit<MergeCase, "name">;
      return { name, ...value };
    });
}

/** Copies the base fixture folder to `target`, then the files of the case over it. */
export function materializeMergeCase(name: string, target: string): void {
  cpSync(fixtureRoot, target, { recursive: true });
  const files = join(mergeCasesRoot, name, "files");
  if (existsSync(files)) cpSync(files, target, { recursive: true, force: true });
}

/** The path of the expected view of a merge case. */
export function expectedPath(name: string): string {
  return join(mergeCasesRoot, name, "expected.json");
}
