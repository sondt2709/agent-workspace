// The path of a sibling entry file (openspec gap-install, install-packaging: npm package build).
// In the repository Node runs the `.ts` sources; the npm package has only `.js` files from tsc. A
// module gives its own URL, and the entry gets the same extension.
import { fileURLToPath } from "node:url";

/** The extension of a module URL: `.ts` in the repository, `.js` in the built package. */
export function moduleExtension(moduleUrl: string): ".ts" | ".js" {
  return new URL(moduleUrl).pathname.endsWith(".ts") ? ".ts" : ".js";
}

/**
 * The absolute path of `relative` (with no extension) from the module at `moduleUrl`, with the
 * extension of that module. Example: `entryPath(import.meta.url, "../bin/awd")`.
 */
export function entryPath(moduleUrl: string, relative: string): string {
  return fileURLToPath(new URL(`${relative}${moduleExtension(moduleUrl)}`, moduleUrl));
}
