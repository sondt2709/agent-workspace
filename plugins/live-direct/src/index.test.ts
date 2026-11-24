import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@aw/live-direct", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@aw/live-direct");
  });
});
