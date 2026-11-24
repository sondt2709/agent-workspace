## 1. Scan
- [x] 1.1 Run `scripts/leakcheck.sh` with the private terms
- [x] 1.2 Read the full text of the non-code files (docs, root files, package metadata, OpenSpec, contracts, e2e, fixtures, plugin, test strings)

## 2. Fix
- [x] 2.1 Remove the private test machine name from `openspec/changes/archive/`
- [x] 2.2 Paraphrase the owner quotes; rename the "Owner case" scenarios and the fixture case
- [x] 2.3 `.gitignore`, `docs/workflow.md` 10, the Orca and the auth fixtures, the prototype path

## 3. Check
- [x] 3.1 `scripts/leakcheck.sh` and the root `task check`
