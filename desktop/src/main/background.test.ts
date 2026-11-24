import { FakeClock } from "@aw/core/clock";
import { describe, expect, it, vi } from "vitest";
import { BackgroundRefresh } from "./background.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("BackgroundRefresh", () => {
  it("gives one load for many events in the debounce time", async () => {
    const clock = new FakeClock();
    const load = vi.fn(() => Promise.resolve(1));
    const onLoaded = vi.fn();
    const refresh = new BackgroundRefresh({ clock, load, onLoaded, onError: vi.fn() });
    refresh.schedule();
    refresh.schedule();
    refresh.schedule();
    await flush();
    expect(load).not.toHaveBeenCalled();
    clock.advance(500);
    await refresh.idle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledWith(1);
  });

  it("loads again when an event comes during a load, and reports an error", async () => {
    const clock = new FakeClock();
    let release!: () => void;
    const load = vi
      .fn<() => Promise<number>>()
      .mockImplementationOnce(() => new Promise<number>((r) => (release = () => r(1))))
      .mockImplementationOnce(() => Promise.reject(new Error("unreachable")));
    const onError = vi.fn();
    const refresh = new BackgroundRefresh({ clock, load, onLoaded: vi.fn(), onError });
    refresh.schedule();
    clock.advance(500);
    await flush();
    refresh.schedule();
    release();
    await flush();
    clock.advance(500);
    await refresh.idle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("loads again for a request between the end of a load and its cleanup (devices-kb review 10)", async () => {
    const clock = new FakeClock();
    const load = vi.fn(() => Promise.resolve(1));
    let first = true;
    const refresh: BackgroundRefresh<number> = new BackgroundRefresh({
      clock,
      load,
      onLoaded: () => {
        // A `changed` event that arrives in a microtask after the load, before the loop clears.
        if (first) queueMicrotask(() => refresh.schedule());
        first = false;
      },
      onError: vi.fn(),
    });
    refresh.schedule();
    clock.advance(500);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    clock.advance(500);
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("loads nothing after stop", async () => {
    const clock = new FakeClock();
    const load = vi.fn(() => Promise.resolve(1));
    const refresh = new BackgroundRefresh({ clock, load, onLoaded: vi.fn(), onError: vi.fn() });
    refresh.schedule();
    refresh.stop();
    clock.advance(500);
    await refresh.idle();
    expect(load).not.toHaveBeenCalled();
  });
});
