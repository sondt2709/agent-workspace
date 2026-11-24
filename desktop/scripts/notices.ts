// Writes out/THIRD_PARTY_NOTICES of the desktop app (openspec gap-install, install-packaging:
// third-party notices): the repository file (Syncthing), then each JavaScript package of the app
// with its license text, from `pnpm licenses list --prod --json`. Run after electron-vite build:
//   node scripts/notices.ts
import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/** One package of `pnpm licenses list --json`. */
export interface LicenseEntry {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
  homepage?: string;
}

/** A package with the text of its license file (null when the package has none). */
export interface Notice {
  name: string;
  versions: string[];
  license: string;
  homepage: string | null;
  text: string | null;
}

/** The workspace packages are AW code: no notice. */
export function thirdParty(report: Record<string, LicenseEntry[]>): LicenseEntry[] {
  return Object.values(report)
    .flat()
    .filter((entry) => !entry.name.startsWith("@aw/"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const LINE = "-".repeat(80);

/** The notices text: the repository file, then one section per package. */
export function renderNotices(base: string, notices: Notice[]): string {
  const sections = notices.map((notice) =>
    [
      LINE,
      `${notice.name} ${notice.versions.join(", ")}`,
      LINE,
      "",
      `License: ${notice.license}`,
      ...(notice.homepage ? [`Home page: ${notice.homepage}`] : []),
      "",
      notice.text?.trimEnd() ?? "The package has no license file. See its home page.",
      "",
    ].join("\n"),
  );
  return [
    base.trimEnd(),
    "",
    LINE,
    "JavaScript packages in the desktop app",
    LINE,
    "",
    ...sections,
  ].join("\n");
}

/** The text of the license file of a package folder, or null. */
export async function licenseText(folder: string): Promise<string | null> {
  const names = await readdir(folder).catch(() => []);
  const file = names.find((name) => /^licen[cs]e(\.(md|txt))?$/i.test(name));
  return file ? readFile(join(folder, file), "utf8") : null;
}

async function main(): Promise<void> {
  const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
  const base = await readFile(join(desktop, "..", "THIRD_PARTY_NOTICES"), "utf8");
  const { stdout } = await promisify(execFile)("pnpm", ["licenses", "list", "--prod", "--json"], {
    cwd: desktop,
    maxBuffer: 64 * 1024 * 1024,
  });
  const entries = thirdParty(JSON.parse(stdout) as Record<string, LicenseEntry[]>);
  const notices: Notice[] = [];
  for (const entry of entries) {
    notices.push({
      name: entry.name,
      versions: entry.versions,
      license: entry.license,
      homepage: entry.homepage ?? null,
      text: entry.paths[0] ? await licenseText(entry.paths[0]) : null,
    });
  }
  const out = join(desktop, "out", "THIRD_PARTY_NOTICES");
  await writeFile(out, `${renderNotices(base, notices)}\n`);
  process.stdout.write(`Wrote ${out} with ${notices.length} packages\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  });
}
