// docs/design.md 12.4: a Typography `color` prop takes only the palette paths that the theme maps
// (MUI 9 has no system props). This test reads each renderer component and checks each path.
import { typographyColors } from "@aw/ui";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const components = join(import.meta.dirname, "../renderer/src/components");

describe("palette paths in color props", () => {
  it("uses only the paths that createAppTheme() maps", async () => {
    const used = new Set<string>();
    for (const name of await readdir(components, { recursive: true })) {
      if (!name.endsWith(".tsx") || name.includes(".test.")) continue;
      const text = await readFile(join(components, name), "utf8");
      for (const match of text.matchAll(/\scolor="([a-zA-Z]+\.[a-zA-Z0-9]+)"/g)) {
        used.add(match[1]!);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    const supported = new Set(typographyColors());
    expect([...used].filter((path) => !supported.has(path))).toEqual([]);
  });
});
