// The sign-in state of the agent (docs/architecture.md 4.6.7, design of add-continuity decision
// 11): `claude auth status --json` at the start and once per hour, never a credential file.
import type { Clock } from "@aw/core";
import type { AuthStatus } from "@aw/plugin-api";
import type { Logger } from "../log.ts";

export const AUTH_CHECK_MS = 60 * 60 * 1000;
/** The warning before `loginExpiresAt`. */
export const LOGIN_WARNING_MS = 3 * 24 * 60 * 60 * 1000;

export interface AuthState {
  /** False when the login ended. */
  valid: boolean;
  /** ISO time of `loginExpiresAt`, or null. */
  expiresAt: string | null;
  checkedAt: number;
}

/** The state of one auth status at a time. */
export function authState(status: AuthStatus, now: number): AuthState {
  const end = status.expiresAt === null ? null : Date.parse(status.expiresAt);
  const ended = end !== null && Number.isFinite(end) && end <= now;
  return { valid: status.loggedIn && !ended, expiresAt: status.expiresAt, checkedAt: now };
}

/** True when the login ends in less than 3 days (and has not ended). */
export function loginEndsSoon(state: AuthState | null, now: number): boolean {
  if (!state?.valid || state.expiresAt === null) return false;
  const end = Date.parse(state.expiresAt);
  return Number.isFinite(end) && end > now && end - now < LOGIN_WARNING_MS;
}

/** Runs the status check on the clock. A failed check keeps the last known state. */
export class AuthMonitor {
  readonly #read: () => Promise<AuthStatus>;
  readonly #clock: Clock;
  readonly #log: Logger;
  readonly #periodMs: number;
  #state: AuthState | null = null;
  #running = false;
  #closed = false;

  constructor(options: {
    read: () => Promise<AuthStatus>;
    clock: Clock;
    log: Logger;
    periodMs?: number;
  }) {
    this.#read = options.read;
    this.#clock = options.clock;
    this.#log = options.log;
    this.#periodMs = options.periodMs ?? AUTH_CHECK_MS;
  }

  /** The last state, or null before the first check (not known: AW does not block then). */
  get state(): AuthState | null {
    return this.#state;
  }

  async check(): Promise<AuthState | null> {
    try {
      const state = authState(await this.#read(), this.#clock.now());
      if (this.#state?.valid !== state.valid) {
        this.#log.info({ valid: state.valid, expires: state.expiresAt }, "Agent sign-in state");
      }
      this.#state = state;
    } catch (error) {
      this.#log.warn({ err: error }, "The agent sign-in state was not read");
    }
    return this.#state;
  }

  /** Checks now, then once per period until close. */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    void (async () => {
      while (!this.#closed) {
        await this.check();
        // Short sleeps: a stop of awd does not wait for one long timer.
        const until = this.#clock.now() + this.#periodMs;
        while (!this.#closed && this.#clock.now() < until) {
          await this.#clock.sleep(Math.min(5000, until - this.#clock.now()));
        }
      }
    })();
  }

  close(): void {
    this.#closed = true;
  }
}
