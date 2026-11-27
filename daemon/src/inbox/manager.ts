// The Inbox of this device (openspec inbox-mattermost): one collector for each open workspace whose
// source names this device, the loop that runs them, and the tokens of the triage sessions.
import type { CardView, Clock, SourceView } from "@aw/core";
import type { Source } from "@aw/plugin-api";
import type { HealthInbox } from "@aw/schema";
import { MattermostSource } from "@aw/source-mattermost";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../log.ts";
import { SessionTokens } from "../mcp/tokens.ts";
import type { WorkspaceService } from "../service/workspace.ts";
import type { SessionTools } from "../sessions/manager.ts";
import type { Settings } from "../settings.ts";
import { Collector } from "./collector.ts";
import { TriageSession } from "./triage.ts";

/** The wait between 2 steps of the loop. A change of the workspace runs a step at once. */
export const INBOX_TICK_MS = 5000;

export interface InboxManagerOptions {
  settings: Settings;
  log: Logger;
  clock: Clock;
  /** The value of a credential of a workspace (the token of a source). */
  credential: (workspace: string, name: string) => Promise<string>;
  /** The session tools (tmux, Claude Code, aw-launch), or null when they are missing. */
  tools: () => Promise<SessionTools | null>;
  /** A source for a configuration; default: the Mattermost plugin. Tests give a fake. */
  openSource?: (source: SourceView, token: string) => Source;
  /** Sends the push of a card with urgency high. */
  push?: (service: WorkspaceService, card: CardView) => Promise<void>;
  tickMs?: number;
}

interface Entry {
  service: WorkspaceService;
  collector: Collector;
  triage: TriageSession | null;
}

export class InboxManager {
  readonly #o: InboxManagerOptions;
  readonly #entries = new Map<string, Entry>();
  /** The tokens of the triage sessions: their own set, so a task token never opens them. */
  readonly tokens: SessionTokens;
  #stopped = false;
  #wake: (() => void) | null = null;
  #loop: Promise<void> | null = null;

  constructor(options: InboxManagerOptions) {
    this.#o = options;
    this.tokens = new SessionTokens(options.settings.home);
  }

  #stateDir(workspace: string): string {
    return join(this.#o.settings.home, "inbox", workspace);
  }

  /** Adds an open workspace. */
  async attach(service: WorkspaceService): Promise<void> {
    if (this.#entries.has(service.id)) return;
    const stateDir = this.#stateDir(service.id);
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const entry: Entry = { service, triage: null, collector: null as unknown as Collector };
    entry.collector = new Collector({
      service,
      clock: this.#o.clock,
      log: this.#o.log.child({ module: "inbox", workspace: service.id }),
      stateDir,
      openSource: async (source) => {
        const token = await this.#o.credential(service.id, source.credential);
        return this.#o.openSource
          ? this.#o.openSource(source, token)
          : new MattermostSource({ url: source.server_url, token });
      },
      triage: (session, source) => {
        const triage = new TriageSession({
          settings: this.#o.settings,
          log: this.#o.log.child({ module: "triage", workspace: service.id }),
          tools: this.#o.tools,
          tokens: this.tokens,
          workspace: service.id,
          stateDir,
          knowledgeDir: join(service.root, "knowledge"),
          session,
          model: source.triage.model,
          instruction: source.triage.instruction,
        });
        entry.triage = triage;
        return triage;
      },
      ...(this.#o.push ? { pushHigh: (card) => this.#o.push!(service, card) } : {}),
    });
    this.#entries.set(service.id, entry);
    // A triage session that an earlier awd started keeps its token.
    const state = await entry.collector.load();
    if (state.triage_session) await this.tokens.load(state.triage_session);
  }

  /** Starts the loop. */
  start(): void {
    if (this.#loop) return;
    this.#loop = this.#run();
  }

  async #run(): Promise<void> {
    while (!this.#stopped) {
      for (const entry of [...this.#entries.values()]) {
        if (this.#stopped) break;
        if (!entry.service.ready) continue;
        try {
          await entry.collector.tick();
        } catch (error) {
          this.#o.log.error({ err: error, workspace: entry.service.id }, "The inbox step failed");
        }
      }
      if (this.#stopped) break;
      await Promise.race([
        this.#o.clock.sleep(this.#o.tickMs ?? INBOX_TICK_MS),
        new Promise<void>((resolve) => {
          this.#wake = resolve;
        }),
      ]);
      this.#wake = null;
    }
  }

  /** A workspace changed: run a step soon (a "Run now", a reply, an ask). */
  changed(): void {
    this.#wake?.();
  }

  /** The triage session of a token: its workspace and its session id, or null. */
  triageOf(token: string): { workspace: string; session: string } | null {
    const session = this.tokens.session(token);
    if (session === null) return null;
    for (const [workspace, entry] of this.#entries) {
      if (entry.collector.state?.triage_session === session) return { workspace, session };
    }
    return null;
  }

  collector(workspace: string): Collector | null {
    return this.#entries.get(workspace)?.collector ?? null;
  }

  health(workspace: string): HealthInbox | null {
    return this.#entries.get(workspace)?.collector.health() ?? null;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#wake?.();
    await this.#loop;
  }
}
