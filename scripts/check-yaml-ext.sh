#!/usr/bin/env bash
# Fail when the tree has a YAML file with the .yml extension (docs/engineering-rules.md 4.3).
# Checks the tracked files and the untracked files that git does not ignore.
# The pre-commit hook "no-yml-extension" checks the staged files with the same rule.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
found="$({ git ls-files -- '*.yml'; git ls-files --others --exclude-standard -- '*.yml'; } | sort -u)"
if [[ -n "$found" ]]; then
  echo "Rename to .yaml:"
  echo "$found"
  exit 1
fi
echo "check-yaml-ext: OK (no .yml files)"
