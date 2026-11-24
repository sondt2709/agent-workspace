// MongoDB-style queries on index rows (docs/phase-1.md 3.5.2, docs/tech-stack.md 1.1 "Index").
// Exact conditions on indexed columns go to SQL first. Then `sift` checks each row against the full
// query, so the SQL part only makes the query faster and never changes the result.
import type { SQLInputValue } from "node:sqlite";
import siftModule, { type Query } from "sift";
import { compareText } from "../merge/order.ts";

// sift is a CommonJS package whose types describe an ES module: under NodeNext the default import
// types as the module object. At run time it is the function, which also has `default`.
const sift = ((siftModule as unknown as { default?: unknown }).default ??
  siftModule) as typeof siftModule.default;

export type ColumnType = "text" | "integer" | "bool";

export type MongoQuery = Record<string, unknown>;

/** `{field: 1}` sorts ascending, `{field: -1}` descending. */
export type SortSpec = Record<string, 1 | -1>;

export interface SqlFilter {
  /** The SQL condition, or "" for no condition. */
  where: string;
  params: SQLInputValue[];
  /** True when the SQL condition is the full query. */
  complete: boolean;
}

type Scalar = string | number | boolean | null;

function isScalar(value: unknown): value is Scalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bind(value: Exclude<Scalar, null>): SQLInputValue {
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}

/** The SQL condition of one field, or null when the condition does not translate exactly. */
function fieldCondition(
  column: string,
  condition: unknown,
): { sql: string; params: SQLInputValue[] } | null {
  const quoted = `"${column}"`;
  const equal = (value: Scalar) =>
    value === null
      ? { sql: `${quoted} IS NULL`, params: [] }
      : { sql: `${quoted} = ?`, params: [bind(value)] };
  if (isScalar(condition)) return equal(condition);
  if (!isPlainObject(condition)) return null;
  const keys = Object.keys(condition);
  if (keys.length !== 1) return null;
  if (keys[0] === "$eq" && isScalar(condition.$eq)) return equal(condition.$eq);
  if (keys[0] === "$in" && Array.isArray(condition.$in) && condition.$in.every(isScalar)) {
    const values = condition.$in;
    const present = values.filter((v): v is Exclude<Scalar, null> => v !== null);
    const parts: string[] = [];
    if (present.length > 0) parts.push(`${quoted} IN (${present.map(() => "?").join(", ")})`);
    if (values.includes(null)) parts.push(`${quoted} IS NULL`);
    if (parts.length === 0) return { sql: "0", params: [] };
    return { sql: `(${parts.join(" OR ")})`, params: present.map(bind) };
  }
  return null;
}

/** Translates the exact conditions on indexed columns of a query to SQL. */
export function toSqlFilter(
  query: MongoQuery,
  columns: Readonly<Record<string, ColumnType>>,
): SqlFilter {
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  let complete = true;
  const visit = (node: MongoQuery) => {
    for (const [field, condition] of Object.entries(node)) {
      if (field === "$and" && Array.isArray(condition)) {
        for (const item of condition) {
          if (isPlainObject(item)) visit(item);
          else complete = false;
        }
        continue;
      }
      // `Object.hasOwn`: a name such as "constructor" is not a column.
      const translated = Object.hasOwn(columns, field) ? fieldCondition(field, condition) : null;
      if (translated === null) {
        complete = false;
        continue;
      }
      parts.push(translated.sql);
      params.push(...translated.params);
    }
  };
  visit(query);
  return { where: parts.join(" AND "), params, complete };
}

/** The tester of a query: true for each row that matches. */
export function matcher(query: MongoQuery): (row: unknown) => boolean {
  return sift(query as Query<unknown>);
}

function valueAt(row: unknown, path: string): unknown {
  let value: unknown = row;
  for (const part of path.split(".")) {
    if (!isPlainObject(value)) return undefined;
    value = value[part];
  }
  return value;
}

/** Compares 2 values like SQLite: null first, then false < true, numbers, texts. */
function compareValues(a: unknown, b: unknown): number {
  const rank = (v: unknown) =>
    v === null || v === undefined ? 0 : typeof v === "boolean" || typeof v === "number" ? 1 : 2;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return 0;
  if (ra === 1) return Number(a) - Number(b);
  return compareText(String(a), String(b));
}

/** Sorts rows by a sort spec in place. Equal rows keep their order. */
export function sortRows<T>(rows: T[], sort: SortSpec): T[] {
  const fields = Object.entries(sort);
  return rows.sort((a, b) => {
    for (const [field, direction] of fields) {
      const result = compareValues(valueAt(a, field), valueAt(b, field));
      if (result !== 0) return result * direction;
    }
    return 0;
  });
}
