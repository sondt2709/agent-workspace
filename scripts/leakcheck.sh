#!/usr/bin/env bash
# Find personal or private data in files before they leave this machine.
#
# Usage:
#   scripts/leakcheck.sh                scan tracked, staged and untracked (not ignored) files
#   scripts/leakcheck.sh <base> <head>  scan the files that changed between two commits, at <head>
# The pre-push hook gives the range through PRE_COMMIT_FROM_REF and PRE_COMMIT_TO_REF.
#
# Checks:
#   1. Home paths (/Users/<name>, /home/<name>, C:\Users\<name>), except placeholders.
#   2. Email addresses, except noreply and example.com addresses. The "deprecated:" lines of
#      pnpm-lock.yaml are skipped: pnpm copies the deprecation text of a public package there, and
#      such a text can name the contact of that package (for example glob 7).
#   3. Token shapes and private key headers.
#   4. The private terms: names, handles, host names, other projects. The script reads the file
#      in AW_LEAKCHECK_TERMS, else tmp/leakcheck.local, and only when that file exists.
#      One term per line. Lines that are empty or start with # are ignored. The file is not
#      committed, because the terms are private. CI runs checks 1 to 3 only.
#
# The script scans itself too. Its patterns do not match their own text.
# All checks run with LC_ALL=C: the result is the same with BSD grep and GNU grep, and a text
# file that is not valid UTF-8 is not skipped as binary. Only a file with a NUL byte is binary.
# Thus the private terms match without case only for ASCII letters.
#
# Exit code 1 when it finds something or cannot read a file. The scan does not replace a read
# of the full diff of each non-code file: Markdown, YAML, JSON, fixtures.
set -euo pipefail
export LC_ALL=C

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
TERMS="${AW_LEAKCHECK_TERMS:-tmp/leakcheck.local}"
EMPTY_TREE="$(git hash-object -t tree /dev/null)"

BASE="${1:-${PRE_COMMIT_FROM_REF:-}}"
HEAD_REF="${2:-${PRE_COMMIT_TO_REF:-}}"

# The file names are NUL-terminated and not quoted. With the default core.quotePath, git puts
# a name with a non-ASCII character, a double quote or a backslash in quotes, and the script
# could not read that file.
list_files() {
  if [[ -n "$HEAD_REF" ]]; then
    local base="$BASE"
    if [[ -z "$base" || "$base" =~ ^0+$ ]]; then base="$EMPTY_TREE"; fi
    git -c core.quotePath=false diff -z --name-only --diff-filter=ACMR "$base" "$HEAD_REF"
  else
    {
      git -c core.quotePath=false ls-files -z
      git -c core.quotePath=false ls-files -z --others --exclude-standard
      git -c core.quotePath=false diff -z --cached --name-only --diff-filter=ACMR
    } | sort -z -u
  fi
}

# Copy one file to $CURRENT. The checks read this copy, not a pipe. On a pipe, "grep -q" stops
# early, and with "pipefail" the broken pipe made the script skip each large file.
# Return 2 when there is nothing to scan (a tracked file deleted from the working tree, or a
# submodule). Return 1 when the file cannot be read.
read_file() {
  if [[ -n "$HEAD_REF" ]]; then
    local type
    type="$(git cat-file -t "$HEAD_REF:$1" 2>/dev/null)" || return 1
    [[ "$type" == blob ]] || return 2
    git cat-file blob "$HEAD_REF:$1" > "$CURRENT" 2>/dev/null || return 1
  elif [[ -L "$1" ]]; then
    readlink -- "$1" > "$CURRENT" || return 1    # git stores the target of a link as text
  elif [[ -d "$1" ]]; then
    return 2
  elif [[ ! -e "$1" ]]; then
    return 2
  else
    cat -- "$1" > "$CURRENT" 2>/dev/null || return 1
  fi
}

