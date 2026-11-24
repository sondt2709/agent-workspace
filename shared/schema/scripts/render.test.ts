// The drift check: the generated files must match a new render of the zod schemas.
// Fix a failure with `pnpm schema:generate` and commit the result.
import { describe, expect, it } from "vitest";
import { schemaEntries } from "../src/registry.ts";
import { className, javaPattern } from "./kotlin.ts";
import { findDrift, renderAll } from "./render.ts";

describe("pnpm schema:generate", () => {
  it("renders one JSON Schema 2020-12 file per schema name", async () => {
    const files = (await renderAll()).filter((f) => f.path.startsWith("contracts/schemas/"));
    expect(files.map((f) => f.path)).toEqual(
      schemaEntries.map((e) => `contracts/schemas/${e.name}.schema.json`).sort(),
    );
    for (const file of files) {
      const json = JSON.parse(file.content) as Record<string, unknown>;
      expect(json.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    }
  });

  it("renders one Kotlin file per schema name, the event envelope and the samples", async () => {
    const files = (await renderAll()).map((f) => f.path);
    const kotlin = "android/shared/generated/kotlin/com/agentworkspace/schema";
    expect(files.filter((path) => !path.startsWith("contracts/schemas/"))).toEqual(
      [
        ...schemaEntries.map((e) =>
          e.name === "event.v1" ? `${kotlin}/EventTypesV1.kt` : `${kotlin}/${className(e.name)}.kt`,
        ),
        `${kotlin}/EventEnvelopeV1.kt`,
        "contracts/samples/schema-samples.json",
      ].sort(),
    );
  });

  it("writes a JavaScript pattern as a Java pattern with the end of input anchor", () => {
    expect(javaPattern("^[a-z]+$")).toBe("^[a-z]+\\z");
    expect(javaPattern("^$|^a$")).toBe("^\\z|^a\\z");
    expect(javaPattern("^[$]\\$")).toBe("^[$]\\$");
  });

  it("names the checks of the refines in the JSON Schema (x-aw-check)", async () => {
    const files = await renderAll();
    const event = JSON.parse(
      files.find((f) => f.path === "contracts/schemas/event.v1.schema.json")!.content,
    ) as { oneOf: { properties: Record<string, Record<string, unknown>> }[] };
    const gateOpened = event.oneOf.find((v) => v.properties.type!.const === "gate.opened")!;
    expect(gateOpened.properties.hlc!["x-aw-check"]).toBe("hlc");
    const data = gateOpened.properties.data as { properties: Record<string, { anyOf: unknown[] }> };
    expect(data.properties.file!.anyOf[0]).toMatchObject({ "x-aw-check": "relative-path" });
  });

  it("generated files are current (run `pnpm schema:generate` when this fails)", async () => {
    expect(await findDrift()).toEqual({ missing: [], stale: [], extra: [] });
  });
});
