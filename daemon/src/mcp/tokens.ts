// The session tokens (design of add-mcp-server, decision 3): one bearer token per session, in
// `~/.aw/sessions/<session>/mcp-token` (0600). awd keeps the sha256 of each token in memory, so a
// lookup compares hashes in constant time and never keeps the token text in a map key. The token
// text of each live session stays in memory only for the redaction of events (name `mcp-token`).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { sessionsRoot, writePrivate } from "../sessions/records.ts";

/** The prefix of a session token: a reader of a log or a file sees what it is. */
export const TOKEN_PREFIX = "awt_";
const TOKEN_PATTERN = /^awt_[A-Za-z0-9_-]{43}$/;

export function tokenFile(home: string, session: string): string {
  return join(sessionsRoot(home), session, "mcp-token");
}

function digest(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** The bearer token of an `Authorization` header, or null. */
export function bearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string") return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(value);
  return match ? match[1]! : null;
}

export class SessionTokens {
  readonly #home: string;
  /** The sha256 (hex) of each live token, to its session. */
  readonly #sessions = new Map<string, string>();
  /** The sha256 of the token of each session. */
  readonly #digests = new Map<string, Buffer>();
  /** The token text of each live session, for the redaction only. */
  readonly #texts = new Map<string, string>();
  readonly #listeners: (() => void)[] = [];

  constructor(home: string) {
    this.#home = home;
  }

  /** The count of live tokens (tests). */
  get size(): number {
    return this.#digests.size;
  }

  /** Calls the listener after each change of the live tokens (the redaction set). */
  onChange(listener: () => void): void {
    this.#listeners.push(listener);
  }

  /** The live tokens as secrets of the redaction: `[redacted:mcp-token]` in an event. */
  secrets(): { name: string; value: string }[] {
    return [...this.#texts.values()].map((value) => ({ name: "mcp-token", value }));
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }

  #remember(session: string, token: string): void {
    const hash = digest(token);
    const old = this.#digests.get(session);
    if (old) this.#sessions.delete(old.toString("hex"));
    this.#digests.set(session, hash);
    this.#sessions.set(hash.toString("hex"), session);
    if (this.#texts.get(session) !== token) {
      this.#texts.set(session, token);
      this.#changed();
    }
  }

  /**
   * The token of a session: the one in its file, else a new one (32 random bytes). A resume keeps
   * the token, so the MCP configuration of the agent stays valid.
   */
  async ensure(session: string): Promise<string> {
    const path = tokenFile(this.#home, session);
    const existing = (await readFile(path, "utf8").catch(() => "")).trim();
    if (TOKEN_PATTERN.test(existing)) {
      this.#remember(session, existing);
      return existing;
    }
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    await writePrivate(path, `${token}\n`);
    this.#remember(session, token);
    return token;
  }

  /** Loads the token of a running session at start (no new token: the file must exist). */
  async load(session: string): Promise<boolean> {
    const text = (await readFile(tokenFile(this.#home, session), "utf8").catch(() => "")).trim();
    if (!TOKEN_PATTERN.test(text)) return false;
    this.#remember(session, text);
    return true;
  }

  /** The session of a token, or null. The hashes are compared in constant time. */
  session(token: string): string | null {
    if (!TOKEN_PATTERN.test(token)) return null;
    const hash = digest(token);
    const session = this.#sessions.get(hash.toString("hex"));
    if (session === undefined) return null;
    const stored = this.#digests.get(session);
    return stored && timingSafeEqual(stored, hash) ? session : null;
  }

  /** Forgets the token of a session and removes its file. */
  async revoke(session: string): Promise<void> {
    const hash = this.#digests.get(session);
    if (hash) this.#sessions.delete(hash.toString("hex"));
    this.#digests.delete(session);
    if (this.#texts.delete(session)) this.#changed();
    await rm(tokenFile(this.#home, session), { force: true });
  }
}
