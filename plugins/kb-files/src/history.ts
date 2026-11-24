// The history store outside the synced folder: `<AW_HOME>/history/<workspace>/<sha256>`, and the
// local state `seen.json` (docs/phase-1.md 5.2, design decision 3). Never synced.
import { writeFileAtomic } from "@aw/core";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export function sha256Of(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const HASH = /^[0-9a-f]{64}$/;

/** Content-addressed versions. Each file is written once, with mode 0600 in a 0700 folder. */
export class HistoryStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700);
  }

  #file(hash: string): string {
    if (!HASH.test(hash)) throw new Error(`${hash} is not a sha256 hash`);
    return join(this.dir, hash);
  }

  /** Stores a version and returns its hash. A version that is there already is not written again. */
  async put(bytes: Uint8Array | string): Promise<string> {
    const hash = sha256Of(bytes);
    if (await this.has(hash)) return hash;
    const file = this.#file(hash);
    await writeFileAtomic(file, bytes);
    await chmod(file, 0o600);
    return hash;
  }

  async has(hash: string): Promise<boolean> {
    return stat(this.#file(hash)).then(
      () => true,
      () => false,
    );
  }

  /** The bytes of a version, or null when it is missing or its content does not match the hash. */
  async get(hash: string): Promise<Buffer | null> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.#file(hash));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    return sha256Of(bytes) === hash ? bytes : null;
  }
}

export interface SeenEntry {
  hash: string;
  size: number;
  mtime_ms: number;
}

/** The last hash, size and mtime of each path that this device saw (design decision 3). */
export class SeenState {
  readonly file: string;
  #paths = new Map<string, SeenEntry>();

  constructor(file: string) {
    this.file = file;
  }

  async load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    // A bad file is local state only: start again, and reconcile finds each file again.
    try {
      const value = JSON.parse(text) as { version?: number; paths?: Record<string, SeenEntry> };
      this.#paths = new Map(Object.entries(value.paths ?? {}));
    } catch {
      this.#paths = new Map();
    }
  }

  async save(): Promise<void> {
    const paths = Object.fromEntries([...this.#paths].sort(([a], [b]) => (a < b ? -1 : 1)));
    await writeFileAtomic(this.file, `${JSON.stringify({ version: 1, paths }, null, 1)}\n`);
    await chmod(this.file, 0o600);
  }

  get(path: string): SeenEntry | undefined {
    return this.#paths.get(path);
  }

  set(path: string, entry: SeenEntry): void {
    this.#paths.set(path, entry);
  }

  delete(path: string): void {
    this.#paths.delete(path);
  }

  paths(): string[] {
    return [...this.#paths.keys()];
  }
}
