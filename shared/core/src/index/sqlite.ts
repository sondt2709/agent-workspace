// The local index of a workspace: one SQLite file per workspace in the state folder of the device,
// never synced (docs/phase-1.md 3.5, docs/architecture.md 4.2.7). AW rebuilds it from the files at
// any time, so the files stay the source.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { EventRow, LastValidDocument, MergeEngine, MergeUpdate } from "../merge/engine.ts";
import { compareText } from "../merge/order.ts";
import {
  matcher,
  sortRows,
  toSqlFilter,
  type ColumnType,
  type MongoQuery,
  type SortSpec,
} from "./query.ts";

/** The version of the table layout. A new version rebuilds the index. */
export const INDEX_VERSION = 1;

/** The path of the index of a workspace: `<stateDir>/index/<workspace id>.sqlite`. */
export function indexPath(stateDir: string, workspaceId: string): string {
  return join(stateDir, "index", `${workspaceId}.sqlite`);
}

interface CollectionSpec {
  /** The primary key of a row. */
  key: (row: Record<string, unknown>) => string;
  /** The indexed top-level fields of the JSON row and their SQL types. */
  columns: Record<string, ColumnType>;
}

const field = (name: string) => (row: Record<string, unknown>) => String(row[name]);

export const COLLECTIONS = {
  files: { key: field("path"), columns: { path: "text" } },
  documents: { key: field("path"), columns: { path: "text", kind: "text" } },
  events: {
    key: field("id"),
    columns: {
      id: "text",
      task: "text",
      hlc: "text",
      dev: "text",
      type: "text",
      applied: "bool",
      reason: "text",
    },
  },
  tasks: {
    key: field("id"),
    columns: {
      id: "text",
      key: "text",
      project: "text",
      stage: "text",
      assignee: "text",
      owner: "text",
      parent: "text",
      archived: "bool",
      key_state: "text",
      needs_you_lane: "bool",
    },
  },
  projects: { key: field("slug"), columns: { slug: "text" } },
  devices: { key: field("slug"), columns: { slug: "text", role: "text" } },
  queues: { key: field("agent"), columns: { agent: "text" } },
  slots: {
    key: (row) => `${String(row.device)}/${String(row.resource)}/${String(row.slot)}`,
    columns: { device: "text", resource: "text", slot: "integer" },
  },
  credentials: { key: field("name"), columns: { name: "text" } },
  issues: {
    key: (row) =>
      `${String(row.path)}:${String(row.line)}:${String(row.code)}:${String(row.event)}:${String(row.message)}`,
    columns: { code: "text", path: "text", task: "text", reason: "text" },
  },
  presence: { key: field("device"), columns: { device: "text", online: "bool" } },
} satisfies Record<string, CollectionSpec>;

export type Collection = keyof typeof COLLECTIONS;
export const collections = Object.keys(COLLECTIONS) as Collection[];

/** Collections that the presence layer fills. They depend on the local receive times. */
export const PRESENCE_COLLECTIONS: readonly Collection[] = ["presence"];

const SQL_TYPE: Record<ColumnType, string> = { text: "TEXT", integer: "INTEGER", bool: "INTEGER" };

function columnValue(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string") return value;
  return JSON.stringify(value);
}

export interface FindOptions {
  sort?: SortSpec;
  limit?: number;
}

type Rows = Map<string, string>;

export class WorkspaceIndex {
  readonly path: string;
  readonly #db: DatabaseSync;
  /** The JSON of each row that this process wrote, per collection. Empty after open. */
  #written = new Map<Collection, Rows>();
  #fresh = true;

  constructor(path: string) {
    this.path = path;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.#createTables();
  }

