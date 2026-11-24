import type { StreamMessage } from "@aw/client";
import { FakeClock } from "@aw/core/clock";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { ConnectionState } from "../shared/channels.ts";
import {
  AwConnection,
  BACKOFF_MAX_MS,
  BACKOFF_START_MS,
  SHORT_STREAM_MS,
  backoffMs,
  type ConnectionClient,
} from "./connection.ts";

describe("backoffMs", () => {
  it("doubles from 500 ms and never passes 30 s", () => {
    const full = () => 1;
    expect([1, 2, 3, 4].map((n) => backoffMs(n, full))).toEqual([500, 1000, 2000, 4000]);
    expect(backoffMs(7, full)).toBe(BACKOFF_MAX_MS);
    expect(backoffMs(50, full)).toBe(BACKOFF_MAX_MS);
  });

  it("keeps 75 % to 100 % of the wait as jitter", () => {
    expect(backoffMs(1, () => 0)).toBe(BACKOFF_START_MS * 0.75);
    expect(backoffMs(3, () => 0.5)).toBe(Math.round(2000 * 0.875));
  });
});

/** A fake awd: `down` refuses the stream; `drop()` closes the open stream. */
class FakeAwd implements ConnectionClient {
  down = false;
  /** An error that is not a network error: p-retry stops at once on it. */
  typeError = false;
  /** Each new stream closes at once. */
  flap = false;
  opens = 0;
  socket: EventEmitter | null = null;
  listener: ((message: StreamMessage) => void) | null = null;

  events(onMessage: (message: StreamMessage) => void) {
    if (this.typeError) return Promise.reject(new TypeError("Invalid URL"));
    if (this.down) return Promise.reject(new Error("awd is not reachable (ECONNREFUSED)"));
    this.opens += 1;
    const socket = new EventEmitter();
    this.socket = socket;
    this.listener = onMessage;
    if (this.flap) setImmediate(() => socket.emit("close"));
    return Promise.resolve({ socket, close: () => socket.emit("close") });
  }

  status() {
    return Promise.resolve({ version: "0.0.0", device: { slug: "macbook-pro" } });
  }

  drop() {
    this.socket?.emit("close");
  }
}

async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

function setup() {
  const awd = new FakeAwd();
  const clock = new FakeClock();
  const states: ConnectionState[] = [];
  const events: StreamMessage[] = [];
  let resyncs = 0;
  const connection = new AwConnection({
    client: awd,
    clock,
    random: () => 1,
    onState: (state) => states.push(state),
    onEvent: (message) => events.push(message),
    onResync: () => (resyncs += 1),
  });
  return { awd, clock, states, events, connection, resyncs: () => resyncs };
}

describe("AwConnection", () => {
  it("goes online, forwards events and sends resync", async () => {
    const t = setup();
    t.connection.start();
    await settle();
    expect(t.states).toEqual([{ state: "online", version: "0.0.0", device: "macbook-pro" }]);
    expect(t.resyncs()).toBe(1);
    t.awd.listener?.({ type: "hello", version: "0.0.0" });
    expect(t.events).toEqual([{ type: "hello", version: "0.0.0" }]);
    await t.connection.stop();
  });

  it("reconnects after awd restarts: offline, online, then one resync", async () => {
    const t = setup();
    t.connection.start();
    await settle();
    // The stream was open for a while (a stream that closes at once waits first: review 5).
    t.clock.advance(SHORT_STREAM_MS);
    t.awd.down = true;
    t.awd.drop();
    await settle();
    // The stream closed; the first attempt fails and waits 500 ms on the clock.
    expect(t.states.slice(1).map((s) => s.state)).toEqual(["offline", "offline"]);
    expect(t.clock.pending).toBe(1);
    t.awd.down = false;
    t.clock.advance(BACKOFF_START_MS);
    await settle();
    expect(t.states.at(-1)?.state).toBe("online");
    expect(t.resyncs()).toBe(2);
    expect(t.awd.opens).toBe(2);
    await t.connection.stop();
  });

  it("waits longer after each failed attempt, at most 30 s", async () => {
    const t = setup();
    t.awd.down = true;
    t.connection.start();
    const waits: number[] = [];
    for (let i = 0; i < 9; i++) {
      await settle();
      const last = t.states.at(-1);
      if (last?.state !== "offline" || last.retryAt === null) throw new Error("not offline");
      const wait = last.retryAt - t.clock.now();
      waits.push(wait);
      t.clock.advance(wait);
    }
    expect(waits).toEqual([500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(t.resyncs()).toBe(0);
    await t.connection.stop();
  });

  it("stops the loop and closes the stream on stop()", async () => {
    const t = setup();
    t.connection.start();
    await settle();
    await t.connection.stop();
    await settle();
    expect(t.awd.opens).toBe(1);
    expect(t.states.at(-1)?.state).toBe("online");
  });

  it("waits before it opens again when each stream closes at once (desktop-shell review 5)", async () => {
    const t = setup();
    t.awd.flap = true;
    t.connection.start();
    const waits: number[] = [];
    for (let i = 0; i < 4; i++) {
      await settle();
      const last = t.states.at(-1);
      if (last?.state !== "offline" || last.retryAt === null) throw new Error("no wait");
      const wait = last.retryAt - t.clock.now();
      waits.push(wait);
      t.clock.advance(wait);
    }
    expect(waits).toEqual([500, 1000, 2000, 4000]);
    expect(t.awd.opens).toBe(4);
    await t.connection.stop();
  });

  it("keeps the loop after an error that p-retry does not retry (desktop-shell review 9)", async () => {
    const t = setup();
    t.awd.typeError = true;
    t.connection.start();
    await settle();
    const last = t.states.at(-1);
    expect(last).toMatchObject({ state: "offline", reason: "Invalid URL" });
    t.awd.typeError = false;
    // p-retry waits in onFailedAttempt before it stops, then the loop waits again.
    for (let i = 0; i < 2; i++) {
      t.clock.advance(BACKOFF_MAX_MS);
      await settle();
    }
    expect(t.states.at(-1)?.state).toBe("online");
    await t.connection.stop();
  });
});
