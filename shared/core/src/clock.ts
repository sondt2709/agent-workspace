// The clock module (AGENTS.md: "Read the time only through the clock module. Tests use the fake clock.").
// No other module reads Date.now() or sets a timer for a feature delay.

export interface Clock {
  /** The wall-clock time in ms since the epoch. */
  now(): number;
  /** Waits for `ms` milliseconds of this clock. */
  sleep(ms: number): Promise<void>;
}

/** The real clock. */
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
};

interface Sleeper {
  until: number;
  order: number;
  resolve: () => void;
}

/** A clock for tests: the time moves only with `set()` and `advance()`. */
export class FakeClock implements Clock {
  #time: number;
  #sleepers: Sleeper[] = [];
  #order = 0;

  constructor(start: number | string = "2026-11-22T14:20:01.123Z") {
    this.#time = typeof start === "string" ? Date.parse(start) : start;
  }

  now(): number {
    return this.#time;
  }

  sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.#sleepers.push({ until: this.#time + ms, order: this.#order++, resolve });
    });
  }

  /** The count of sleeps that wait. */
  get pending(): number {
    return this.#sleepers.length;
  }

  /** Moves the time forward and resolves each sleep whose time passed, in time order. */
  advance(ms: number): void {
    if (ms < 0) throw new RangeError("Use set() to move the fake clock back");
    this.#time += ms;
    this.#release();
  }

  /** Sets the time, also backward (a wrong device clock). Resolves each sleep whose time passed. */
  set(time: number | string): void {
    this.#time = typeof time === "string" ? Date.parse(time) : time;
    this.#release();
  }

  #release(): void {
    const due = this.#sleepers
      .filter((s) => s.until <= this.#time)
      .sort((a, b) => a.until - b.until || a.order - b.order);
    this.#sleepers = this.#sleepers.filter((s) => s.until > this.#time);
    for (const sleeper of due) sleeper.resolve();
  }
}
