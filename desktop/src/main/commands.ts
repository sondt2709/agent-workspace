// The commands of the menu, the Tray and a notification click for the renderer (fix list 0-12).
// A new window loads its page, and React subscribes to `aw:command` after the load event. So a
// command waits until the renderer sends `aw:command-ready` after it subscribes.
import type { AppCommand } from "../shared/channels.ts";

export class CommandQueue {
  readonly #deliver: (command: AppCommand) => void;
  #ready = false;
  #pending: AppCommand | null = null;

  constructor(deliver: (command: AppCommand) => void) {
    this.#deliver = deliver;
  }

  /** A new window or a new page load: commands wait until its renderer listens. */
  reset(): void {
    this.#ready = false;
  }

  /** The renderer listens: send the command that waits, if one does. */
  ready(): void {
    this.#ready = true;
    const next = this.#pending;
    this.#pending = null;
    if (next !== null) this.#deliver(next);
  }

  /** Sends a command now, or keeps the newest one until the renderer listens. */
  send(command: AppCommand): void {
    if (!this.#ready) {
      this.#pending = command;
      return;
    }
    this.#deliver(command);
  }
}
