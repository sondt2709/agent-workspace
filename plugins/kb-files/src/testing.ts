// Test helpers of @aw/kb-files. Not in the package index.
import { FakeClock, openWorkspace, type WorkspaceFiles } from "@aw/core";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FileKnowledgeStore, type FileKnowledgeStoreOptions } from "./store.ts";

export const SECRET = { name: "stripe-test", value: "fake-credential-9f3k2LmQ" };

export interface Device {
  slug: string;
  files: WorkspaceFiles;
  store: FileKnowledgeStore;
  historyDir: string;
}

/** A temp AW folder that 2 devices share, as if sync copied each file at once. */
export class TestFolder {
  readonly root: string;
  readonly state: string;
  readonly clock = new FakeClock("2026-11-22T14:20:01.123Z");

  private constructor(root: string, state: string) {
    this.root = root;
    this.state = state;
  }

  static async create(): Promise<TestFolder> {
    const base = await mkdtemp(join(tmpdir(), "aw-kb-"));
    const root = join(base, "AW");
    await mkdir(join(root, "knowledge"), { recursive: true });
    return new TestFolder(root, join(base, "state"));
  }

  device(
    slug: string,
    options: Partial<FileKnowledgeStoreOptions> & { role?: "local" | "remote" | "mobile" } = {},
  ): Device {
    const clock = options.clock ?? this.clock;
    const files = openWorkspace({
      root: this.root,
      device: slug,
      role: options.role ?? (slug === "macbook-pro" ? "local" : "remote"),
      clock,
    });
    const historyDir = join(this.state, slug, "history", "ws");
    const store = new FileKnowledgeStore({
      files,
      historyDir,
      clock,
      taskKey: (task) => (task === TASK ? "AW-7" : null),
      ...options,
    });
    return { slug, files, store, historyDir };
  }

  abs(path: string): string {
    return join(this.root, "knowledge", ...path.split("/"));
  }

  /** A direct edit of a person, with an editor: not through AW. */
  async edit(path: string, content: string): Promise<void> {
    await mkdir(dirname(this.abs(path)), { recursive: true });
    await writeFile(this.abs(path), content);
  }

  async remove(path: string): Promise<void> {
    await rm(this.abs(path));
  }

  async text(path: string): Promise<string | null> {
    return readFile(this.abs(path), "utf8").catch(() => null);
  }

  async log(device: string): Promise<Record<string, unknown>[]> {
    const text = await readFile(
      join(this.root, "knowledge", "log", `${device}.jsonl`),
      "utf8",
    ).catch(() => "");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  async cleanup(): Promise<void> {
    await rm(dirname(this.root), { recursive: true, force: true });
  }
}

export const TASK = "01a2038e-7f00-70eb-b429-fa86d481c263";
