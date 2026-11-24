// Helpers for the merge tests and the script that writes the expected views of the merge cases.
// Not in the package index: product code does not use them.
import { hlcTimeOf, newId } from "@aw/schema";
import { fixtureRoot, materializeMergeCase, type MergeCase } from "@aw/schema/testing";
import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FakeClock } from "../clock.ts";
import { MergeEngine, type MergeUpdate } from "./engine.ts";

/** A copy of a JSON value with the keys of each object sorted, for a stable text form. */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** The expected-file value of a merge update: the view and the presence. */
export function expectedOf(update: MergeUpdate): unknown {
  return sortKeys({ view: update.view, presence: update.presence });
}

export interface CaseRun {
  root: string;
  clock: FakeClock;
  engine: MergeEngine;
  update: MergeUpdate;
  cleanup: () => Promise<void>;
}

/** Builds the folder of a merge case in a temp folder and merges it at the time of the case. */
export async function runMergeCase(
  item: MergeCase,
  readOrder?: (paths: string[]) => string[],
): Promise<CaseRun> {
  const root = await mkdtemp(join(tmpdir(), `aw-merge-${item.name}-`));
  materializeMergeCase(item.name, root);
  return mergeCaseIn(item, root, readOrder);
}

/**
 * Merges a case folder that `runMergeCase` or the caller made, with a new engine. The merge only
 * reads the folder, so one folder serves each read order of a case (final check sac-11: 40 folders
 * of one case cost seconds of disk work on a busy computer).
 */
export async function mergeCaseIn(
  item: MergeCase,
  root: string,
  readOrder?: (paths: string[]) => string[],
): Promise<CaseRun> {
  const clock = new FakeClock(item.now);
  const engine = new MergeEngine({
    root,
    clock,
    ...(item.max_skew_ms === undefined ? {} : { maxSkewMs: item.max_skew_ms }),
    ...(readOrder ? { readOrder } : {}),
  });
  const update = await engine.update();
  return {
    root,
    clock,
    engine,
    update,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** A seeded random generator (mulberry32): the same seed gives the same numbers. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shuffled copy of a list (Fisher-Yates) with a seeded generator. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/** The id of the task AW-7 of the fixture folder. */
export const FIXTURE_TASK = "01a2038e-7f00-70eb-b429-fa86d481c263";

/** An HLC on 2026-11-22: `at("15:00:00")` is `2026-11-22T15:00:00.000Z#0000`. */
export function at(time: string, counter = 0): string {
  return `2026-11-22T${time}.000Z#${String(counter).padStart(4, "0")}`;
}

export interface TestEvent {
  v: 1;
  id: string;
  hlc: string;
  dev: string;
  type: string;
  task?: string;
  by?: string;
  data: Record<string, unknown>;
}

/** Builds an event with a new UUIDv7 id from the time of the HLC. */
export function event(
  dev: string,
  type: string,
  hlc: string,
  data: Record<string, unknown>,
  options: { task?: string; by?: string } = {},
): TestEvent {
  const time = hlcTimeOf(hlc) ?? 0;
  return {
    v: 1,
    id: newId({ now: () => time }),
    hlc,
    dev,
    type,
    ...(options.task ? { task: options.task } : {}),
    ...(options.by ? { by: options.by } : {}),
    data,
  };
}

/** The data of `task.created` with the defaults of the schema. */
export function createdData(key: string, extra: Record<string, unknown> = {}) {
  return {
    key,
    project: "billing-api",
    title: `Task ${key}`,
    first_message: `/opsx:explore Task ${key}`,
    assignee: null,
    parent: null,
    depends_on: [],
    test_server: null,
    credentials: [],
    links: [],
    ...extra,
  };
}

/** A temp workspace folder for a test: a copy of the fixture folder, or an empty folder. */
export class TestWorkspace {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static async create(options: { fixture?: boolean } = {}): Promise<TestWorkspace> {
    const root = await mkdtemp(join(tmpdir(), "aw-merge-test-"));
    if (options.fixture ?? true) await cp(fixtureRoot, root, { recursive: true });
    return new TestWorkspace(root);
  }

  /** Appends events as lines to a file. */
  async append(path: string, ...events: unknown[]): Promise<void> {
    const file = join(this.root, ...path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  }

  /** Appends raw text to a file. */
  async appendText(path: string, text: string): Promise<void> {
    const file = join(this.root, ...path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, text);
  }

  /** Writes a whole file. */
  async write(path: string, text: string): Promise<void> {
    const file = join(this.root, ...path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  }

  /** Appends task events to `tasks/<task>/log/<dev>.jsonl`. */
  async task(task: string, ...events: TestEvent[]): Promise<void> {
    for (const e of events) await this.append(`tasks/${task}/log/${e.dev}.jsonl`, { ...e, task });
  }

  remove(): Promise<void> {
    return rm(this.root, { recursive: true, force: true });
  }
}
