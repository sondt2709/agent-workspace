// Checks the rules of each workspace manifest (docs/engineering-rules.md 4.4 and 4.5).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// The packages of docs/decisions/2026-11-23-repo-layout.md that phase 1 starts with.
const requiredFolders = [
  "daemon",
  "desktop",
  "shared/config",
  "shared/schema",
  "shared/core",
  "shared/plugin-api",
  "shared/client",
  "shared/ui",
  "plugins/agent-claude",
  "plugins/host-tmux",
  "plugins/host-orca",
  "plugins/sync-syncthing",
  "plugins/kb-files",
  "plugins/push-webpush",
  "plugins/live-direct",
  "e2e",
  "scripts",
];

// Each package runs its own checks: the root Taskfile and the root scripts call these scripts.
const requiredScripts = ["format", "format:check", "lint", "typecheck", "test"];

interface Manifest {
  name?: unknown;
  version?: unknown;
  private?: unknown;
  type?: unknown;
  scripts?: Record<string, unknown>;
  dependencies?: unknown;
  devDependencies?: unknown;
}

function readManifest(folder: string): Manifest {
  return JSON.parse(readFileSync(join(root, folder, "package.json"), "utf8")) as Manifest;
}

// Each folder in shared/ and plugins/ that has a package.json, and the one-package folders.
// A folder with no package.json (for example the Gradle project android/) is not a pnpm package.
function workspaceFolders(): string[] {
  const folders = ["shared", "plugins"].flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${group}/${entry.name}`),
  );
  folders.push("daemon", "desktop", "e2e", "scripts");
  return folders.filter((folder) => existsSync(join(root, folder, "package.json")));
}

function expectedName(folder: string): string {
  return `@aw/${folder.split("/").at(-1)}`;
}

describe("workspace manifests", () => {
  it("has a package in each required folder", () => {
    expect(workspaceFolders()).toEqual(expect.arrayContaining(requiredFolders));
  });

  it.each(workspaceFolders())("%s follows the manifest rules", (folder) => {
    const manifest = readManifest(folder);
    expect(manifest.name).toBe(expectedName(folder));
    expect(manifest.version).toBe("0.0.0");
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe("module");
    const missing = requiredScripts.filter((name) => typeof manifest.scripts?.[name] !== "string");
    expect(missing, `${folder}/package.json has no script`).toEqual([]);
  });

  it("keeps the root version at 0.0.0", () => {
    expect(readManifest(".").version).toBe("0.0.0");
  });

  it("keeps the root manifest free of dependencies (the root is not a project)", () => {
    const manifest = readManifest(".");
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
  });
});
