// Syncthing conflict copies (docs/architecture.md 4.3.2, docs/phase-1.md 6.6). The engine renames
// the older version to `<stem>.sync-conflict-<YYYYMMDD>-<HHMMSS>-<ID><ext>`. The short id names the
// device whose version WON, not the author of the copy (verification 2026-11-22).

export interface ConflictCopy {
  /** The copy path, normalized with `/`. */
  copy: string;
  /** The path of the original file. */
  original: string;
  /** `YYYYMMDD-HHMMSS` from the name. */
  stamp: string;
  /** The 7-character short device id of the winner. */
  winner: string;
}

const COPY_NAME =
  /^(?<stem>.*)\.sync-conflict-(?<stamp>\d{8}-\d{6})-(?<id>[A-Z0-9]{7})(?<ext>\.[^/]*)?$/;

/** Parses a conflict copy path. Returns null when the last part of the path is not a copy name. */
export function parseConflictCopy(path: string): ConflictCopy | null {
  const normal = path.split("\\").join("/");
  const slash = normal.lastIndexOf("/");
  const dir = slash < 0 ? "" : normal.slice(0, slash + 1);
  const name = normal.slice(slash + 1);
  const match = COPY_NAME.exec(name);
  if (!match?.groups) return null;
  const stem = match.groups.stem!;
  if (stem === "" || stem.includes(".sync-conflict-")) return null;
  return {
    copy: normal,
    original: `${dir}${stem}${match.groups.ext ?? ""}`,
    stamp: match.groups.stamp!,
    winner: match.groups.id!,
  };
}

/** True when the last part of a path is a conflict copy name. */
export function isConflictCopy(path: string): boolean {
  return parseConflictCopy(path) !== null;
}
