// contracts/openapi.yaml is generated from the route schemas and cannot drift (spec local-api: OpenAPI file).
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { API_YAML_PATH, renderOpenApi } from "./openapi.ts";

describe("contracts/openapi.yaml", () => {
  it("equals the generated text (run pnpm api:generate after a route change)", async () => {
    const { text } = await renderOpenApi();
    const file = await readFile(API_YAML_PATH, "utf8");
    expect(file, "contracts/openapi.yaml is stale: run pnpm api:generate").toBe(text);
  });

  it("has each route of the app, and each path of the file is a route", async () => {
    const { text, routes } = await renderOpenApi();
    const document = parse(text) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
    };
    expect(document.openapi).toBe("3.1.0");
    const inFile = Object.entries(document.paths)
      .flatMap(([path, operations]) =>
        Object.keys(operations).map((m) => `${m.toUpperCase()} ${path}`),
      )
      .sort();
    const inApp = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(inFile).toEqual(inApp);
    expect(inApp).toContain("GET /v1/events");
    expect(inApp.length).toBeGreaterThanOrEqual(19);
  });
});
