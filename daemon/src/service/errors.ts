// The errors of the service layer. The API maps each one to the error envelope
// (docs/engineering-rules.md 5.16); the CLI maps the HTTP status to the exit code.

export type ErrorCode =
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "ambiguous"
  | "gate_not_open"
  | "refused"
  | "unauthorized"
  | "not_ready"
  | "not_available"
  | "written_not_merged"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  conflict: 409,
  ambiguous: 409,
  gate_not_open: 409,
  refused: 403,
  // A missing, unknown or revoked session token (design of add-mcp-server, decision 5).
  unauthorized: 401,
  not_ready: 503,
  // A tool or route that a later task builds (the MCP tools of task-loop and continuity).
  not_available: 501,
  // The event is in the log of this device, but the merge or the index write after it failed. The
  // next batch merges it: the client must not write it again.
  written_not_merged: 500,
  internal: 500,
};

export class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const notFound = (what: string) => new ServiceError("not_found", `${what} not found`);
export const invalid = (message: string, details?: unknown) =>
  new ServiceError("invalid_input", message, details);
