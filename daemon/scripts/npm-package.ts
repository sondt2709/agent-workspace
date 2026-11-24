// The parts of the npm package build that do not touch the disk (openspec gap-install,
// install-packaging: npm package build). build.ts uses them; npm-package.test.ts tests them.
import { posix } from "node:path";

/** A workspace package: its name, its folder from the repository root and its manifest. */
export interface WorkspacePackage {
  name: string;
  /** The folder from the repository root, for example `shared/core`. */
  dir: string;
  manifest: {
    name: string;
    version?: string;
    dependencies?: Record<string, string>;
    exports?: Record<string, string> | string;
  };
}

/** The workspace packages that `root` imports at run time, `root` first. */
export function closure(
  root: string,
  packages: ReadonlyMap<string, WorkspacePackage>,
): WorkspacePackage[] {
  const seen = new Map<string, WorkspacePackage>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    const pkg = packages.get(name);
    if (!pkg) throw new Error(`The workspace package ${name} does not exist`);
    seen.set(name, pkg);
    for (const [dep, range] of Object.entries(pkg.manifest.dependencies ?? {})) {
      if (range.startsWith("workspace:")) visit(dep);
    }
  };
  visit(root);
  return [...seen.values()];
}

/**
 * The third-party runtime dependencies of the packages with their exact versions. Two different
 * versions of one dependency are an error: the package has one `node_modules`.
 */
export function thirdPartyDependencies(packages: WorkspacePackage[]): Record<string, string> {
  const result = new Map<string, { version: string; from: string }>();
  for (const pkg of packages) {
    for (const [dep, range] of Object.entries(pkg.manifest.dependencies ?? {})) {
      if (range.startsWith("workspace:")) continue;
      if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(range)) {
        throw new Error(`${pkg.name} names ${dep} with ${range}, not an exact version`);
      }
      const known = result.get(dep);
      if (known && known.version !== range) {
        throw new Error(
          `${dep} has 2 versions: ${known.version} (${known.from}) and ${range} (${pkg.name})`,
        );
      }
      result.set(dep, { version: range, from: pkg.name });
    }
  }
  return Object.fromEntries(
    [...result.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.version]),
  );
}

/** The built file (from the repository root) of an `@aw/...` import specifier. */
export function resolveWorkspaceImport(
  specifier: string,
  packages: ReadonlyMap<string, WorkspacePackage>,
): string {
  const match = /^(@aw\/[a-z0-9-]+)(\/.*)?$/.exec(specifier);
  if (!match) throw new Error(`${specifier} is not an @aw import`);
  const pkg = packages.get(match[1]!);
  if (!pkg) throw new Error(`No workspace package for ${specifier}`);
  const sub = `.${match[2] ?? ""}`;
  const exportsField = pkg.manifest.exports;
  const target =
    typeof exportsField === "string"
      ? sub === "."
        ? exportsField
        : undefined
      : exportsField?.[sub];
  if (!target) throw new Error(`${pkg.name} does not export ${sub} (${specifier})`);
  return posix.join(pkg.dir, target.replace(/\.ts$/, ".js"));
}

const IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(@aw\/[^"']+)\2/g;

/**
 * Rewrites each `@aw/...` import of a built file to a relative path. `file` is the path of the
 * built file from the package root. An `@aw` import that the map does not know is an error.
 */
export function rewriteImports(
  code: string,
  file: string,
  packages: ReadonlyMap<string, WorkspacePackage>,
): string {
  return code.replace(IMPORT, (_all, head: string, quote: string, specifier: string) => {
    const target = resolveWorkspaceImport(specifier, packages);
    let relative = posix.relative(posix.dirname(file), target);
    if (!relative.startsWith(".")) relative = `./${relative}`;
    return `${head}${quote}${relative}${quote}`;
  });
}

/** True for a source file that the package does not ship: tests, test helpers and scripts. */
export function isShippedSource(path: string): boolean {
  if (!path.endsWith(".ts") || path.endsWith(".d.ts")) return false;
  if (/\.test\.ts$/.test(path)) return false;
  const parts = path.split("/");
  if (parts.includes("testing") || parts.includes("e2e") || parts.includes("fixtures")) {
    return false;
  }
  if (parts.at(-1) === "testing.ts") return false;
  // The OpenAPI generator imports prettier (a dev tool): only `pnpm api:generate` uses it.
  if (path === "daemon/src/api/openapi.ts") return false;
  return true;
}

/** The manifest of the npm package. */
export function packageManifest(input: {
  name: string;
  version: string;
  dependencies: Record<string, string>;
}) {
  return {
    name: input.name,
    version: input.version,
    description:
      "Agent Workspace: awd and the aw CLI. Manage the work of AI coding agents on your own computers.",
    license: "MIT",
    type: "module",
    bin: { aw: "daemon/src/bin/aw.js", awd: "daemon/src/bin/awd.js" },
    engines: { node: ">=26.13" },
    os: ["darwin", "linux"],
    dependencies: input.dependencies,
  };
}