  #createTables(): void {
    const version = this.#db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (version.user_version !== INDEX_VERSION) {
      for (const name of collections) this.#db.exec(`DROP TABLE IF EXISTS "${name}"`);
      this.#db.exec(`PRAGMA user_version = ${INDEX_VERSION}`);
    }
    for (const name of collections) {
      const spec: CollectionSpec = COLLECTIONS[name];
      const columns = Object.entries(spec.columns).map(
        ([column, type]) => `"${column}" ${SQL_TYPE[type]}`,
      );
      this.#db.exec(
        `CREATE TABLE IF NOT EXISTS "${name}" (pk TEXT PRIMARY KEY, json TEXT NOT NULL${columns.map((c) => `, ${c}`).join("")})`,
      );
      for (const column of Object.keys(spec.columns)) {
        this.#db.exec(`CREATE INDEX IF NOT EXISTS "${name}_${column}" ON "${name}" ("${column}")`);
      }
    }
  }

  close(): void {
    this.#db.close();
  }

  /**
   * Writes the result of a merge update. The first write after open, and each full update, replace
   * each table. Else only the changed rows are written: the events of the changed tasks, and the
   * rows of the other collections whose JSON changed.
   */
  write(update: MergeUpdate, engine: MergeEngine): void {
    const full = this.#fresh || update.full;
    this.#db.exec("BEGIN");
    try {
      if (full) {
        for (const name of collections) this.#db.exec(`DELETE FROM "${name}"`);
        this.#written = new Map();
      }
      const view = update.view;
      this.#sync("files", engine.files());
      this.#sync(
        "documents",
        engine.documents().map((doc) => ({ path: doc.path, kind: doc.kind, value: doc.value })),
      );
      this.#sync("tasks", view.tasks);
      this.#sync("projects", view.projects);
      this.#sync("devices", view.devices);
      this.#sync("queues", view.queues);
      this.#sync("slots", view.slots);
      this.#sync("credentials", view.credentials);
      this.#sync("issues", view.issues);
      this.#sync("presence", update.presence.devices);
      const scopes: (string | null)[] = full
        ? [null, ...engine.taskIds()]
        : [...(update.workspaceChanged ? [null] : []), ...update.changedTasks];
      for (const scope of scopes) this.#writeEvents(scope, engine.eventRows(scope), full);
      this.#db.exec("COMMIT");
      this.#fresh = false;
    } catch (error) {
      // SQLite can end the transaction itself (for example on a full disk).
      if (this.#db.isTransaction) this.#db.exec("ROLLBACK");
      // `#written` already holds rows that the rollback removed: the next write replaces each
      // table, so the index never stays wrong after a failed write.
      this.#fresh = true;
      throw error;
    }
  }

  /**
   * The last valid value of each document in the index, for `new MergeEngine({lastValid})` after
   * a restart. A document that fails its schema then keeps the value that it had before.
   */
  documents(): LastValidDocument[] {
    return this.find<LastValidDocument>("documents").map((doc) => ({
      path: doc.path,
      kind: doc.kind,
      value: doc.value,
    }));
  }

  /** Replaces each table with the result of a full merge. */
  rebuild(update: MergeUpdate, engine: MergeEngine): void {
    this.#fresh = true;
    this.write(update, engine);
  }

  #insert(name: Collection, key: string, json: string, row: Record<string, unknown>): void {
    const spec: CollectionSpec = COLLECTIONS[name];
    const columns = Object.keys(spec.columns);
    const sql = `INSERT OR REPLACE INTO "${name}" (pk, json${columns.map((c) => `, "${c}"`).join("")}) VALUES (?, ?${columns.map(() => ", ?").join("")})`;
    this.#db.prepare(sql).run(key, json, ...columns.map((c) => columnValue(row[c])));
  }

  /** Writes the rows of a collection whose JSON changed, and deletes the rows that went away. */
  #sync(name: Collection, items: readonly object[]): void {
    const spec: CollectionSpec = COLLECTIONS[name];
    const old = this.#written.get(name) ?? new Map<string, string>();
    const next: Rows = new Map();
    for (const item of items) {
      const row = item as Record<string, unknown>;
      const key = spec.key(row);
      const json = JSON.stringify(row);
      next.set(key, json);
      if (old.get(key) !== json) this.#insert(name, key, json, row);
    }
    const remove = this.#db.prepare(`DELETE FROM "${name}" WHERE pk = ?`);
    for (const key of old.keys()) if (!next.has(key)) remove.run(key);
    this.#written.set(name, next);
  }

  /** Replaces the event rows of a task, or of the workspace log when `task` is null. */
  #writeEvents(task: string | null, rows: EventRow[], full: boolean): void {
    if (!full) {
      if (task === null) this.#db.prepare(`DELETE FROM "events" WHERE task IS NULL`).run();
      else this.#db.prepare(`DELETE FROM "events" WHERE task = ?`).run(task);
    }
    for (const row of rows) {
      this.#insert(
        "events",
        row.id,
        JSON.stringify(row),
        row as unknown as Record<string, unknown>,
      );
    }
  }

  /**
   * Finds the rows of a collection that match a MongoDB-style query. Sort and limit run in SQL
   * when the whole query and the sort fields are SQL columns; else after the `sift` check.
   */
  find<T = Record<string, unknown>>(
    name: Collection,
    query: MongoQuery = {},
    options: FindOptions = {},
  ): T[] {
    const spec: CollectionSpec = COLLECTIONS[name];
    if (
      options.limit !== undefined &&
      (!Number.isSafeInteger(options.limit) || options.limit < 0)
    ) {
      // SQL and `slice` read a negative limit differently: refuse it on both paths.
      throw new RangeError(`limit must be an integer of 0 or more, not ${options.limit}`);
    }
    const filter = toSqlFilter(query, spec.columns);
    const sort = options.sort ?? {};
    const sortInSql =
      filter.complete && Object.keys(sort).every((field) => Object.hasOwn(spec.columns, field));
    let sql = `SELECT json FROM "${name}"`;
    if (filter.where) sql += ` WHERE ${filter.where}`;
    const order = sortInSql
      ? Object.entries(sort).map(
          ([column, direction]) => `"${column}" ${direction === -1 ? "DESC" : "ASC"}`,
        )
      : [];
    sql += ` ORDER BY ${[...order, "pk ASC"].join(", ")}`;
    const params = [...filter.params];
    if (sortInSql && options.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }
    const rows = (this.#db.prepare(sql).all(...params) as { json: string }[]).map(
      (row) => JSON.parse(row.json) as T,
    );
    const test = matcher(query);
    let result = rows.filter((row) => test(row));
    if (!sortInSql) {
      if (Object.keys(sort).length > 0) sortRows(result, sort);
      if (options.limit !== undefined) result = result.slice(0, options.limit);
    }
    return result;
  }

  /** Each row of each table, sorted by key: for tests that compare 2 indexes. */
  dump(): Record<Collection, { pk: string; json: string }[]> {
    const result = {} as Record<Collection, { pk: string; json: string }[]>;
    for (const name of collections) {
      const rows = this.#db.prepare(`SELECT pk, json FROM "${name}"`).all() as {
        pk: string;
        json: string;
      }[];
      result[name] = rows.sort((a, b) => compareText(a.pk, b.pk));
    }
    return result;
  }
}
