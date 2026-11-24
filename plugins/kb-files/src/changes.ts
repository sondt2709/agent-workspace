// The knowledge logs of all devices (`knowledge/log/<device>.jsonl`) in merge order, and the
// views that the store reads from them (design decision 6). The merge engine does not read them.
import {
  compareOrder,
  DEFAULT_MAX_SKEW_MS,
  hlcMs,
  type Clock,
  type WorkspaceFiles,
} from "@aw/core";
import type { ApprovalReason } from "@aw/plugin-api";
import type { EventOf } from "@aw/schema";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export type ChangedEvent = EventOf<"knowledge.changed">;
export type SuggestedEvent = EventOf<"knowledge.suggested">;
export type ResolvedEvent = EventOf<"knowledge.suggestion_resolved">;
export type KnowledgeEvent = ChangedEvent | SuggestedEvent | ResolvedEvent;

const LOG_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.jsonl$/;

interface CachedLog {
  size: number;
  mtimeMs: number;
  events: KnowledgeEvent[];
  bad: number;
}

export interface SuggestionState {
  event: SuggestedEvent;
  state: "pending" | "accepted" | "rejected";
  resolution: ResolvedEvent | null;
  change: ChangedEvent | null;
  late: number;
  reasons: ApprovalReason[];
}

/** The views of one read of the logs. */
export class ChangeView {
  readonly events: KnowledgeEvent[];
  readonly changes: ChangedEvent[];
  readonly #latest = new Map<string, ChangedEvent>();
  /** The devices that logged each transition (path, base, hash). */
  readonly #transitions = new Map<string, Set<string>>();
  readonly #byId = new Map<string, KnowledgeEvent>();
  readonly suggestions: SuggestionState[] = [];
  /** The count of bad lines in the knowledge logs. */
  readonly bad: number;

  constructor(events: KnowledgeEvent[], bad: number) {
    this.events = events;
    this.bad = bad;
    this.changes = events.filter((e): e is ChangedEvent => e.type === "knowledge.changed");
    const suggestions = new Map<string, SuggestionState>();
    for (const event of events) {
      if (!this.#byId.has(event.id)) this.#byId.set(event.id, event);
      if (event.type === "knowledge.changed") {
        this.#latest.set(event.data.path, event);
        const key = transition(event.data.path, event.data.base, event.data.hash);
        const devices = this.#transitions.get(key) ?? new Set<string>();
        devices.add(event.dev);
        this.#transitions.set(key, devices);
        const id = event.data.suggestion;
        const state = id ? suggestions.get(id) : undefined;
        if (state && state.change === null) state.change = event;
      } else if (event.type === "knowledge.suggested") {
        if (suggestions.has(event.data.suggestion)) continue;
        const state: SuggestionState = {
          event,
          state: "pending",
          resolution: null,
          change: null,
          late: 0,
          reasons: event.data.reasons,
        };
        suggestions.set(event.data.suggestion, state);
        this.suggestions.push(state);
      } else {
        const state = suggestions.get(event.data.suggestion);
        if (!state) continue;
        if (state.resolution !== null) {
          state.late += 1;
          continue;
        }
        state.resolution = event;
      }
    }
    // The first resolution in merge order wins. A change that applied the suggestion makes it
    // accepted in any order: the file has the content, and its Undo is in the history.
    for (const state of this.suggestions) {
      state.state = state.change ? "accepted" : (state.resolution?.data.decision ?? "pending");
    }
  }

  /** The newest change event of a path in merge order. */
  latest(path: string): ChangedEvent | undefined {
    return this.#latest.get(path);
  }

  /**
   * True when an event of another device than `self` changed the path from `base` to `hash`. A
   * transition of this device does not count: a person can make the same edit again by hand.
   */
  hasTransition(path: string, base: string | null, hash: string | null, self: string): boolean {
    const devices = this.#transitions.get(transition(path, base, hash));
    return devices !== undefined && [...devices].some((device) => device !== self);
  }

  /** An event by its id, or by an id prefix of 8 or more characters that only one event has. */
  find(ref: string): KnowledgeEvent | "ambiguous" | undefined {
    const exact = this.#byId.get(ref);
    if (exact) return exact;
    if (ref.length < 8) return undefined;
    const matches = [...this.#byId.values()].filter((e) => e.id.startsWith(ref));
    if (matches.length > 1) return "ambiguous";
    return matches[0];
  }

  suggestion(ref: string): SuggestionState | "ambiguous" | undefined {
    const exact = this.suggestions.find((s) => s.event.data.suggestion === ref);
    if (exact) return exact;
    if (ref.length < 8) return undefined;
    const matches = this.suggestions.filter((s) => s.event.data.suggestion.startsWith(ref));
    if (matches.length > 1) return "ambiguous";
    return matches[0];
  }
}

function transition(path: string, base: string | null, hash: string | null): string {
  return `${path}\u0000${base ?? "-"}\u0000${hash ?? "-"}`;
}

/** Reads the knowledge logs with a cache per file (size and mtime). */
export class ChangeLog {
  readonly #files: WorkspaceFiles;
  readonly #clock: Clock;
  readonly #dir: string;
  #cache = new Map<string, CachedLog>();

  constructor(files: WorkspaceFiles, clock: Clock) {
    this.#files = files;
    this.#clock = clock;
    this.#dir = join(files.root, "knowledge", "log");
  }

  /** Reads the logs that changed and returns the views of all events in merge order. */
  async read(): Promise<ChangeView> {
    let names: string[];
    try {
      names = (await readdir(this.#dir)).filter((name) => LOG_NAME.test(name)).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      names = [];
    }
    const next = new Map<string, CachedLog>();
    for (const name of names) {
      const info = await stat(join(this.#dir, name)).catch(() => null);
      if (!info?.isFile()) continue;
      const cached = this.#cache.get(name);
      if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
        next.set(name, cached);
        continue;
      }
      const result = await this.#files.readEvents(`knowledge/log/${name}`);
      const events = result.events.filter(
        (e): e is KnowledgeEvent =>
          e.type === "knowledge.changed" ||
          e.type === "knowledge.suggested" ||
          e.type === "knowledge.suggestion_resolved",
      );
      next.set(name, { size: info.size, mtimeMs: info.mtimeMs, events, bad: result.errors.length });
    }
    this.#cache = next;
    const all = [...next.values()].flatMap((log) => log.events).sort(compareOrder);
    // Each new event of this device sorts after each event that it saw, also from a device whose
    // clock runs ahead, so an Undo sorts after the change that it undoes. A far-future HLC
    // (more than 24 h ahead) does not move the clock (merge-index decision 2).
    const bound = this.#clock.now() + DEFAULT_MAX_SKEW_MS;
    const last = [...all].reverse().find((e) => hlcMs(e.hlc) <= bound);
    if (last) this.#files.hlc.observe(last.hlc);
    const bad = [...next.values()].reduce((sum, log) => sum + log.bad, 0);
    return new ChangeView(all, bad);
  }
}
