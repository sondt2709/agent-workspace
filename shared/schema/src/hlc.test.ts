import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hlcText } from "./common.ts";
import {
  compareEventOrder,
  formatHlc,
  HlcFormatError,
  HybridLogicalClock,
  isHlc,
  parseHlc,
} from "./hlc.ts";

interface Step {
  op: "now" | "observe" | "receive";
  physical_ms?: number;
  remote?: string;
  expect?: string;
}

interface Vectors {
  format: { time_ms: number; counter: number; text: string }[];
  invalid: string[];
  order: { hlc: string; dev: string }[];
  sequences: { name: string; start: string | null; steps: Step[] }[];
}

const vectors = JSON.parse(
  readFileSync(new URL("../../../contracts/test-vectors/hlc.json", import.meta.url), "utf8"),
) as Vectors;

/** A time source that the test sets before each step. */
class StepTime {
  value = 0;
  now(): number {
    return this.value;
  }
}

describe("HLC test vectors", () => {
  it.each(vectors.format)("formats and parses $text", ({ time_ms, counter, text }) => {
    expect(formatHlc({ time: time_ms, counter })).toBe(text);
    expect(parseHlc(text)).toEqual({ time: time_ms, counter });
  });

  it.each(vectors.invalid)("rejects %j", (text) => {
    expect(isHlc(text)).toBe(false);
    expect(() => parseHlc(text)).toThrow(HlcFormatError);
    // The zod field of the files rejects it too, also a date that does not exist.
    expect(hlcText.safeParse(text).success).toBe(false);
  });

  it("sorts events by the HLC, then by the device slug", () => {
    const shuffled = [...vectors.order].reverse();
    shuffled.push(shuffled.shift()!);
    expect(shuffled.sort(compareEventOrder)).toEqual(vectors.order);
  });

  describe.each(vectors.sequences)("sequence: $name", ({ start, steps }) => {
    it("gives the expected HLC at each step", () => {
      const time = new StepTime();
      const clock = new HybridLogicalClock(time, start);
      for (const step of steps) {
        if (step.physical_ms !== undefined) time.value = step.physical_ms;
        if (step.op === "observe") {
          clock.observe(step.remote!);
          continue;
        }
        const value = step.op === "now" ? clock.now() : clock.receive(step.remote!);
        expect(value).toBe(step.expect);
      }
    });
  });
});

describe("HybridLogicalClock", () => {
  it("keeps each new HLC above each HLC that it made or read", () => {
    const time = new StepTime();
    const clock = new HybridLogicalClock(time);
    const seen: string[] = [];
    // A random walk of the device clock with skew and remote events.
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    let highest = "";
    for (let i = 0; i < 2000; i++) {
      time.value = 1795357201123 + Math.floor((random() - 0.5) * 600_000);
      let value: string;
      if (random() < 0.3) {
        const remote = formatHlc({
          time: time.value + Math.floor((random() - 0.3) * 900_000),
          counter: Math.floor(random() * 50),
        });
        value = clock.receive(remote);
        expect(value > remote).toBe(true);
        if (remote > highest) highest = remote;
      } else {
        value = clock.now();
      }
      expect(value > highest).toBe(true);
      highest = value;
      seen.push(value);
    }
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("starts from a stored value", () => {
    const clock = new HybridLogicalClock({ now: () => 0 }, "2026-11-22T14:20:01.123Z#0041");
    expect(clock.peek()).toBe("2026-11-22T14:20:01.123Z#0041");
    expect(clock.now()).toBe("2026-11-22T14:20:01.123Z#0042");
  });

  it("refuses a counter out of range", () => {
    expect(() => formatHlc({ time: 0, counter: 10000 })).toThrow(RangeError);
  });
});
