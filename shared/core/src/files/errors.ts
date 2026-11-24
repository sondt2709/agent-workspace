// Typed errors of the files layer. The gate "Fix a file" and the Inbox item "Sync problem" use them
// (docs/workflow.md 3, docs/phase-1.md 4.1 and 6.6).
import type { z } from "zod";

export type FileErrorCode =
  | "parse_error"
  | "schema_error"
  | "newer_version"
  | "unsupported_version"
  | "device_mismatch"
  | "line_too_long"
  | "write_refused";

export interface FileErrorDetails {
  /** The path relative to the workspace root, with `/` separators. */
  path: string;
  /** The line number in a log file, from 1. */
  line?: number;
}

export abstract class AwFileError extends Error {
  abstract readonly code: FileErrorCode;
  readonly path: string;
  readonly line: number | undefined;

  constructor(message: string, details: FileErrorDetails) {
    super(message);
    this.name = new.target.name;
    this.path = details.path;
    this.line = details.line;
  }

  /** The place of the error: `<path>` or `<path>:<line>`. */
  get where(): string {
    return this.line === undefined ? this.path : `${this.path}:${this.line}`;
  }
}

/** The text is not valid YAML or JSON. */
export class ParseError extends AwFileError {
  readonly code = "parse_error";
  constructor(details: FileErrorDetails, reason: string) {
    super(`${details.path}${details.line ? `:${details.line}` : ""}: ${reason}`, details);
  }
}

export interface SchemaIssue {
  /** The path of the value, for example `claim.epoch` or `data.gate`. Empty for the root. */
  path: string;
  /** The name of the field: the last text part of the path, or "" for the root. */
  field: string;
  message: string;
}

export function toSchemaIssues(error: z.ZodError): SchemaIssue[] {
  return error.issues.map((issue) => {
    const names = issue.path.filter((part) => typeof part === "string");
    return {
      path: issue.path.map(String).join("."),
      field: names.length > 0 ? String(names[names.length - 1]) : "",
      message: issue.message,
    };
  });
}

/** The value does not match its schema. */
export class SchemaError extends AwFileError {
  readonly code = "schema_error";
  readonly schema: string;
  readonly issues: SchemaIssue[];
  constructor(details: FileErrorDetails, schema: string, issues: SchemaIssue[]) {
    const first = issues[0];
    const where = details.line ? `${details.path}:${details.line}` : details.path;
    super(
      `${where}: does not match ${schema}` +
        (first ? `: ${first.path || "(root)"}: ${first.message}` : ""),
      details,
    );
    this.schema = schema;
    this.issues = issues;
  }
}

/** The file has a newer major version than this AW can read. */
export class NewerVersionError extends AwFileError {
  readonly code = "newer_version";
  readonly type: string;
  readonly version: number;
  constructor(details: FileErrorDetails, type: string, version: number) {
    super(`${details.path}: ${type} version ${version} is newer than this AW. Update AW.`, details);
    this.type = type;
    this.version = version;
  }
}

/** The file has a major version that is older than the previous major. */
export class UnsupportedVersionError extends AwFileError {
  readonly code = "unsupported_version";
  readonly type: string;
  readonly version: number;
  constructor(details: FileErrorDetails, type: string, version: number) {
    super(`${details.path}: ${type} version ${version} is too old for this AW.`, details);
    this.type = type;
    this.version = version;
  }
}

/** An event in `log/<d>.jsonl` with a `dev` that is not `d`: "Sync problem". */
export class DeviceMismatchError extends AwFileError {
  readonly code = "device_mismatch";
  readonly expected: string;
  readonly found: string;
  constructor(details: FileErrorDetails, expected: string, found: string) {
    super(
      `${details.path}:${details.line}: sync problem: event of device ${found} in the log of ${expected}`,
      details,
    );
    this.expected = expected;
    this.found = found;
  }
}

/** An event line is larger than 64 KiB (docs/phase-1.md 3.3.3). */
export class LineTooLongError extends AwFileError {
  readonly code = "line_too_long";
  readonly bytes: number;
  constructor(details: FileErrorDetails, bytes: number, limit: number) {
    super(
      `${details.path}: event line has ${bytes} bytes; the limit is ${limit}. Use artifacts/.`,
      details,
    );
    this.bytes = bytes;
  }
}

/** The write guard refused a write (docs/architecture.md 4.3.1). */
export class WriteRefusedError extends AwFileError {
  readonly code = "write_refused";
  readonly rule: string;
  constructor(details: FileErrorDetails, rule: string) {
    super(`${details.path}: write refused: ${rule}`, details);
    this.rule = rule;
  }
}
