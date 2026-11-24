// The clock module of the renderer. Screens read the time only through `useNow()`, and tests give a
// fixed clock with `ClockContext`.
import { createContext, useContext, useEffect, useState } from "react";

export interface RendererClock {
  now(): number;
  /** Calls `tick` every `ms`; returns a function that stops it. */
  every(ms: number, tick: () => void): () => void;
}

export const systemClock: RendererClock = {
  now: () => Date.now(),
  every: (ms, tick) => {
    const timer = setInterval(tick, ms);
    return () => clearInterval(timer);
  },
};

export const ClockContext = createContext<RendererClock>(systemClock);

/** The current time, updated every `ms` while `active` is true. */
export function useNow(ms = 1000, active = true): number {
  const clock = useContext(ClockContext);
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(clock.now());
    return clock.every(ms, () => setNow(clock.now()));
  }, [clock, ms, active]);
  return now;
}
