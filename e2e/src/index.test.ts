import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@aw/e2e", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@aw/e2e");
  });
});
