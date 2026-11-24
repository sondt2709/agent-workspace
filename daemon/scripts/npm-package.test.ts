// The npm package build (spec install-packaging: npm package build): the closure of the workspace
// packages, the dependencies and the import rewrite.
import { describe, expect, it } from "vitest";
import {
  closure,
  isShippedSource,
  rewriteImports,
  thirdPartyDependencies,
  type WorkspacePackage,
} from "./npm-package.ts";

const pkg = (
  name: string,
  dir: string,
  dependencies: Record<string, string>,
  exports: Record<string, string> = { ".": "./src/index.ts" },
): [string, WorkspacePackage] => [name, { name, dir, manifest: { name, dependencies, exports } }];

const PACKAGES = new Map([
  pkg("@aw/daemon", "daemon", {
    "@aw/core": "workspace:*",
    "@aw/client": "workspace:*",
    zod: "4.6.7",
  }),
  pkg(
    "@aw/core",
    "shared/core",
    { "@aw/schema": "workspace:*", yaml: "2.9.1" },
    {
      ".": "./src/index.ts",
      "./clock": "./src/clock.ts",
    },
  ),
  pkg("@aw/client", "shared/client", { zod: "4.6.7", axios: "1.21.1" }),
  pkg("@aw/schema", "shared/schema", { zod: "4.6.7" }),
  pkg("@aw/ui", "shared/ui", { react: "19.3.1" }),
]);

describe("npm package", () => {
  it("takes the workspace packages that awd imports, and no other", () => {
    expect(closure("@aw/daemon", PACKAGES).map((p) => p.name)).toEqual([
      "@aw/daemon",
      "@aw/core",
      "@aw/schema",
      "@aw/client",
    ]);
  });

  it("lists each third-party dependency once with its exact version", () => {
    expect(thirdPartyDependencies(closure("@aw/daemon", PACKAGES))).toEqual({
      axios: "1.21.1",
      yaml: "2.9.1",
      zod: "4.6.7",
    });
    const clash = [...closure("@aw/daemon", PACKAGES)];
    clash.push(pkg("@aw/x", "plugins/x", { zod: "4.5.0" })[1]);
    expect(() => thirdPartyDependencies(clash)).toThrow(/zod has 2 versions/);
    expect(() => thirdPartyDependencies([pkg("@aw/y", "y", { zod: "^4.6.7" })[1]])).toThrow(
      /not an exact version/,
    );
  });

  it("rewrites each @aw import to a relative path of the built file", () => {
    const code = [
      'import { a } from "@aw/core";',
      'import { systemClock } from "@aw/core/clock";',
      'export * from "@aw/client";',
      'const m = await import("@aw/schema");',
      'import "./local.js";',
      'const name = "@aw/core is a name, not an import";',
    ].join("\n");
    const out = rewriteImports(code, "daemon/src/bin/awd.js", PACKAGES);
    expect(out).toContain('from "../../../shared/core/src/index.js"');
    expect(out).toContain('from "../../../shared/core/src/clock.js"');
    expect(out).toContain('export * from "../../../shared/client/src/index.js"');
    expect(out).toContain('import("../../../shared/schema/src/index.js")');
    expect(out).toContain('import "./local.js"');
    expect(out).toContain('"@aw/core is a name, not an import"');
    expect(() => rewriteImports('import "@aw/core/missing";', "a.js", PACKAGES)).toThrow(
      /does not export/,
    );
  });

  it("ships no test, test helper or generator file", () => {
    expect(isShippedSource("daemon/src/cli/run.ts")).toBe(true);
    expect(isShippedSource("daemon/src/cli/run.test.ts")).toBe(false);
    expect(isShippedSource("daemon/src/testing.ts")).toBe(false);
    expect(isShippedSource("plugins/agent-claude/src/testing/index.ts")).toBe(false);
    expect(isShippedSource("daemon/src/e2e/awd.e2e.test.ts")).toBe(false);
    expect(isShippedSource("daemon/src/api/openapi.ts")).toBe(false);
  });
});
