// `pnpm schema:generate`: writes the generated files of each target (docs/phase-1.md 3.4).
// Node 24 runs this file with type stripping. CI runs it, then fails on a git diff.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { renderAll, repoRoot, targets } from "./render.ts";

const files = await renderAll();
for (const target of targets) {
  // Each target owns its folder, so a removed schema also removes its file.
  await rm(join(repoRoot, target.dir), { recursive: true, force: true });
}
for (const file of files) {
  const path = join(repoRoot, file.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, file.content);
}
console.log(`Wrote ${files.length} files to ${targets.map((t) => t.dir).join(", ")}/.`);
