// docs/design.md 3: the app bundles its fonts and loads none from the network. The renderer entry
// imports both Fontsource packages, their @font-face rules point only at files in the package, and
// the theme names the same families first.
import { fonts } from "@aw/ui/tokens";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const entry = join(import.meta.dirname, "../renderer/src/main.tsx");

describe("bundled fonts", () => {
  for (const [pkg, family, stack] of [
    ["@fontsource-variable/inter", "Inter Variable", fonts.sans],
    ["@fontsource-variable/geist-mono", "Geist Mono Variable", fonts.mono],
  ] as const) {
    it(`${pkg}: imported by the renderer, local files only, first in the stack`, async () => {
      expect(await readFile(entry, "utf8")).toContain(`import "${pkg}";`);
      const css = await readFile(require.resolve(`${pkg}/index.css`), "utf8");
      expect(css).toContain(`font-family: '${family}'`);
      const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]!);
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) expect(url).toMatch(/^\.\/files\/[\w-]+\.woff2$/);
      expect(stack.startsWith(`"${family}"`)).toBe(true);
    });
  }
});
