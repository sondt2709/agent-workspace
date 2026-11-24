import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@aw/plugin-api", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@aw/plugin-api");
  });
});
