// YAML documents: read with validation, write with the comments kept (docs/phase-1.md 3.2).
import {
  currentDocumentMajor,
  documentSchema,
  isDocumentKind,
  upgradeTaskDocument,
  versionStatus,
  type DocumentKind,
  type DocumentOf,
} from "@aw/schema";
import { Document, isMap, isScalar, isSeq, parseDocument, type YAMLMap, type YAMLSeq } from "yaml";
import {
  NewerVersionError,
  ParseError,
  SchemaError,
  toSchemaIssues,
  UnsupportedVersionError,
} from "./errors.ts";

export interface ParsedDocument<K extends DocumentKind = DocumentKind> {
  kind: K;
  /** The major version of the file. */
  version: number;
  /** "previous" when the file has the previous major version. */
  status: "current" | "previous";
  value: DocumentOf[K];
}

const YAML_OPTIONS = { version: "1.2", uniqueKeys: true } as const;

/** Parses and validates the text of a YAML document. `expected` is the kind that the path requires. */
export function parseDocumentText<K extends DocumentKind>(
  text: string,
  path: string,
  expected?: K,
): ParsedDocument<K> {
  const doc = parseDocument(text, YAML_OPTIONS);
  const syntax = doc.errors[0];
  if (syntax) {
    const line = syntax.linePos?.[0]?.line;
    throw new ParseError(
      { path, ...(line === undefined ? {} : { line }) },
      syntax.message.split("\n")[0] ?? "",
    );
  }
  const value: unknown = doc.toJS();
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SchemaError({ path }, "document", [
      { path: "", field: "", message: "A document is a YAML map with kind and schema" },
    ]);
  }
  const { kind, schema: version } = value as { kind?: unknown; schema?: unknown };
  if (!isDocumentKind(kind) || (expected !== undefined && kind !== expected)) {
    const want = expected ?? "a known document kind";
    throw new SchemaError({ path }, "document", [
      { path: "kind", field: "kind", message: `Expected ${want}, found ${JSON.stringify(kind)}` },
    ]);
  }
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new SchemaError({ path }, kind, [
      {
        path: "schema",
        field: "schema",
        message: "Expected the major version, an integer of 1 or more",
      },
    ]);
  }
  const status = versionStatus(currentDocumentMajor[kind], version);
  if (status === "newer") throw new NewerVersionError({ path }, kind, version);
  const schema = documentSchema(kind, version);
  if (status === "unsupported" || !schema)
    throw new UnsupportedVersionError({ path }, kind, version);
  // A task snapshot from before openspec proposal-and-discussion gets the field `proposal`.
  const result = schema.safeParse(upgradeTaskDocument(value));
  if (!result.success)
    throw new SchemaError({ path }, `${kind}.v${version}`, toSchemaIssues(result.error));
  return { kind: kind as K, version, status, value: result.data as DocumentOf[K] };
}

/**
 * Throws NewerVersionError when the old text of a file is a document of this kind with a newer
 * major version than this AW. A write would then drop the fields of the newer version.
 * An old text that is not a valid document does not stop the write.
 */
export function refuseNewerDocument(oldText: string, path: string, kind: DocumentKind): void {
  const doc = parseDocument(oldText, YAML_OPTIONS);
  if (doc.errors.length > 0) return;
  const value: unknown = doc.toJS();
  if (!isRecord(value) || value.kind !== kind) return;
  const version = value.schema;
  if (typeof version !== "number" || !Number.isInteger(version)) return;
  if (versionStatus(currentDocumentMajor[kind], version) === "newer") {
    throw new NewerVersionError({ path }, kind, version);
  }
}

/** Validates a document value before a write, and returns it with its defaults. */
export function validateDocument<K extends DocumentKind>(
  value: unknown,
  path: string,
  expected?: K,
): { kind: K; value: DocumentOf[K] } {
  const kind = (value as { kind?: unknown } | null)?.kind;
  if (!isDocumentKind(kind) || (expected !== undefined && kind !== expected)) {
    throw new SchemaError({ path }, "document", [
      { path: "kind", field: "kind", message: `Expected ${expected ?? "a known document kind"}` },
    ]);
  }
  const major = currentDocumentMajor[kind];
  const schema = documentSchema(kind, major);
  const result = schema!.safeParse(value);
  if (!result.success)
    throw new SchemaError({ path }, `${kind}.v${major}`, toSchemaIssues(result.error));
  return { kind: kind as K, value: result.data as DocumentOf[K] };
}

type Plain = string | number | boolean | null;

function isPlain(value: unknown): value is Plain {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Changes a node in place when the types match, so its comments stay. Returns the node to use. */
function update(doc: Document, node: unknown, value: unknown): unknown {
  if (isScalar(node) && isPlain(value)) {
    node.value = value;
    return node;
  }
  if (isMap(node) && isRecord(value)) {
    updateMap(doc, node, value);
    return node;
  }
  if (isSeq(node) && Array.isArray(value)) {
    updateSeq(doc, node, value);
    return node;
  }
  return doc.createNode(value);
}

function updateMap(doc: Document, map: YAMLMap, value: Record<string, unknown>): void {
  map.items = map.items.filter((pair) => {
    const key = isScalar(pair.key) ? pair.key.value : pair.key;
    // A key with the value undefined is removed, like a key that is not in the value.
    return typeof key === "string" && Object.hasOwn(value, key) && value[key] !== undefined;
  });
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    const pair = map.items.find((p) => isScalar(p.key) && p.key.value === key);
    if (pair) pair.value = update(doc, pair.value, item);
    else map.add(doc.createPair(key, item));
  }
}

function updateSeq(doc: Document, seq: YAMLSeq, value: unknown[]): void {
  seq.items = seq.items.slice(0, value.length);
  value.forEach((item, index) => {
    if (index < seq.items.length) seq.items[index] = update(doc, seq.items[index], item);
    else seq.items.push(doc.createNode(item));
  });
}

/**
 * Renders a document value as YAML. When the old text is a valid YAML map, AW changes its nodes in
 * place, so the comments of the nodes that stay are kept.
 */
export function renderDocumentText(value: Record<string, unknown>, oldText?: string): string {
  if (oldText !== undefined) {
    const doc = parseDocument(oldText, YAML_OPTIONS);
    if (doc.errors.length === 0 && isMap(doc.contents)) {
      updateMap(doc, doc.contents, value);
      return doc.toString();
    }
  }
  return new Document(value, YAML_OPTIONS).toString();
}
