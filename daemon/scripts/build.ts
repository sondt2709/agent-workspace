// The npm package of awd and aw (openspec gap-install, install-packaging: npm package build;
// docs/tech-stack.md: "`tsc` builds awd and `aw`"). Node does not strip types in node_modules, so
// the package holds JS only:
//   node scripts/build.ts [--out <folder>] [--link-deps]
// 1. tsc emits each shipped source of @aw/daemon and of its workspace packages into the folder, in
//    the layout of the repository, so each import.meta.url path still works.
// 2. Each `@aw/...` import becomes a relative path (the export map of the package).
// 3. The script copies the files that the code reads (contracts/schemas, the engine pins, the
//    Claude Code plugin, bin/aw-launch, LICENSE, THIRD_PARTY_NOTICES) and writes package.json.
// --link-deps links the third-party packages from the pnpm store into <folder>/node_modules, so the
// checks can run the built aw with no npm install.
import { execa } from "execa";
import {
  chmod,
  cp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  closure,
  isShippedSource,
  packageManifest,
  rewriteImports,
  thirdPartyDependencies,
  type WorkspacePackage,
} from "./npm-package.ts";

/** The npm name. The release pipeline (task release-pipeline) can change it. */
export const NPM_NAME = "agent-workspace";

const DAEMON = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(DAEMON, "..");
const PACKAGE_DIRS = ["daemon", "shared", "plugins"];

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

async function workspacePackages(): Promise<Map<string, WorkspacePackage>> {
  const packages = new Map<string, WorkspacePackage>();
  const dirs = ["daemon"];
  for (const parent of PACKAGE_DIRS.slice(1)) {
    for (const entry of await readdir(join(ROOT, parent), { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(`${parent}/${entry.name}`);
    }
  }
  for (const dir of dirs) {
    const text = await readFile(join(ROOT, dir, "package.json"), "utf8").catch(() => null);
    if (text === null) continue;
    const manifest = JSON.parse(text) as WorkspacePackage["manifest"];
    packages.set(manifest.name, { name: manifest.name, dir, manifest });
  }
  return packages;
}

async function sources(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (folder: string) => {
    for (const entry of await readdir(join(ROOT, folder), { withFileTypes: true })) {
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") await walk(path);
      } else if (isShippedSource(path)) {
        found.push(path);
      }
    }
  };
  await walk(`${dir}/src`);
  return found;
}

async function emit(out: string, files: string[]): Promise<void> {
  const config = join(out, "..", ".tsconfig.npm.json");
  const base = createRequire(join(DAEMON, "package.json")).resolve("@aw/config/tsconfig.base.json");
  await writeFile(
    config,
    JSON.stringify(
      {
        extends: base,
        compilerOptions: {
          rootDir: ROOT,
          outDir: out,
          noEmit: false,
          noCheck: true,
          declaration: false,
          sourceMap: false,
          types: ["node"],
          typeRoots: [join(DAEMON, "node_modules", "@types")],
        },
        files: files.map((f) => join(ROOT, f)),
      },
      null,
      2,
    ),
  );
  const tsc = createRequire(join(DAEMON, "package.json")).resolve("typescript/bin/tsc");
  await execa(process.execPath, [tsc, "-p", config], { stdio: "inherit" });
  await rm(config);
}

async function builtFiles(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".js"))
      found.push(join(entry.parentPath, entry.name));
  }
  return found;
}

async function linkDependencies(
  out: string,
  packages: WorkspacePackage[],
  dependencies: Record<string, string>,
): Promise<void> {
  for (const dep of Object.keys(dependencies)) {
    const owner = packages.find((p) => p.manifest.dependencies?.[dep] !== undefined)!;
    const source = await realpath(join(ROOT, owner.dir, "node_modules", dep));
    const target = join(out, "node_modules", dep);
    await mkdir(dirname(target), { recursive: true });
    await symlink(source, target, "dir");
  }
}

export async function build(out: string, link: boolean): Promise<string> {
  const all = await workspacePackages();
  const shipped = closure("@aw/daemon", all);
  const daemon = shipped[0]!;
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  // 1. tsc emit.
  const files = (await Promise.all(shipped.map((p) => sources(p.dir)))).flat();
  await emit(out, files);

  // 2. Relative imports.
  for (const file of await builtFiles(out)) {
    const path = relative(out, file).split(sep).join("/");
    const code = await readFile(file, "utf8");
    const rewritten = rewriteImports(code, path, all);
    if (rewritten !== code) await writeFile(file, rewritten);
  }

  // 3. The files that the code reads, and the manifests.
  const copy = (from: string, to = from) =>
    cp(join(ROOT, from), join(out, to), { recursive: true });
  await copy("contracts/schemas");
  await copy("plugins/sync-syncthing/engine/engine.json");
  await copy("plugins/agent-claude/plugin");
  await copy("daemon/bin/aw-launch");
  await copy("LICENSE");
  await copy("THIRD_PARTY_NOTICES");
  const version = daemon.manifest.version ?? "0.0.0";
  // version.ts reads daemon/package.json.
  await writeFile(
    join(out, "daemon", "package.json"),
    `${JSON.stringify({ name: daemon.name, version, private: true, type: "module" }, null, 2)}\n`,
  );
  const dependencies = thirdPartyDependencies(shipped);
  await writeFile(
    join(out, "package.json"),
    `${JSON.stringify(packageManifest({ name: NPM_NAME, version, dependencies }), null, 2)}\n`,
  );
  for (const bin of ["aw", "awd", "aw-hook", "aw-statusline", "aw-launch"]) {
    await chmod(join(out, "daemon", "src", "bin", `${bin}.js`), 0o755);
  }
  await chmod(join(out, "daemon", "bin", "aw-launch"), 0o755);
  if (link) await linkDependencies(out, shipped, dependencies);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = resolve(option(args, "--out") ?? join(DAEMON, "dist", "npm"));
  build(out, args.includes("--link-deps"))
    .then((folder) => process.stdout.write(`Wrote the npm package folder ${folder}\n`))
    .catch((error: unknown) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exit(1);
    });
}
