// The background refresh of the main process (openspec add-desktop-devices-knowledge): after a
// `changed` event or a resync, and every 30 s, main loads the tasks of each workspace and the sync
// state for the notifications and the Tray. Many events in a short time give one load.
import type { Clock } from "@aw/core/clock";

export const DEBOUNCE_MS = 500;
export const PERIOD_MS = 30_000;

export interface BackgroundDeps<T> {
  clock: Clock;
  load(): Promise<T>;
  onLoaded(value: T): void;
  onError(error: unknown): void;
  debounceMs?: number;
}

export class BackgroundRefresh<T> {
  readonly #deps: BackgroundDeps<T>;
  #pending = false;
  #running: Promise<void> | null = null;
  #stopped = false;

  constructor(deps: BackgroundDeps<T>) {
    this.#deps = deps;
  }

  /** Asks for a load after the debounce time; calls during a wait or a load give one more load. */
  schedule(): void {
    if (this.#stopped) return;
    this.#pending = true;
    this.#running ??= this.#loop().finally(() => {
      this.#running = null;
      // A request after the last check of the loop and before this cleanup (devices-kb review 10).
      if (this.#pending && !this.#stopped) this.schedule();
    });
  }

  async #loop(): Promise<void> {
    while (this.#pending && !this.#stopped) {
      await this.#deps.clock.sleep(this.#deps.debounceMs ?? DEBOUNCE_MS);
      if (this.#stopped) return;
      this.#pending = false;
      try {
        this.#deps.onLoaded(await this.#deps.load());
      } catch (error) {
        this.#deps.onError(error);
      }
    }
  }

  /** Schedules a load every `ms` until `stop()`. */
  async every(ms: number = PERIOD_MS): Promise<void> {
    while (!this.#stopped) {
      await this.#deps.clock.sleep(ms);
      this.schedule();
    }
  }

  /** Resolves when no load waits or runs. */
  async idle(): Promise<void> {
    while (this.#running) await this.#running;
  }

  stop(): void {
    this.#stopped = true;
  }
}
