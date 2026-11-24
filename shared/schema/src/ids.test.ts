import { describe, expect, it } from "vitest";
import { uuidv7 } from "./common.ts";
import { idTime, newId } from "./ids.ts";

describe("newId", () => {
  it("makes a UUIDv7 with the time of the source", () => {
    const at = Date.parse("2026-11-22T14:20:01.123Z");
    const id = newId({ now: () => at });
    expect(uuidv7.safeParse(id).success).toBe(true);
    expect(id[14]).toBe("7");
    expect(idTime(id)).toBe(at);
  });

  it("makes ids that sort by time", () => {
    let at = Date.parse("2026-11-22T14:20:01.123Z");
    const ids = Array.from({ length: 50 }, () => newId({ now: () => (at += 1) }));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("makes ids in the same ms that sort in the order they were made", () => {
    const at = Date.parse("2026-11-22T14:20:01.123Z");
    const ids = Array.from({ length: 1000 }, () => newId({ now: () => at }));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => idTime(id) === at && uuidv7.safeParse(id).success)).toBe(true);
  });
});
