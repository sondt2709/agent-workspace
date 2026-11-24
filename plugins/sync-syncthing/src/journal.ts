// The write journal (docs/phase-1.md 6.6.3): the sha256 of each own write of this device, per
// workspace path, in `<AW_HOME>/journal/<workspace id>.jsonl`. The conflict copy name has the id
// of the winner, not of the author, so the resolver finds the author here.
import { writeFileAtomic } from "@aw/core";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** The hashes that the journal keeps per path. */
export const JOURNAL_KEEP = 16;
/** A journal file with more lines is compacted when it is loaded. */
export const JOURNAL_COMPACT_LINES = 10_000;

export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

interface Entry {
  path: string;
  sha256: string;
  at: string;
}

export class WriteJournal {
  readonly #dir: string;
  readonly #now: () => number;
  readonly #data = new Map<string, Map<string, string[]>>();
  readonly #loading = new Map<string, Promise<Map<string, string[]>>>();

  constructor(dir: string, now: () => number) {
    this.#dir = dir;
    this.#now = now;
  }

  #file(workspace: string): string {
    return join(this.#dir, `${workspace}.jsonl`);
  }

  async #load(workspace: string): Promise<Map<string, string[]>> {
    const loaded = this.#data.get(workspace);
    if (loaded) return loaded;
    let pending = this.#loading.get(workspace);
    if (!pending) {
      pending = (async () => {
        const map = new Map<string, string[]>();
        const text = await readFile(this.#file(workspace), "utf8").catch(() => "");
        const lines = text.split("\n").filter((line) => line.trim() !== "");
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as Entry;
            if (typeof entry.path === "string" && typeof entry.sha256 === "string") {
              push(map, entry.path, entry.sha256);
            }
          } catch {
            // A broken line (a crash during an append) is skipped.
          }
        }
        if (lines.length > JOURNAL_COMPACT_LINES) await this.#compact(workspace, map);
        this.#data.set(workspace, map);
        return map;
      })();
      this.#loading.set(workspace, pending);
    }
    return pending;
  }

  async #compact(workspace: string, map: Map<string, string[]>): Promise<void> {
    const at = new Date(this.#now()).toISOString();
    const text = [...map.entries()]
      .flatMap(([path, hashes]) => hashes.map((sha) => JSON.stringify({ path, sha256: sha, at })))
      .join("\n");
    // Atomic: a crash in the rewrite never empties the journal of the own writes (final check
    // review item P6).
    await writeFileAtomic(this.#file(workspace), text === "" ? "" : `${text}\n`, { mode: 0o600 });
  }

  /** Records an own write. */
  async record(workspace: string, path: string, content: string | Uint8Array): Promise<string> {
    const sha = sha256Hex(content);
    await this.add(workspace, path, sha);
    return sha;
  }

  async add(workspace: string, path: string, sha: string): Promise<void> {
    const map = await this.#load(workspace);
    const list = map.get(path);
    if (list && list[list.length - 1] === sha) return;
    push(map, path, sha);
    await mkdir(this.#dir, { recursive: true, mode: 0o700 });
    const entry: Entry = { path, sha256: sha, at: new Date(this.#now()).toISOString() };
    await appendFile(this.#file(workspace), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  }

  /** True when this device wrote this content to the path. */
  async has(workspace: string, path: string, sha: string): Promise<boolean> {
    return (await this.#load(workspace)).get(path)?.includes(sha) ?? false;
  }
}

function push(map: Map<string, string[]>, path: string, sha: string): void {
  const list = map.get(path) ?? [];
  const index = list.indexOf(sha);
  if (index >= 0) list.splice(index, 1);
  list.push(sha);
  if (list.length > JOURNAL_KEEP) list.splice(0, list.length - JOURNAL_KEEP);
  map.set(path, list);
}
