// The one awd connection of the main process (docs/tech-stack.md 1.4 "Connection to awd", 2.3).
// It opens the event stream on the awd socket, forwards each message, and reconnects with an
// exponential backoff with jitter. The waits go through the injected clock, so tests do not wait.
import type { StreamMessage } from "@aw/client";
import pRetry, { AbortError } from "p-retry";
import type { ConnectionState } from "../shared/channels.ts";

/** The first wait after a failure, and the longest wait. */
export const BACKOFF_START_MS = 500;
export const BACKOFF_MAX_MS = 30_000;
/** A stream that closes sooner than this counts as a failed attempt for the backoff. */
export const SHORT_STREAM_MS = 5_000;

/**
 * The wait before attempt `attempt + 1` after `attempt` failures (1 or more): 500 ms × 2^(n-1), at
 * most 30 s, then a jitter that keeps 75 % to 100 % of it.
 */
export function backoffMs(attempt: number, random: () => number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.75 + 0.25 * random()));
}

/** The parts of `AwClient` that the connection uses. */
export interface ConnectionClient {
  events(onMessage: (message: StreamMessage) => void): Promise<{
    close(): void;
    socket: { once(event: "close", listener: () => void): unknown };
  }>;
  status(): Promise<{ version: string; device: { slug: string } }>;
}

export interface ConnectionOptions {
  client: ConnectionClient;
  /** The clock module: the current time and a wait. */
  clock: { now(): number; sleep(ms: number): Promise<void> };
  random?: () => number;
  onState(state: ConnectionState): void;
  onEvent(message: StreamMessage): void;
  /** Called each time the connection is online again: the window loads its state again. */
  onResync(): void;
}

export class AwConnection {
  readonly #options: ConnectionOptions;
  #state: ConnectionState = { state: "connecting" };
  #controller = new AbortController();
  #stream: { close(): void } | null = null;
  #running: Promise<void> | null = null;

  constructor(options: ConnectionOptions) {
    this.#options = options;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  /** Starts the connect loop. It runs until `stop()`. */
  start(): void {
    this.#running ??= this.#loop();
  }

  async stop(): Promise<void> {
    this.#controller.abort();
    this.#stream?.close();
    await this.#running?.catch(() => undefined);
  }

  #set(state: ConnectionState): void {
    this.#state = state;
    this.#options.onState(state);
  }

  async #loop(): Promise<void> {
    const { signal } = this.#controller;
    const random = this.#options.random ?? Math.random;
    const { clock } = this.#options;
    /** The streams in a row that closed within SHORT_STREAM_MS, and the errors that ended pRetry. */
    let short = 0;
    const wait = async (reason: string) => {
      short += 1;
      const ms = backoffMs(short, random);
      this.#set({ state: "offline", reason, attempt: short, retryAt: clock.now() + ms });
      await clock.sleep(ms);
    };
    while (!signal.aborted) {
      let open: { closed: Promise<void> };
      try {
        open = await pRetry(() => this.#open(), {
          retries: Number.POSITIVE_INFINITY,
          minTimeout: 0,
          maxTimeout: 0,
          signal,
          onFailedAttempt: async ({ error, attemptNumber }) => {
            if (signal.aborted) return;
            const ms = backoffMs(attemptNumber, random);
            this.#set({
              state: "offline",
              reason: error.message,
              attempt: attemptNumber,
              retryAt: clock.now() + ms,
            });
            await clock.sleep(ms);
          },
        });
      } catch (error) {
        if (signal.aborted) return; // Stopped by stop().
        // p-retry stops at once on an error that is not a network error (for example a TypeError):
        // the loop keeps trying with the backoff (desktop-shell review 9).
        await wait(error instanceof Error ? error.message : String(error));
        continue;
      }
      const openedAt = clock.now();
      await open.closed;
      this.#stream = null;
      if (signal.aborted) return;
      if (clock.now() - openedAt < SHORT_STREAM_MS) {
        // awd (or a proxy) accepts and closes at once: wait as after a failure (review 5).
        await wait("The event stream closed");
        continue;
      }
      short = 0;
      this.#set({ state: "offline", reason: "The event stream closed", attempt: 0, retryAt: null });
    }
  }

  /**
   * Opens the event stream and reads the status. The result holds a promise of the close (in an
   * object: an async function that returns a promise waits for it).
   */
  async #open(): Promise<{ closed: Promise<void> }> {
    if (this.#controller.signal.aborted) throw new AbortError("stopped");
    const stream = await this.#options.client.events((message) => this.#options.onEvent(message));
    const closed = new Promise<void>((resolve) => stream.socket.once("close", () => resolve()));
    this.#stream = stream;
    let status: { version: string; device: { slug: string } } | null = null;
    try {
      status = await this.#options.client.status();
    } catch {
      // The stream is open; the status is only for the window title.
    }
    this.#set({
      state: "online",
      version: status?.version ?? null,
      device: status?.device.slug ?? null,
    });
    this.#options.onResync();
    return { closed };
  }
}