# A NUL byte marks a binary file. "grep -I" is not used: its result depends on the grep and
# the locale.
is_binary() {
  [[ "$(tr -d -c '\000' < "$CURRENT" | wc -c)" -gt 0 ]]
}

# A Windows path has one backslash, or two in an escaped string.
PATH_RE='(/Users/|/home/)[A-Za-z0-9._-]+|[A-Za-z]:\\{1,2}Users\\{1,2}[A-Za-z0-9._-]+'
# Placeholder names. "/Users/<name>" never matches PATH_RE, because "<" is not a name character.
PATH_OK='^((/Users/|/home/)|[A-Za-z]:\\{1,2}Users\\{1,2})(you|me|user|username|runner|name|example)$'
EMAIL_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
EMAIL_OK='noreply@|no-reply@|@example\.(com|org|net)|@users\.noreply\.github\.com'
SECRET_RE='AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AGE-SECRET-KEY-1[0-9A-Z]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
CURRENT="$WORK/current"

patterns=""
if [[ -f "$TERMS" ]]; then
  patterns="$WORK/patterns"
  grep -v -e '^[[:space:]]*$' -e '^[[:space:]]*#' "$TERMS" > "$patterns" || true
  [[ -s "$patterns" ]] || patterns=""
fi

found=0
unreadable=0
report() { echo "  $1:$2: $3"; found=1; }
count=0

# A file, not a pipe, so that "set -e" stops the script when git fails.
list_files > "$WORK/files"

while IFS= read -r -d '' file; do
  [[ -z "$file" ]] && continue
  rc=0
  read_file "$file" || rc=$?
  if [[ "$rc" == 1 ]]; then
    echo "  $file: cannot read the file"
    found=1
    unreadable=1
    continue
  fi
  [[ "$rc" == 2 ]] && continue
  [[ -s "$CURRENT" ]] || continue   # skip empty files
  is_binary && continue
  count=$((count + 1))

  while IFS= read -r hit; do
    [[ -z "$hit" ]] && continue
    # Check each path on the line. One placeholder path must not hide a real one.
    while IFS= read -r m; do
      grep -a -qE "$PATH_OK" <<< "$m" || report "$file" "${hit%%:*}" "home path"
    done < <(grep -a -oE "$PATH_RE" <<< "${hit#*:}")
  done < <(grep -a -nE "$PATH_RE" "$CURRENT" || true)

  while IFS= read -r hit; do
    [[ -z "$hit" ]] && continue
    while IFS= read -r m; do
      grep -a -qE "$EMAIL_OK" <<< "$m" || report "$file" "${hit%%:*}" "email address"
    done < <(grep -a -oE "$EMAIL_RE" <<< "${hit#*:}")
  done < <(grep -a -nE "$EMAIL_RE" "$CURRENT" | {
    if [[ "$file" == pnpm-lock.yaml ]]; then grep -a -vE '^[0-9]+:[[:space:]]+deprecated: ' || true; else cat; fi
  } || true)

  while IFS= read -r hit; do
    [[ -n "$hit" ]] && report "$file" "${hit%%:*}" "possible secret"
  done < <(grep -a -nE "$SECRET_RE" "$CURRENT" || true)

  if [[ -n "$patterns" ]]; then
    while IFS= read -r hit; do
      [[ -n "$hit" ]] && report "$file" "${hit%%:*}" "private term"
    done < <(grep -a -n -i -F -f "$patterns" "$CURRENT" || true)
  fi
done < "$WORK/files"

if [[ "$found" == 1 ]]; then
  echo "leakcheck: FAILED. Remove the items above, or replace them with synthetic examples."
  if [[ "$unreadable" == 1 ]]; then
    echo "  The script must scan each listed file. Make the files above readable and run again."
  fi
  exit 1
fi
if [[ -z "$patterns" ]]; then
  echo "leakcheck: OK ($count files; no $TERMS, so the private terms were not checked)"
else
  echo "leakcheck: OK ($count files, $(wc -l < "$patterns" | tr -d ' ') private terms)"
fi
