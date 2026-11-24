import { describe, expect, it } from "vitest";
import { FakeClock, systemClock } from "./clock.ts";

describe("FakeClock", () => {
  it("starts at the given time and moves only on advance or set", () => {
    const clock = new FakeClock("2026-11-22T14:20:01.123Z");
    expect(new Date(clock.now()).toISOString()).toBe("2026-11-22T14:20:01.123Z");
    clock.advance(1000);
    expect(new Date(clock.now()).toISOString()).toBe("2026-11-22T14:20:02.123Z");
    clock.set("2026-11-22T14:15:00.000Z");
    expect(new Date(clock.now()).toISOString()).toBe("2026-11-22T14:15:00.000Z");
  });

  it("resolves a sleep only when its time passed, with no real wait", async () => {
    const clock = new FakeClock();
    const done: string[] = [];
    const long = clock.sleep(30_000).then(() => done.push("30 s"));
    const short = clock.sleep(10_000).then(() => done.push("10 s"));
    clock.advance(9_999);
    await Promise.resolve();
    expect(done).toEqual([]);
    expect(clock.pending).toBe(2);
    clock.advance(20_001);
    await Promise.all([long, short]);
    expect(done).toEqual(["10 s", "30 s"]);
    expect(clock.pending).toBe(0);
  });

  it("refuses to move back with advance", () => {
    expect(() => new FakeClock().advance(-1)).toThrow(RangeError);
  });
});

describe("systemClock", () => {
  it("reads the real time", () => {
    const before = Date.now();
    const now = systemClock.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now - before).toBeLessThan(1000);
  });
});
