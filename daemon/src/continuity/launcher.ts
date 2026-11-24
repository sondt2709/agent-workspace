// The launcher of awd for a self-updated install (docs/architecture.md 4.6.11 item 2): a POSIX sh
// script that the service unit runs. It counts each start, goes back to the previous version after
// 3 failed starts, then runs awd of `current`. It is plain sh so a broken new version cannot break
// the rollback. awd resets the count after it was ready for 60 s (`markStarted`).
import { MAX_FAILED_STARTS } from "./update.ts";

/** The launcher script for `<home>/versions`. `awd` is the path of awd inside a version folder. */
export function launcherScript(options: { versions: string; awd?: string }): string {
  const awd = options.awd ?? "bin/awd";
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh
# AW launcher: rollback after ${MAX_FAILED_STARTS} failed starts (docs/architecture.md 4.6.11).
set -u
VERSIONS=${quote(options.versions)}
COUNT_FILE="$VERSIONS/failed-starts"
count=0
if [ -f "$COUNT_FILE" ]; then
  count=$(tr -cd '0-9' < "$COUNT_FILE")
  [ -n "$count" ] || count=0
fi
# count = the earlier starts of this version that did not reach the healthy time.
if [ "$count" -ge ${MAX_FAILED_STARTS} ] && [ -L "$VERSIONS/previous" ]; then
  current=$(readlink "$VERSIONS/current" 2>/dev/null || true)
  previous=$(readlink "$VERSIONS/previous")
  if [ -n "$previous" ] && [ "$previous" != "$current" ] && [ -d "$VERSIONS/$previous" ]; then
    # ln -sfn: replace the link itself, not a path inside the folder it points at (GNU and BSD).
    ln -sfn "$previous" "$VERSIONS/current"
    if [ -n "$current" ]; then
      ln -sfn "$current" "$VERSIONS/previous"
    fi
    echo "aw launcher: ${MAX_FAILED_STARTS} failed starts of $current; back to $previous" >&2
    count=0
  fi
fi
count=$((count + 1))
printf '%s\\n' "$count" > "$COUNT_FILE.tmp" && mv -f "$COUNT_FILE.tmp" "$COUNT_FILE"
exec "$VERSIONS/current/${awd}" "$@"
`;
}
